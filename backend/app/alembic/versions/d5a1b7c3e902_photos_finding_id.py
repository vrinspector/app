"""Photos may document a finding (capture loop, rebuild increment 11a)

Adds ``photos.finding_id`` — nullable, FK → ``findings.id`` ON DELETE SET
NULL, indexed — so a photo taken in the drawing-tap → finding capture loop
is filed under the finding it documents. Purely additive: existing photos
stay site photos (NULL). Idempotent on upgrade (skips a column that already
exists); downgrade refuses to drop the column while any photo is linked.

Revision ID: d5a1b7c3e902
Revises: c4e8f2a7b911
Create Date: 2026-11-08 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd5a1b7c3e902'
down_revision = 'c4e8f2a7b911'
branch_labels = None
depends_on = None

TABLE = 'photos'
COLUMN = 'finding_id'
INDEX = 'ix_photos_finding_id'
FK = 'photos_finding_id_fkey'


def _columns(inspector, table):
    return {c['name'] for c in inspector.get_columns(table)}


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if COLUMN not in _columns(inspector, TABLE):
        op.add_column(TABLE, sa.Column(COLUMN, sa.Integer(), nullable=True))
    inspector = sa.inspect(bind)
    fks = {fk['name'] for fk in inspector.get_foreign_keys(TABLE)}
    if FK not in fks:
        op.create_foreign_key(
            FK, TABLE, 'findings', [COLUMN], ['id'], ondelete='SET NULL'
        )
    indexes = {ix['name'] for ix in inspector.get_indexes(TABLE)}
    if INDEX not in indexes:
        op.create_index(INDEX, TABLE, [COLUMN])


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if COLUMN not in _columns(inspector, TABLE):
        return
    linked = bind.execute(
        sa.text(f'SELECT count(*) FROM {TABLE} WHERE {COLUMN} IS NOT NULL')
    ).scalar()
    if linked:
        raise RuntimeError(
            f'Refusing to downgrade d5a1b7c3e902: {linked} photo(s) are linked '
            'to findings. Clear photos.finding_id deliberately before downgrading.'
        )
    indexes = {ix['name'] for ix in inspector.get_indexes(TABLE)}
    if INDEX in indexes:
        op.drop_index(INDEX, table_name=TABLE)
    fks = {fk['name'] for fk in inspector.get_foreign_keys(TABLE)}
    if FK in fks:
        op.drop_constraint(FK, TABLE, type_='foreignkey')
    op.drop_column(TABLE, COLUMN)
