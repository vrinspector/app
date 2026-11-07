"""Remove template local user table (identity moves to Auth0)

VR Inspector rebuild increment 02: the full-stack template's password-based
user table is dropped. Identity is provided by Auth0 (the access token's `sub`
is the anchor); there is no local users table. Domain tables arrive with the
increment 03 baseline.

Revision ID: 3f1c2d9a8b70
Revises: 7b2f4c1d9e10
Create Date: 2026-11-07 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = '3f1c2d9a8b70'
down_revision = '7b2f4c1d9e10'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_index(op.f('ix_user_email'), table_name='user')
    op.drop_table('user')


def downgrade():
    op.create_table(
        'user',
        sa.Column('email', sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('is_superuser', sa.Boolean(), nullable=False),
        sa.Column('full_name', sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('hashed_password', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_user_email'), 'user', ['email'], unique=True)
