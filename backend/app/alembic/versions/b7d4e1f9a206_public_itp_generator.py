"""Public ITP generator usage log (rebuild increment 17)

PRD v2.63 Block 10D: the no-account scope → draft ITP page on vrinspector.com
is rate-limited and its usage logged. One new table, additive and guarded,
idempotent on upgrade:

``public_itp_generations`` — one row per request let through to the model:
status (``draft`` / ``failed``), a keyed hash of the visitor's address (never
the address), the scope, an optional email kept only with consent (check
``ck_public_itp_generations_consent``), user agent, model / prompt version,
the exact prompts, the draft or the error, tokens, and the S3 key of the
watermarked PDF. Indexed on the visitor hash and the time, which is what the
rate limits count.

Downgrade refuses while any row is logged (it is the usage record).

Revision ID: b7d4e1f9a206
Revises: a5e2c8f4d913
Create Date: 2026-11-13 07:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'b7d4e1f9a206'
down_revision = 'a5e2c8f4d913'
branch_labels = None
depends_on = None

TABLE = 'public_itp_generations'


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE not in inspector.get_table_names():
        op.create_table(
            TABLE,
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                'public_id',
                postgresql.UUID(as_uuid=True),
                nullable=False,
                unique=True,
                server_default=sa.text('gen_random_uuid()'),
            ),
            sa.Column('status', sa.String(length=20), nullable=False),
            sa.Column('visitor_key', sa.String(length=64), nullable=False),
            sa.Column('scope', sa.Text(), nullable=False),
            sa.Column('email', sa.String(length=255), nullable=True),
            sa.Column('email_consent_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('user_agent', sa.String(length=255), nullable=True),
            sa.Column('model', sa.String(length=100), nullable=False),
            sa.Column('prompt_version', sa.String(length=40), nullable=False),
            sa.Column('system_prompt', sa.Text(), nullable=False),
            sa.Column('user_prompt', sa.Text(), nullable=False),
            sa.Column('draft', postgresql.JSONB(), nullable=True),
            sa.Column('error', sa.Text(), nullable=True),
            sa.Column('input_tokens', sa.Integer(), nullable=True),
            sa.Column('output_tokens', sa.Integer(), nullable=True),
            sa.Column('pdf_s3_key', sa.String(length=512), nullable=True),
            sa.Column(
                'created_at',
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text('now()'),
            ),
            sa.CheckConstraint(
                "status IN ('draft', 'failed')",
                name='ck_public_itp_generations_status',
            ),
            sa.CheckConstraint(
                'email IS NULL OR email_consent_at IS NOT NULL',
                name='ck_public_itp_generations_consent',
            ),
        )
    indexes = {i['name'] for i in sa.inspect(bind).get_indexes(TABLE)}
    if 'ix_public_itp_generations_visitor_key' not in indexes:
        op.create_index(
            'ix_public_itp_generations_visitor_key', TABLE, ['visitor_key']
        )
    if 'ix_public_itp_generations_created_at' not in indexes:
        op.create_index(
            'ix_public_itp_generations_created_at', TABLE, ['created_at']
        )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE not in inspector.get_table_names():
        return
    count = bind.execute(sa.text(f'SELECT count(*) FROM {TABLE}')).scalar()
    if count:
        raise RuntimeError(
            f'Refusing to downgrade b7d4e1f9a206: {count} public ITP generator '
            'request(s) are logged (the usage record). Export them before '
            'downgrading.'
        )
    op.drop_table(TABLE)
