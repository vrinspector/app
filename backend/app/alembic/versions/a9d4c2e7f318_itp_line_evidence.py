"""ITP line evidence + H / W / R / I vocabulary (rebuild increment 13.6)

Owner review 2026-11-10. Three changes, all guarded:

1. ``itp_items`` gains the evidence columns copied from the template question
   at import — ``acceptance_criteria``, ``reference_doc``, ``record_required``,
   ``photo_required`` (NOT NULL DEFAULT false), ``value_type`` / ``value_unit``
   / ``value_min`` / ``value_max`` — and ``measured_value`` (what was entered
   on site). Additive; existing lines get NULL / false.
2. ``photos`` gains ``itp_item_id`` (nullable FK → ``itp_items.id`` ON DELETE
   CASCADE, indexed) so a photo can be evidence for an ITP line. Such a photo
   has no inspection, so ``photos.inspection_id`` becomes nullable and a check
   ``num_nonnulls(inspection_id, itp_item_id) = 1`` keeps every photo attached
   to exactly one parent (every existing photo already satisfies it).
3. Classification values are renamed: ``surveillance`` → ``information`` and
   ``record`` → ``review`` on ``itp_items``. Template bodies (JSON) are left
   as they are — the parser still reads the old words.

Idempotent on upgrade. Downgrade refuses while any photo is ITP evidence or
any line holds a measured value (it would lose them); otherwise it maps the
classification words back and drops what it added.

Revision ID: a9d4c2e7f318
Revises: f3b8d1c6a425
Create Date: 2026-11-10 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a9d4c2e7f318'
down_revision = 'f3b8d1c6a425'
branch_labels = None
depends_on = None

ITEMS = 'itp_items'
PHOTOS = 'photos'
PHOTO_FK = 'photos_itp_item_id_fkey'
PHOTO_INDEX = 'ix_photos_itp_item_id'
PHOTO_CHECK = 'ck_photos_one_parent'



def _item_columns():
    """Fresh Column objects each call (a Column can join only one table)."""
    return [
        sa.Column('acceptance_criteria', sa.Text(), nullable=True),
        sa.Column('reference_doc', sa.String(length=255), nullable=True),
        sa.Column('record_required', sa.Text(), nullable=True),
        sa.Column(
            'photo_required',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
        sa.Column('value_type', sa.String(length=10), nullable=True),
        sa.Column('value_unit', sa.String(length=40), nullable=True),
        sa.Column('value_min', sa.Float(), nullable=True),
        sa.Column('value_max', sa.Float(), nullable=True),
        sa.Column('measured_value', sa.Text(), nullable=True),
    ]


RENAMES = (('surveillance', 'information'), ('record', 'review'))


def _columns(inspector, table):
    return {c['name'] for c in inspector.get_columns(table)}


def _checks(inspector, table):
    return {c['name'] for c in inspector.get_check_constraints(table)}


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    existing = _columns(inspector, ITEMS)
    for column in _item_columns():
        if column.name not in existing:
            op.add_column(ITEMS, column)

    if 'itp_item_id' not in _columns(inspector, PHOTOS):
        op.add_column(PHOTOS, sa.Column('itp_item_id', sa.Integer(), nullable=True))
    inspector = sa.inspect(bind)
    if PHOTO_FK not in {fk['name'] for fk in inspector.get_foreign_keys(PHOTOS)}:
        op.create_foreign_key(
            PHOTO_FK, PHOTOS, ITEMS, ['itp_item_id'], ['id'], ondelete='CASCADE'
        )
    if PHOTO_INDEX not in {ix['name'] for ix in inspector.get_indexes(PHOTOS)}:
        op.create_index(PHOTO_INDEX, PHOTOS, ['itp_item_id'])
    op.alter_column(PHOTOS, 'inspection_id', existing_type=sa.Integer(), nullable=True)
    if PHOTO_CHECK not in _checks(inspector, PHOTOS):
        op.create_check_constraint(
            PHOTO_CHECK, PHOTOS, 'num_nonnulls(inspection_id, itp_item_id) = 1'
        )

    for old, new in RENAMES:
        bind.execute(
            sa.text(f'UPDATE {ITEMS} SET classification = :new WHERE classification = :old'),
            {'old': old, 'new': new},
        )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'itp_item_id' in _columns(inspector, PHOTOS):
        evidence = bind.execute(
            sa.text(f'SELECT count(*) FROM {PHOTOS} WHERE itp_item_id IS NOT NULL')
        ).scalar()
        if evidence:
            raise RuntimeError(
                f'Refusing to downgrade a9d4c2e7f318: {evidence} photo(s) are ITP '
                'line evidence. Remove them deliberately before downgrading.'
            )
    if 'measured_value' in _columns(inspector, ITEMS):
        measured = bind.execute(
            sa.text(f'SELECT count(*) FROM {ITEMS} WHERE measured_value IS NOT NULL')
        ).scalar()
        if measured:
            raise RuntimeError(
                f'Refusing to downgrade a9d4c2e7f318: {measured} ITP line(s) hold '
                'a measured value. Clear them deliberately before downgrading.'
            )

    for old, new in RENAMES:
        bind.execute(
            sa.text(f'UPDATE {ITEMS} SET classification = :old WHERE classification = :new'),
            {'old': old, 'new': new},
        )

    if PHOTO_CHECK in _checks(inspector, PHOTOS):
        op.drop_constraint(PHOTO_CHECK, PHOTOS, type_='check')
    op.alter_column(PHOTOS, 'inspection_id', existing_type=sa.Integer(), nullable=False)
    if PHOTO_INDEX in {ix['name'] for ix in inspector.get_indexes(PHOTOS)}:
        op.drop_index(PHOTO_INDEX, table_name=PHOTOS)
    if PHOTO_FK in {fk['name'] for fk in inspector.get_foreign_keys(PHOTOS)}:
        op.drop_constraint(PHOTO_FK, PHOTOS, type_='foreignkey')
    if 'itp_item_id' in _columns(inspector, PHOTOS):
        op.drop_column(PHOTOS, 'itp_item_id')

    existing = _columns(inspector, ITEMS)
    for column in reversed(_item_columns()):
        if column.name in existing:
            op.drop_column(ITEMS, column.name)
