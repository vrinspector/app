"""Outbound email send log (rebuild increment 13.5; Block 7.1 pulled forward)

Adds ``email_send_log``: one row per email the app tries to send (recipient,
type, subject, status queued / sent / failed / skipped, SMTP Message-ID,
error, timestamps). Purely additive — the live database sends no email and
has no such table. Idempotent on upgrade (skips a table that already exists);
downgrade refuses to drop the table while it holds rows.

Revision ID: f3b8d1c6a425
Revises: e7c2a9f4b613
Create Date: 2026-11-10 07:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'f3b8d1c6a425'
down_revision = 'e7c2a9f4b613'
branch_labels = None
depends_on = None

TABLE = 'email_send_log'


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
            'project_id',
            sa.Integer(),
            sa.ForeignKey('projects.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('email_type', sa.String(length=50), nullable=False),
        sa.Column('related_id', sa.Integer(), nullable=True),
        sa.Column('recipient', sa.String(length=320), nullable=False),
        sa.Column('subject', sa.String(length=255), nullable=False),
        sa.Column(
            'status',
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'queued'"),
        ),
        sa.Column('message_id', sa.String(length=255), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('triggered_by', sa.String(length=255), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text('now()'),
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text('now()'),
        ),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('public_id', name='email_send_log_public_id_key'),
        sa.CheckConstraint(
            "status IN ('queued', 'sent', 'failed', 'skipped')",
            name='ck_email_send_log_status',
        ),
    )
    op.create_index('ix_email_send_log_project_id', TABLE, ['project_id'])


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE not in set(inspector.get_table_names()):
        return
    count = bind.execute(sa.text(f'SELECT count(*) FROM {TABLE}')).scalar()
    if count:
        raise RuntimeError(
            f'Refusing to downgrade f3b8d1c6a425: {TABLE} holds {count} rows. '
            'Back up and truncate it deliberately before downgrading.'
        )
    op.drop_index('ix_email_send_log_project_id', table_name=TABLE)
    op.drop_table(TABLE)
