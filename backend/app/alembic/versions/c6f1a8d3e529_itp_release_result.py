"""ITP release lines: three-way result (rebuild increment 13.9)

Owner decision 2026-11-10 (book-aligned templates): the concrete pre-pour
release is recorded in writing as **Approved to pour / Approved with
conditions (list) / Rejected** — the result line of Checklist A-1 in her
field guide. All additive, all guarded:

1. ``itp_items.result_scale`` (VARCHAR(20), nullable) — ``release`` when the
   line takes the three-way result instead of Pass / Fail / N/A.
2. ``itp_items.approved_label`` (VARCHAR(60), nullable) — the wording of the
   approval on that line ("Approved to pour").
3. ``itp_items.conditions`` (TEXT, nullable) — the written conditions of an
   "Approved with conditions" release.

The result itself still lives in ``status`` (``pass`` / ``fail``), so
completion, hold points and sign-off rules are unchanged. Idempotent on
upgrade. Downgrade refuses while any line is a release line or carries
conditions (it would lose them).

Revision ID: c6f1a8d3e529
Revises: b2e6f9c4d817
Create Date: 2026-11-11 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c6f1a8d3e529'
down_revision = 'b2e6f9c4d817'
branch_labels = None
depends_on = None


def _columns(inspector, table):
    return {c['name'] for c in inspector.get_columns(table)}


def upgrade():
    inspector = sa.inspect(op.get_bind())
    columns = _columns(inspector, 'itp_items')
    if 'result_scale' not in columns:
        op.add_column(
            'itp_items', sa.Column('result_scale', sa.String(length=20), nullable=True)
        )
    if 'approved_label' not in columns:
        op.add_column(
            'itp_items', sa.Column('approved_label', sa.String(length=60), nullable=True)
        )
    if 'conditions' not in columns:
        op.add_column('itp_items', sa.Column('conditions', sa.Text(), nullable=True))


def downgrade():
    bind = op.get_bind()
    columns = _columns(sa.inspect(bind), 'itp_items')
    checks = []
    if 'result_scale' in columns:
        checks.append(('result_scale IS NOT NULL', 'ITP line(s) are release lines'))
    if 'conditions' in columns:
        checks.append(('conditions IS NOT NULL', 'ITP line(s) carry release conditions'))
    for where, what in checks:
        count = bind.execute(
            sa.text(f'SELECT count(*) FROM itp_items WHERE {where}')
        ).scalar()
        if count:
            raise RuntimeError(
                f'Refusing to downgrade c6f1a8d3e529: {count} {what}. '
                'Clear them deliberately before downgrading.'
            )
    for column in ('conditions', 'approved_label', 'result_scale'):
        if column in columns:
            op.drop_column('itp_items', column)
