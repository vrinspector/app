"""ITP document numbers + three-shot photo set (rebuild increment 13.8)

Owner review 2026-11-10 ("ITP look and feel", three-shot photos from her
field guide Ch. 10). All additive, all guarded:

1. ``projects.code`` (VARCHAR(20), nullable) — the PROJECT CODE in
   ``ITP-<PROJECT CODE>-<SEQ>``. NULL means "derive it from the name"; no
   existing row is given a value.
2. ``project_itps.seq`` (INTEGER, nullable) with a unique
   ``(project_id, seq)`` — the SEQ. Existing ITPs are numbered 1, 2, 3 … per
   project in the order they were created (``created_at``, then ``id``).
3. ``itp_items.photo_set`` (VARCHAR(20), nullable) — ``three_shot`` when the
   line needs the Context / Intermediate / Close-up set.
4. ``photos.shot_slot`` (VARCHAR(20), nullable; checked to be one of
   ``context`` / ``intermediate`` / ``closeup`` and only on ITP line photos)
   and ``photos.captured_at`` (timestamptz, nullable) — when the device says
   the picture was taken.

Idempotent on upgrade. Downgrade refuses while any project has a code, any
line asks for the three-shot set or any photo fills a slot (it would lose
them); the ITP numbers themselves can be re-derived, so they do not block.

Revision ID: b2e6f9c4d817
Revises: a9d4c2e7f318
Create Date: 2026-11-11 07:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b2e6f9c4d817'
down_revision = 'a9d4c2e7f318'
branch_labels = None
depends_on = None

SEQ_UNIQUE = 'uq_project_itps_seq'
SHOT_CHECK = 'ck_photos_shot_slot'
SHOT_CHECK_SQL = (
    "shot_slot IS NULL OR (itp_item_id IS NOT NULL AND shot_slot IN "
    "('context', 'intermediate', 'closeup'))"
)


def _columns(inspector, table):
    return {c['name'] for c in inspector.get_columns(table)}


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'code' not in _columns(inspector, 'projects'):
        op.add_column('projects', sa.Column('code', sa.String(length=20), nullable=True))

    if 'seq' not in _columns(inspector, 'project_itps'):
        op.add_column('project_itps', sa.Column('seq', sa.Integer(), nullable=True))
    # Number any ITP that has no number yet, after the ones that have.
    bind.execute(
        sa.text(
            """
            UPDATE project_itps AS p
               SET seq = n.seq
              FROM (
                    SELECT id,
                           COALESCE(
                               (SELECT max(seq) FROM project_itps x
                                 WHERE x.project_id = i.project_id), 0)
                           + row_number() OVER (
                               PARTITION BY project_id ORDER BY created_at, id
                           ) AS seq
                      FROM project_itps i
                     WHERE seq IS NULL
                   ) AS n
             WHERE p.id = n.id
            """
        )
    )
    inspector = sa.inspect(bind)
    uniques = {u['name'] for u in inspector.get_unique_constraints('project_itps')}
    if SEQ_UNIQUE not in uniques:
        op.create_unique_constraint(SEQ_UNIQUE, 'project_itps', ['project_id', 'seq'])

    if 'photo_set' not in _columns(inspector, 'itp_items'):
        op.add_column(
            'itp_items', sa.Column('photo_set', sa.String(length=20), nullable=True)
        )

    photo_columns = _columns(inspector, 'photos')
    if 'shot_slot' not in photo_columns:
        op.add_column('photos', sa.Column('shot_slot', sa.String(length=20), nullable=True))
    if 'captured_at' not in photo_columns:
        op.add_column(
            'photos', sa.Column('captured_at', sa.DateTime(timezone=True), nullable=True)
        )
    inspector = sa.inspect(bind)
    if SHOT_CHECK not in {c['name'] for c in inspector.get_check_constraints('photos')}:
        op.create_check_constraint(SHOT_CHECK, 'photos', SHOT_CHECK_SQL)


def _refuse_if(bind, sql, what):
    count = bind.execute(sa.text(sql)).scalar()
    if count:
        raise RuntimeError(
            f'Refusing to downgrade b2e6f9c4d817: {count} {what}. '
            'Clear them deliberately before downgrading.'
        )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'code' in _columns(inspector, 'projects'):
        _refuse_if(
            bind, 'SELECT count(*) FROM projects WHERE code IS NOT NULL',
            'project(s) have an ITP code',
        )
    if 'photo_set' in _columns(inspector, 'itp_items'):
        _refuse_if(
            bind, 'SELECT count(*) FROM itp_items WHERE photo_set IS NOT NULL',
            'ITP line(s) ask for the three-shot photo set',
        )
    photo_columns = _columns(inspector, 'photos')
    if 'shot_slot' in photo_columns:
        _refuse_if(
            bind, 'SELECT count(*) FROM photos WHERE shot_slot IS NOT NULL',
            'photo(s) fill a three-shot slot',
        )

    if SHOT_CHECK in {c['name'] for c in inspector.get_check_constraints('photos')}:
        op.drop_constraint(SHOT_CHECK, 'photos', type_='check')
    if 'captured_at' in photo_columns:
        op.drop_column('photos', 'captured_at')
    if 'shot_slot' in photo_columns:
        op.drop_column('photos', 'shot_slot')
    if 'photo_set' in _columns(inspector, 'itp_items'):
        op.drop_column('itp_items', 'photo_set')
    uniques = {u['name'] for u in inspector.get_unique_constraints('project_itps')}
    if SEQ_UNIQUE in uniques:
        op.drop_constraint(SEQ_UNIQUE, 'project_itps', type_='unique')
    if 'seq' in _columns(inspector, 'project_itps'):
        op.drop_column('project_itps', 'seq')
    if 'code' in _columns(inspector, 'projects'):
        op.drop_column('projects', 'code')
