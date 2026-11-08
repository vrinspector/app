"""Inspection report versions (Block 4 reports, rebuild increment 10)

Adds ``inspection_reports``: one row per generated PDF, so every report
version stays listable and downloadable (ADR-009: reports versioned in S3).
Purely additive — the live database has no reports table, so there is
nothing to reconcile. Idempotent on upgrade (skips a table that already
exists); downgrade refuses to drop the table while it holds rows.

Revision ID: c4e8f2a7b911
Revises: b7d3e9a1c204
Create Date: 2026-11-08 08:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'c4e8f2a7b911'
down_revision = 'b7d3e9a1c204'
branch_labels = None
depends_on = None

TABLE = 'inspection_reports'


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE in set(inspector.get_table_names()):
        return

    op.create_table(
        TABLE,
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            'public_id',
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text('gen_random_uuid()'),
        ),
        sa.Column(
            'inspection_id',
            sa.Integer(),
            sa.ForeignKey('inspections.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('s3_key', sa.String(length=512), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('file_size', sa.BigInteger(), nullable=True),
        sa.Column(
            'finding_count', sa.Integer(), nullable=False, server_default=sa.text('0')
        ),
        sa.Column(
            'photo_count', sa.Integer(), nullable=False, server_default=sa.text('0')
        ),
        sa.Column('generated_by', sa.String(length=255), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text('now()'),
        ),
        sa.UniqueConstraint('public_id', name='inspection_reports_public_id_key'),
        sa.UniqueConstraint(
            'inspection_id', 'version', name='uq_inspection_reports_version'
        ),
    )
    op.create_index(
        'ix_inspection_reports_inspection_id', TABLE, ['inspection_id']
    )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE not in set(inspector.get_table_names()):
        return
    count = bind.execute(sa.text(f'SELECT count(*) FROM {TABLE}')).scalar()
    if count:
        raise RuntimeError(
            f'Refusing to downgrade c4e8f2a7b911: {TABLE} holds {count} rows. '
            'Back up and truncate it deliberately before downgrading.'
        )
    op.drop_index('ix_inspection_reports_inspection_id', table_name=TABLE)
    op.drop_table(TABLE)
