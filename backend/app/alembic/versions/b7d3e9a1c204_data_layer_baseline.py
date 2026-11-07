"""Data layer baseline: projects, inspections, findings, photos, members, drawings, pins

VR Inspector rebuild increment 03.

This is the first migration that touches domain data, and it has to work on
two very different databases:

1. A **fresh** database (CI, local Compose, a new environment): every table is
   created from the frozen definitions below.
2. The **live staging/production database**, whose Block 1–8E tables were
   created without Alembic. There the migration must not fail on tables that
   already exist and must not drop or rewrite any data. It only *reconciles*:
   it adds the columns, indexes and constraints that are missing, with
   defaults that back-fill existing rows (`public_id`, `page_number`, …).

Either way the end state is the same schema as `app.models`. Nothing is ever
removed on upgrade.

Downgrade drops the seven domain tables, and refuses to do so if any of them
holds rows (so an accidental `alembic downgrade` on a live database stops
instead of destroying inspection records).

Revision ID: b7d3e9a1c204
Revises: 3f1c2d9a8b70
Create Date: 2026-11-07 18:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'b7d3e9a1c204'
down_revision = '3f1c2d9a8b70'
branch_labels = None
depends_on = None


# --- Frozen definitions ------------------------------------------------------
# Shared baseline columns, spelled once.

def _pk():
    return sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True)


def _public_id():
    return sa.Column(
        'public_id',
        postgresql.UUID(as_uuid=True),
        nullable=False,
        server_default=sa.text('gen_random_uuid()'),
    )


def _created_at():
    return sa.Column(
        'created_at',
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text('now()'),
    )


def _updated_at():
    return sa.Column(
        'updated_at',
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text('now()'),
    )


def _fk(name, target, *, nullable=False, ondelete='CASCADE'):
    return sa.Column(
        name,
        sa.Integer(),
        sa.ForeignKey(target, ondelete=ondelete),
        nullable=nullable,
    )


def _columns(table):
    """Column definitions per table, in creation order (parents first)."""
    if table == 'projects':
        return [
            _pk(),
            _public_id(),
            sa.Column('name', sa.String(length=255), nullable=False),
            sa.Column('client', sa.String(length=255), nullable=True),
            sa.Column('location', sa.String(length=255), nullable=True),
            sa.Column('status', sa.String(length=20), nullable=False,
                      server_default=sa.text("'active'")),
            sa.Column('created_by', sa.String(length=255), nullable=True),
            _created_at(),
            _updated_at(),
        ]
    if table == 'project_members':
        return [
            _pk(),
            _public_id(),
            _fk('project_id', 'projects.id'),
            sa.Column('user_email', sa.String(length=255), nullable=False),
            sa.Column('user_sub', sa.String(length=255), nullable=True),
            sa.Column('role', sa.String(length=20), nullable=False,
                      server_default=sa.text("'inspector'")),
            sa.Column('invited_by', sa.String(length=255), nullable=True),
            _created_at(),
        ]
    if table == 'inspections':
        return [
            _pk(),
            _public_id(),
            _fk('project_id', 'projects.id'),
            sa.Column('title', sa.String(length=255), nullable=False),
            sa.Column('inspection_type', sa.String(length=30), nullable=True),
            sa.Column('inspector', sa.String(length=255), nullable=True),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('status', sa.String(length=20), nullable=False,
                      server_default=sa.text("'open'")),
            sa.Column('inspection_status', sa.String(length=20), nullable=False,
                      server_default=sa.text("'open'")),
            sa.Column('signed_off_by', sa.String(length=255), nullable=True),
            sa.Column('signed_off_at', sa.DateTime(timezone=True), nullable=True),
            _created_at(),
            _updated_at(),
        ]
    if table == 'findings':
        return [
            _pk(),
            _public_id(),
            _fk('inspection_id', 'inspections.id'),
            sa.Column('title', sa.String(length=255), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('priority', sa.String(length=10), nullable=False,
                      server_default=sa.text("'medium'")),
            sa.Column('location_ref', sa.String(length=255), nullable=True),
            sa.Column('status', sa.String(length=20), nullable=False,
                      server_default=sa.text("'open'")),
            sa.Column('resolved_by', sa.String(length=255), nullable=True),
            sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('resolution_notes', sa.Text(), nullable=True),
            _created_at(),
            _updated_at(),
        ]
    if table == 'photos':
        return [
            _pk(),
            _public_id(),
            _fk('inspection_id', 'inspections.id'),
            sa.Column('s3_key', sa.String(length=512), nullable=False),
            sa.Column('filename', sa.String(length=255), nullable=True),
            sa.Column('content_type', sa.String(length=100), nullable=True),
            sa.Column('uploaded_by', sa.String(length=255), nullable=True),
            _created_at(),
        ]
    if table == 'drawings':
        return [
            _pk(),
            _public_id(),
            _fk('project_id', 'projects.id'),
            sa.Column('title', sa.String(length=255), nullable=False),
            sa.Column('drawing_number', sa.String(length=100), nullable=True),
            sa.Column('discipline', sa.String(length=30), nullable=False,
                      server_default=sa.text("'general'")),
            sa.Column('filename', sa.String(length=255), nullable=False),
            sa.Column('s3_key', sa.String(length=512), nullable=False),
            sa.Column('file_type', sa.String(length=16), nullable=False,
                      server_default=sa.text("'png'")),
            sa.Column('file_size', sa.BigInteger(), nullable=True),
            sa.Column('view_url', sa.Text(), nullable=True),
            sa.Column('thumbnail_url', sa.Text(), nullable=True),
            sa.Column('page_width_pts', sa.Numeric(), nullable=True),
            sa.Column('page_height_pts', sa.Numeric(), nullable=True),
            sa.Column('uploaded_by', sa.String(length=255), nullable=True),
            _created_at(),
            _updated_at(),
        ]
    if table == 'inspection_pins':
        return [
            _pk(),
            _public_id(),
            _fk('drawing_id', 'drawings.id'),
            _fk('finding_id', 'findings.id', nullable=True, ondelete='SET NULL'),
            sa.Column('tag_number', sa.String(length=100), nullable=True),
            sa.Column('label', sa.String(length=255), nullable=True),
            sa.Column('x_pct', sa.Numeric(precision=6, scale=3), nullable=False),
            sa.Column('y_pct', sa.Numeric(precision=6, scale=3), nullable=False),
            sa.Column('status', sa.String(length=20), nullable=False,
                      server_default=sa.text("'not_started'")),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('discipline_data', postgresql.JSONB(astext_type=sa.Text()),
                      nullable=True),
            sa.Column('page_number', sa.Integer(), nullable=False,
                      server_default=sa.text('1'),
                      comment='PDF page number (1-indexed). Always 1 for '
                              'raster images. Added in Block 8E.'),
            sa.Column('created_by', sa.String(length=255), nullable=True),
            _created_at(),
        ]
    raise KeyError(table)


# Parents before children so foreign keys resolve on a fresh database.
TABLES = (
    'projects',
    'project_members',
    'inspections',
    'findings',
    'photos',
    'drawings',
    'inspection_pins',
)

# (index name, table, columns, unique)
INDEXES = (
    ('ix_project_members_project_id', 'project_members', ['project_id'], False),
    ('ix_project_members_user_email', 'project_members', ['user_email'], False),
    ('ix_project_members_user_sub', 'project_members', ['user_sub'], False),
    ('ix_inspections_project_id', 'inspections', ['project_id'], False),
    ('ix_findings_inspection_id', 'findings', ['inspection_id'], False),
    ('ix_photos_inspection_id', 'photos', ['inspection_id'], False),
    ('ix_drawings_project_id', 'drawings', ['project_id'], False),
    ('ix_inspection_pins_drawing_id', 'inspection_pins', ['drawing_id'], False),
    ('ix_inspection_pins_finding_id', 'inspection_pins', ['finding_id'], False),
)

# (constraint name, table, columns)
UNIQUE_CONSTRAINTS = (
    ('uq_project_members_email', 'project_members', ['project_id', 'user_email']),
)

PUBLIC_ID_UNIQUE = 'uq_{table}_public_id'


# --- Upgrade -----------------------------------------------------------------

def _existing_unique_column_sets(inspector, table):
    sets = set()
    for uc in inspector.get_unique_constraints(table):
        sets.add(tuple(uc['column_names']))
    for ix in inspector.get_indexes(table):
        if ix.get('unique'):
            sets.add(tuple(ix['column_names']))
    return sets


def _reconcile_existing_table(inspector, table):
    """Bring a pre-Alembic (legacy) table up to the baseline without data loss.

    Adds missing columns only. Every column the rebuild introduces is either
    nullable or has a server default, so existing rows are back-filled in
    place (``public_id`` gets a fresh UUID per row; ``page_number`` becomes 1).
    Columns that already exist are left exactly as they are: the legacy SQL is
    the spec, so their live types win over the frozen definitions here.
    """
    existing = {c['name'] for c in inspector.get_columns(table)}
    for column in _columns(table):
        if column.name in existing:
            continue
        # A detached copy: the frozen column objects above are bound to a
        # Table once used in create_table; op.add_column needs a fresh one.
        op.add_column(table, column.copy())

    unique_sets = _existing_unique_column_sets(inspector, table)
    if ('public_id',) not in unique_sets:
        op.create_unique_constraint(
            PUBLIC_ID_UNIQUE.format(table=table), table, ['public_id']
        )


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    for table in TABLES:
        if table in existing_tables:
            _reconcile_existing_table(inspector, table)
        else:
            op.create_table(
                table,
                *_columns(table),
                sa.UniqueConstraint(
                    'public_id', name=PUBLIC_ID_UNIQUE.format(table=table)
                ),
            )

    # Refresh after DDL so the index / constraint checks see the new state.
    inspector = sa.inspect(bind)

    for name, table, columns, unique in INDEXES:
        present = {ix['name'] for ix in inspector.get_indexes(table)}
        if name not in present:
            op.create_index(name, table, columns, unique=unique)

    for name, table, columns in UNIQUE_CONSTRAINTS:
        if tuple(columns) not in _existing_unique_column_sets(inspector, table):
            op.create_unique_constraint(name, table, columns)


# --- Downgrade ---------------------------------------------------------------

def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    # Data-loss guard: never drop populated domain tables (a live database
    # predates Alembic; its tables were not created by this migration).
    populated = []
    for table in TABLES:
        if table in existing_tables:
            count = bind.execute(sa.text(f'SELECT count(*) FROM {table}')).scalar()
            if count:
                populated.append(f'{table} ({count} rows)')
    if populated:
        raise RuntimeError(
            'Refusing to downgrade b7d3e9a1c204: these tables hold data: '
            + ', '.join(populated)
            + '. Back up and truncate them deliberately before downgrading.'
        )

    for table in reversed(TABLES):
        if table in existing_tables:
            op.drop_table(table)
