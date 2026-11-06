"""Remove template example Item table

VR Inspector rebuild increment 01: the full-stack template's example "items"
feature is stripped. Domain tables arrive with the increment 03 baseline.

Revision ID: 7b2f4c1d9e10
Revises: fe56fa70289e
Create Date: 2026-11-06 20:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = '7b2f4c1d9e10'
down_revision = 'fe56fa70289e'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_table('item')


def downgrade():
    op.create_table(
        'item',
        sa.Column('title', sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column('description', sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('owner_id', sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
