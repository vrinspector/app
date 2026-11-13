"""AI report drafting + ITP import (rebuild increment 16)

PRD v2.62 Block 10C (report drafting) and PRD v2.63 Block 10E (ITP import),
under the same guardrails as 10A / 10B: the AI text is a draft until a person
confirms it, and every call is logged with its prompt and model version. All
additive, all guarded, idempotent on upgrade:

1. ``ai_suggestions`` takes two more kinds — ``report`` (10C) and
   ``itp_import`` (10E). ``kind`` widens to VARCHAR(20). An ITP import belongs
   to the account that asked for it, not to a project or an inspection, so
   ``project_id`` / ``inspection_id`` become nullable, with a check that keeps
   them required for every other kind. New ``template_id`` (FK
   ``itp_templates.id`` ON DELETE SET NULL) records the master template a
   confirmed import became, and ``source_files`` (JSONB) lists the uploaded
   files (name, type, size and the S3 key where the original is kept).
2. ``inspection_reports.summary`` (TEXT) — the inspector's summary printed at
   the top of the report — and ``inspection_reports.ai_suggestion_id`` (FK
   ``ai_suggestions.id`` ON DELETE SET NULL) when that summary started as an
   AI draft.

Downgrade refuses while any report / import suggestion is logged or any
report carries a summary.

Revision ID: a5e2c8f4d913
Revises: f1c7a3e8b524
Create Date: 2026-11-12 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'a5e2c8f4d913'
down_revision = 'f1c7a3e8b524'
branch_labels = None
depends_on = None

OLD_KINDS = "kind IN ('photo', 'voice')"
NEW_KINDS = "kind IN ('photo', 'voice', 'report', 'itp_import')"
SCOPE = (
    "kind = 'itp_import' OR (project_id IS NOT NULL AND inspection_id IS NOT NULL)"
)


def _columns(inspector, table):
    return {c['name']: c for c in inspector.get_columns(table)}


def _checks(inspector, table):
    return {c['name']: c.get('sqltext') for c in inspector.get_check_constraints(table)}


def _indexes(inspector, table):
    return {i['name'] for i in inspector.get_indexes(table)}


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    columns = _columns(inspector, 'ai_suggestions')
    kind_type = columns['kind']['type']
    if getattr(kind_type, 'length', None) is not None and kind_type.length < 20:
        op.alter_column(
            'ai_suggestions',
            'kind',
            type_=sa.String(length=20),
            existing_type=sa.String(length=10),
            existing_nullable=False,
        )
    checks = _checks(inspector, 'ai_suggestions')
    if 'itp_import' not in str(checks.get('ck_ai_suggestions_kind') or ''):
        if 'ck_ai_suggestions_kind' in checks:
            op.drop_constraint('ck_ai_suggestions_kind', 'ai_suggestions', type_='check')
        op.create_check_constraint('ck_ai_suggestions_kind', 'ai_suggestions', NEW_KINDS)
    for column in ('project_id', 'inspection_id'):
        if not columns[column]['nullable']:
            op.alter_column(
                'ai_suggestions', column, existing_type=sa.Integer(), nullable=True
            )
    if 'ck_ai_suggestions_scope' not in checks:
        op.create_check_constraint('ck_ai_suggestions_scope', 'ai_suggestions', SCOPE)
    if 'template_id' not in columns:
        op.add_column(
            'ai_suggestions',
            sa.Column(
                'template_id',
                sa.Integer(),
                sa.ForeignKey('itp_templates.id', ondelete='SET NULL'),
                nullable=True,
            ),
        )
    if 'ix_ai_suggestions_template_id' not in _indexes(
        sa.inspect(bind), 'ai_suggestions'
    ):
        op.create_index(
            'ix_ai_suggestions_template_id', 'ai_suggestions', ['template_id']
        )
    if 'source_files' not in columns:
        op.add_column(
            'ai_suggestions',
            sa.Column('source_files', postgresql.JSONB(), nullable=True),
        )

    report_columns = _columns(inspector, 'inspection_reports')
    if 'summary' not in report_columns:
        op.add_column(
            'inspection_reports', sa.Column('summary', sa.Text(), nullable=True)
        )
    if 'ai_suggestion_id' not in report_columns:
        op.add_column(
            'inspection_reports',
            sa.Column(
                'ai_suggestion_id',
                sa.Integer(),
                sa.ForeignKey('ai_suggestions.id', ondelete='SET NULL'),
                nullable=True,
            ),
        )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    count = bind.execute(
        sa.text(
            "SELECT count(*) FROM ai_suggestions WHERE kind IN ('report', 'itp_import') "
            'OR project_id IS NULL OR inspection_id IS NULL'
        )
    ).scalar()
    if count:
        raise RuntimeError(
            f'Refusing to downgrade a5e2c8f4d913: {count} report / ITP import AI '
            'suggestion(s) are logged (the defensibility record). Export them '
            'before downgrading.'
        )
    report_columns = _columns(inspector, 'inspection_reports')
    if 'summary' in report_columns:
        count = bind.execute(
            sa.text(
                'SELECT count(*) FROM inspection_reports WHERE summary IS NOT NULL'
            )
        ).scalar()
        if count:
            raise RuntimeError(
                f'Refusing to downgrade a5e2c8f4d913: {count} report version(s) '
                'carry an inspector summary.'
            )
    for column in ('ai_suggestion_id', 'summary'):
        if column in report_columns:
            op.drop_column('inspection_reports', column)

    columns = _columns(inspector, 'ai_suggestions')
    if 'source_files' in columns:
        op.drop_column('ai_suggestions', 'source_files')
    if 'ix_ai_suggestions_template_id' in _indexes(inspector, 'ai_suggestions'):
        op.drop_index('ix_ai_suggestions_template_id', table_name='ai_suggestions')
    if 'template_id' in columns:
        op.drop_column('ai_suggestions', 'template_id')
    checks = _checks(inspector, 'ai_suggestions')
    if 'ck_ai_suggestions_scope' in checks:
        op.drop_constraint('ck_ai_suggestions_scope', 'ai_suggestions', type_='check')
    for column in ('project_id', 'inspection_id'):
        if columns[column]['nullable']:
            op.alter_column(
                'ai_suggestions', column, existing_type=sa.Integer(), nullable=False
            )
    if 'ck_ai_suggestions_kind' in checks:
        op.drop_constraint('ck_ai_suggestions_kind', 'ai_suggestions', type_='check')
    op.create_check_constraint('ck_ai_suggestions_kind', 'ai_suggestions', OLD_KINDS)
    op.alter_column(
        'ai_suggestions',
        'kind',
        type_=sa.String(length=10),
        existing_type=sa.String(length=20),
        existing_nullable=False,
    )
