"""AI capture assistance: suggestion log + photo filing + finding discipline (rebuild increment 15)

PRD v2.62 Block 10A (photo analysis) / 10B (voice-to-finding) and their
guardrails — AI text is a draft until confirmed, and the prompt and model
version are logged per finding. All additive, all guarded, idempotent on
upgrade:

1. ``ai_suggestions`` — one row per model call: kind (photo / voice), status
   (draft / confirmed / dismissed / failed), project, inspection, photo
   (SET NULL), model version, prompt version, the exact system and user
   prompt text, the transcript (10B), the draft JSON or the error, token
   counts, who asked, who decided and when, and whether the inspector edited
   the draft before confirming.
2. ``findings.discipline`` (VARCHAR(40), nullable) and
   ``findings.ai_suggestion_id`` (FK ``ai_suggestions.id`` ON DELETE SET NULL,
   partial unique index: a draft backs at most one finding).
3. ``photos.category``, ``photos.defect_tags`` (JSONB), ``photos.severity``,
   ``photos.tags_confirmed_by`` / ``_at`` and ``photos.ai_suggestion_id``
   (FK, SET NULL) — how the inspector filed the photo.

Downgrade refuses while any AI suggestion is recorded (the log is the
defensibility record) or any photo has been filed.

Revision ID: f1c7a3e8b524
Revises: e4a7c9b2d816
Create Date: 2026-11-12 08:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'f1c7a3e8b524'
down_revision = 'e4a7c9b2d816'
branch_labels = None
depends_on = None


def _columns(inspector, table):
    return {c['name'] for c in inspector.get_columns(table)}


def _indexes(inspector, table):
    return {i['name'] for i in inspector.get_indexes(table)}


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table('ai_suggestions'):
        op.create_table(
            'ai_suggestions',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                'public_id',
                postgresql.UUID(as_uuid=True),
                nullable=False,
                unique=True,
                server_default=sa.text('gen_random_uuid()'),
            ),
            sa.Column('kind', sa.String(length=10), nullable=False),
            sa.Column(
                'status',
                sa.String(length=20),
                nullable=False,
                server_default=sa.text("'draft'"),
            ),
            sa.Column(
                'project_id',
                sa.Integer(),
                sa.ForeignKey('projects.id', ondelete='CASCADE'),
                nullable=False,
            ),
            sa.Column(
                'inspection_id',
                sa.Integer(),
                sa.ForeignKey('inspections.id', ondelete='CASCADE'),
                nullable=False,
            ),
            sa.Column(
                'photo_id',
                sa.Integer(),
                sa.ForeignKey('photos.id', ondelete='SET NULL'),
                nullable=True,
            ),
            sa.Column('model', sa.String(length=100), nullable=False),
            sa.Column('prompt_version', sa.String(length=40), nullable=False),
            sa.Column('system_prompt', sa.Text(), nullable=False),
            sa.Column('user_prompt', sa.Text(), nullable=False),
            sa.Column('input_text', sa.Text(), nullable=True),
            sa.Column('draft', postgresql.JSONB(), nullable=True),
            sa.Column('error', sa.Text(), nullable=True),
            sa.Column('input_tokens', sa.Integer(), nullable=True),
            sa.Column('output_tokens', sa.Integer(), nullable=True),
            sa.Column('edited', sa.Boolean(), nullable=True),
            sa.Column('requested_by', sa.String(length=255), nullable=False),
            sa.Column('requested_by_sub', sa.String(length=255), nullable=False),
            sa.Column('decided_by', sa.String(length=255), nullable=True),
            sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                'created_at',
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text('now()'),
            ),
            sa.CheckConstraint(
                "kind IN ('photo', 'voice')", name='ck_ai_suggestions_kind'
            ),
            sa.CheckConstraint(
                "status IN ('draft', 'confirmed', 'dismissed', 'failed')",
                name='ck_ai_suggestions_status',
            ),
        )
    indexes = _indexes(sa.inspect(bind), 'ai_suggestions')
    for column in ('project_id', 'inspection_id', 'photo_id'):
        name = f'ix_ai_suggestions_{column}'
        if name not in indexes:
            op.create_index(name, 'ai_suggestions', [column])

    columns = _columns(inspector, 'findings')
    if 'discipline' not in columns:
        op.add_column(
            'findings', sa.Column('discipline', sa.String(length=40), nullable=True)
        )
    if 'ai_suggestion_id' not in columns:
        op.add_column(
            'findings',
            sa.Column(
                'ai_suggestion_id',
                sa.Integer(),
                sa.ForeignKey('ai_suggestions.id', ondelete='SET NULL'),
                nullable=True,
            ),
        )
    if 'uq_findings_ai_suggestion' not in _indexes(inspector, 'findings'):
        op.create_index(
            'uq_findings_ai_suggestion',
            'findings',
            ['ai_suggestion_id'],
            unique=True,
            postgresql_where=sa.text('ai_suggestion_id IS NOT NULL'),
        )

    columns = _columns(inspector, 'photos')
    if 'category' not in columns:
        op.add_column(
            'photos', sa.Column('category', sa.String(length=30), nullable=True)
        )
    if 'defect_tags' not in columns:
        op.add_column(
            'photos', sa.Column('defect_tags', postgresql.JSONB(), nullable=True)
        )
    if 'severity' not in columns:
        op.add_column(
            'photos', sa.Column('severity', sa.String(length=10), nullable=True)
        )
    if 'tags_confirmed_by' not in columns:
        op.add_column(
            'photos',
            sa.Column('tags_confirmed_by', sa.String(length=255), nullable=True),
        )
    if 'tags_confirmed_at' not in columns:
        op.add_column(
            'photos',
            sa.Column('tags_confirmed_at', sa.DateTime(timezone=True), nullable=True),
        )
    if 'ai_suggestion_id' not in columns:
        op.add_column(
            'photos',
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
    if inspector.has_table('ai_suggestions'):
        count = bind.execute(sa.text('SELECT count(*) FROM ai_suggestions')).scalar()
        if count:
            raise RuntimeError(
                f'Refusing to downgrade f1c7a3e8b524: {count} AI suggestion(s) are '
                'logged (the defensibility record). Export them before downgrading.'
            )
    photo_columns = _columns(inspector, 'photos')
    if 'tags_confirmed_at' in photo_columns:
        count = bind.execute(
            sa.text(
                'SELECT count(*) FROM photos WHERE category IS NOT NULL '
                'OR defect_tags IS NOT NULL OR severity IS NOT NULL'
            )
        ).scalar()
        if count:
            raise RuntimeError(
                f'Refusing to downgrade f1c7a3e8b524: {count} photo(s) have been '
                'filed (category / defect tags / severity).'
            )
    for column in (
        'ai_suggestion_id',
        'tags_confirmed_at',
        'tags_confirmed_by',
        'severity',
        'defect_tags',
        'category',
    ):
        if column in photo_columns:
            op.drop_column('photos', column)

    finding_columns = _columns(inspector, 'findings')
    if 'discipline' in finding_columns:
        count = bind.execute(
            sa.text('SELECT count(*) FROM findings WHERE discipline IS NOT NULL')
        ).scalar()
        if count:
            raise RuntimeError(
                f'Refusing to downgrade f1c7a3e8b524: {count} finding(s) carry a '
                'discipline.'
            )
    if 'uq_findings_ai_suggestion' in _indexes(inspector, 'findings'):
        op.drop_index('uq_findings_ai_suggestion', table_name='findings')
    for column in ('ai_suggestion_id', 'discipline'):
        if column in finding_columns:
            op.drop_column('findings', column)

    if inspector.has_table('ai_suggestions'):
        op.drop_table('ai_suggestions')
