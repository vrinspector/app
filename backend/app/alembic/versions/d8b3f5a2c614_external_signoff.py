"""External sign-off: signing-link bookkeeping + sign-off pack versions (rebuild increment 14)

PRD v2.63 §5: no-account magic links, a drawn signature with a time / GPS /
weather stamp, and a sign-off pack PDF regenerated on change with every
version kept in S3. The token and signature tables already exist (increment
12, ``e7c2a9f4b613``); this adds only what the flow needs. All additive, all
guarded, idempotent on upgrade:

1. ``external_sign_tokens.revoked_at`` (TIMESTAMPTZ, nullable),
   ``revoked_reason`` (VARCHAR(20), nullable: ``withdrawn`` / ``replaced``) and
   ``reminder_count`` (INTEGER NOT NULL DEFAULT 0). A reminder issues a fresh
   link and marks the old one ``replaced`` — only the token's hash is stored,
   so the old link cannot be re-sent.
2. ``itp_sign_packs`` — one row per generated pack PDF: exactly one of
   ``project_itp_id`` / ``area_id`` (both CASCADE), ``version`` unique per
   document (two partial unique indexes), ``s3_key``, ``filename``,
   ``file_size``, ``content_hash`` (SHA-256 of what the PDF shows),
   ``signature_count``, ``generated_by``, ``created_at``.

Downgrade refuses while any pack version exists or any link carries a
revocation reason or reminder count (it would lose them).

Revision ID: d8b3f5a2c614
Revises: c6f1a8d3e529
Create Date: 2026-11-11 18:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'd8b3f5a2c614'
down_revision = 'c6f1a8d3e529'
branch_labels = None
depends_on = None


def _columns(inspector, table):
    return {c['name'] for c in inspector.get_columns(table)}


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = _columns(inspector, 'external_sign_tokens')
    if 'revoked_at' not in columns:
        op.add_column(
            'external_sign_tokens',
            sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        )
    if 'revoked_reason' not in columns:
        op.add_column(
            'external_sign_tokens',
            sa.Column('revoked_reason', sa.String(length=20), nullable=True),
        )
    if 'reminder_count' not in columns:
        op.add_column(
            'external_sign_tokens',
            sa.Column(
                'reminder_count',
                sa.Integer(),
                nullable=False,
                server_default=sa.text('0'),
            ),
        )

    if 'itp_sign_packs' not in inspector.get_table_names():
        op.create_table(
            'itp_sign_packs',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column(
                'public_id',
                postgresql.UUID(as_uuid=True),
                nullable=False,
                unique=True,
                server_default=sa.text('gen_random_uuid()'),
            ),
            sa.Column(
                'project_itp_id',
                sa.Integer(),
                sa.ForeignKey('project_itps.id', ondelete='CASCADE'),
                nullable=True,
            ),
            sa.Column(
                'area_id',
                sa.Integer(),
                sa.ForeignKey('project_areas.id', ondelete='CASCADE'),
                nullable=True,
            ),
            sa.Column('version', sa.Integer(), nullable=False),
            sa.Column('s3_key', sa.String(length=512), nullable=False),
            sa.Column('filename', sa.String(length=255), nullable=False),
            sa.Column('file_size', sa.Integer(), nullable=False),
            sa.Column('content_hash', sa.String(length=64), nullable=False),
            sa.Column(
                'signature_count',
                sa.Integer(),
                nullable=False,
                server_default=sa.text('0'),
            ),
            sa.Column('generated_by', sa.String(length=255), nullable=True),
            sa.Column(
                'created_at',
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text('now()'),
            ),
            sa.CheckConstraint(
                'num_nonnulls(project_itp_id, area_id) = 1',
                name='ck_itp_sign_packs_one_document',
            ),
        )
        op.create_index(
            'ix_itp_sign_packs_project_itp_id', 'itp_sign_packs', ['project_itp_id']
        )
        op.create_index('ix_itp_sign_packs_area_id', 'itp_sign_packs', ['area_id'])
        op.create_index(
            'uq_itp_sign_packs_itp_version',
            'itp_sign_packs',
            ['project_itp_id', 'version'],
            unique=True,
            postgresql_where=sa.text('project_itp_id IS NOT NULL'),
        )
        op.create_index(
            'uq_itp_sign_packs_area_version',
            'itp_sign_packs',
            ['area_id', 'version'],
            unique=True,
            postgresql_where=sa.text('area_id IS NOT NULL'),
        )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'itp_sign_packs' in inspector.get_table_names():
        count = bind.execute(sa.text('SELECT count(*) FROM itp_sign_packs')).scalar()
        if count:
            raise RuntimeError(
                f'Refusing to downgrade d8b3f5a2c614: {count} sign-off pack '
                'version(s) recorded. Remove them deliberately before downgrading.'
            )
    columns = _columns(inspector, 'external_sign_tokens')
    if {'revoked_reason', 'reminder_count'} <= columns:
        count = bind.execute(
            sa.text(
                'SELECT count(*) FROM external_sign_tokens '
                'WHERE revoked_reason IS NOT NULL OR reminder_count > 0'
            )
        ).scalar()
        if count:
            raise RuntimeError(
                f'Refusing to downgrade d8b3f5a2c614: {count} signing link(s) '
                'carry a revocation reason or reminder count.'
            )
    if 'itp_sign_packs' in inspector.get_table_names():
        op.drop_table('itp_sign_packs')
    for column in ('reminder_count', 'revoked_reason', 'revoked_at'):
        if column in columns:
            op.drop_column('external_sign_tokens', column)
