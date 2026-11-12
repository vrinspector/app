"""Drawing revisions + carried pins (rebuild increment 14.5)

Owner decision 2026-11-10: upload a new revision of an existing drawing
(Rev A → Rev B) instead of a separate drawing; pins carry forward to the new
revision at the same page and x / y, flagged "check position" until someone
confirms or moves each one; old revisions stay viewable, read-only, with
their pins as they were. All additive, all guarded, idempotent on upgrade:

1. ``drawings.series_id`` (INTEGER, nullable, indexed; no FK so a series
   survives the deletion of its first row), backfilled to ``id`` so every
   existing drawing is a one-revision series; ``drawings.revision``
   (VARCHAR(20), nullable — existing drawings stay unlabelled);
   ``drawings.superseded_at`` (TIMESTAMPTZ, nullable — existing drawings are
   all current); partial unique index ``uq_drawings_series_current`` so a
   series has exactly one current revision.
2. ``inspection_pins.carried_from_pin_id`` (INTEGER, nullable, FK
   ``inspection_pins.id`` ON DELETE SET NULL, indexed),
   ``position_check`` (BOOLEAN NOT NULL DEFAULT false),
   ``position_confirmed_by`` (VARCHAR(255)) and ``position_confirmed_at``
   (TIMESTAMPTZ).

Downgrade refuses while any drawing is superseded or any pin was carried
from another revision (it would merge revisions back into separate drawings
and lose the carried-pin trail).

Revision ID: e4a7c9b2d816
Revises: d8b3f5a2c614
Create Date: 2026-11-12 04:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e4a7c9b2d816'
down_revision = 'd8b3f5a2c614'
branch_labels = None
depends_on = None


def _columns(inspector, table):
    return {c['name'] for c in inspector.get_columns(table)}


def _indexes(inspector, table):
    return {i['name'] for i in inspector.get_indexes(table)}


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    columns = _columns(inspector, 'drawings')
    if 'series_id' not in columns:
        op.add_column('drawings', sa.Column('series_id', sa.Integer(), nullable=True))
    if 'revision' not in columns:
        op.add_column(
            'drawings', sa.Column('revision', sa.String(length=20), nullable=True)
        )
    if 'superseded_at' not in columns:
        op.add_column(
            'drawings',
            sa.Column('superseded_at', sa.DateTime(timezone=True), nullable=True),
        )
    # Every existing drawing is a one-revision series of its own.
    bind.execute(sa.text('UPDATE drawings SET series_id = id WHERE series_id IS NULL'))
    indexes = _indexes(inspector, 'drawings')
    if 'ix_drawings_series_id' not in indexes:
        op.create_index('ix_drawings_series_id', 'drawings', ['series_id'])
    if 'uq_drawings_series_current' not in indexes:
        op.create_index(
            'uq_drawings_series_current',
            'drawings',
            ['series_id'],
            unique=True,
            postgresql_where=sa.text('superseded_at IS NULL'),
        )

    columns = _columns(inspector, 'inspection_pins')
    if 'carried_from_pin_id' not in columns:
        op.add_column(
            'inspection_pins',
            sa.Column(
                'carried_from_pin_id',
                sa.Integer(),
                sa.ForeignKey('inspection_pins.id', ondelete='SET NULL'),
                nullable=True,
            ),
        )
    if 'position_check' not in columns:
        op.add_column(
            'inspection_pins',
            sa.Column(
                'position_check',
                sa.Boolean(),
                nullable=False,
                server_default=sa.text('false'),
            ),
        )
    if 'position_confirmed_by' not in columns:
        op.add_column(
            'inspection_pins',
            sa.Column('position_confirmed_by', sa.String(length=255), nullable=True),
        )
    if 'position_confirmed_at' not in columns:
        op.add_column(
            'inspection_pins',
            sa.Column(
                'position_confirmed_at', sa.DateTime(timezone=True), nullable=True
            ),
        )
    if 'ix_inspection_pins_carried_from_pin_id' not in _indexes(
        inspector, 'inspection_pins'
    ):
        op.create_index(
            'ix_inspection_pins_carried_from_pin_id',
            'inspection_pins',
            ['carried_from_pin_id'],
        )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    drawing_columns = _columns(inspector, 'drawings')
    pin_columns = _columns(inspector, 'inspection_pins')
    if 'superseded_at' in drawing_columns:
        count = bind.execute(
            sa.text('SELECT count(*) FROM drawings WHERE superseded_at IS NOT NULL')
        ).scalar()
        if count:
            raise RuntimeError(
                f'Refusing to downgrade e4a7c9b2d816: {count} superseded drawing '
                'revision(s) recorded. Remove them deliberately before downgrading.'
            )
    if 'carried_from_pin_id' in pin_columns:
        count = bind.execute(
            sa.text(
                'SELECT count(*) FROM inspection_pins '
                'WHERE carried_from_pin_id IS NOT NULL'
            )
        ).scalar()
        if count:
            raise RuntimeError(
                f'Refusing to downgrade e4a7c9b2d816: {count} pin(s) were carried '
                'from an earlier drawing revision.'
            )
    pin_indexes = _indexes(inspector, 'inspection_pins')
    if 'ix_inspection_pins_carried_from_pin_id' in pin_indexes:
        op.drop_index(
            'ix_inspection_pins_carried_from_pin_id', table_name='inspection_pins'
        )
    for column in (
        'position_confirmed_at',
        'position_confirmed_by',
        'position_check',
        'carried_from_pin_id',
    ):
        if column in pin_columns:
            op.drop_column('inspection_pins', column)
    drawing_indexes = _indexes(inspector, 'drawings')
    if 'uq_drawings_series_current' in drawing_indexes:
        op.drop_index('uq_drawings_series_current', table_name='drawings')
    if 'ix_drawings_series_id' in drawing_indexes:
        op.drop_index('ix_drawings_series_id', table_name='drawings')
    for column in ('superseded_at', 'revision', 'series_id'):
        if column in drawing_columns:
            op.drop_column('drawings', column)
