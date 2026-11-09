"""ITP / hold-point data model and Areas (Block 9.5, rebuild increment 12)

Adds project_areas, itp_templates, project_itps, itp_items, signoff_roles,
itp_item_required_roles, external_sign_tokens and itp_signatures, plus the
nullable ``inspection_pins.itp_item_id``. Purely additive: nothing on the live
database changes shape, and existing pins stay unlinked (NULL).

Signatures are evidence, so three triggers refuse to delete a signed area,
a signed ITP or a signed item on its own. Deleting the whole project still
works: by the time the cascade reaches these rows the parent is already gone,
which is what the guards test for.

Idempotent on upgrade (skips what already exists); downgrade refuses to drop
anything while the new tables hold rows or any pin is linked.

Revision ID: e7c2a9f4b613
Revises: d5a1b7c3e902
Create Date: 2026-11-09 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'e7c2a9f4b613'
down_revision = 'd5a1b7c3e902'
branch_labels = None
depends_on = None

PINS = 'inspection_pins'
PIN_COLUMN = 'itp_item_id'
PIN_INDEX = 'ix_inspection_pins_itp_item_id'
PIN_FK = 'inspection_pins_itp_item_id_fkey'

# Children before parents, the order the downgrade drops them in.
NEW_TABLES = (
    'itp_signatures',
    'external_sign_tokens',
    'itp_item_required_roles',
    'signoff_roles',
    'itp_items',
    'project_itps',
    'itp_templates',
    'project_areas',
)

# (function, table, body of the IF test, message)
GUARDS = (
    (
        'vri_guard_area_delete',
        'project_areas',
        """EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
           AND EXISTS (
               SELECT 1 FROM itp_signatures s
               JOIN project_itps i ON i.id = s.project_itp_id
               WHERE i.area_id = OLD.id
           )""",
        'area % has signed ITPs and cannot be deleted',
    ),
    (
        'vri_guard_project_itp_delete',
        'project_itps',
        """EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
           AND EXISTS (SELECT 1 FROM itp_signatures WHERE project_itp_id = OLD.id)""",
        'project ITP % has signatures and cannot be deleted',
    ),
    (
        'vri_guard_itp_item_delete',
        'itp_items',
        """EXISTS (SELECT 1 FROM project_itps WHERE id = OLD.project_itp_id)
           AND EXISTS (SELECT 1 FROM itp_signatures WHERE itp_item_id = OLD.id)""",
        'ITP item % has signatures and cannot be deleted',
    ),
)


def _id_columns():
    return [
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            'public_id',
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text('gen_random_uuid()'),
        ),
    ]


def _timestamp(name):
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text('now()'),
    )


def _fk(name, target, ondelete, nullable=False):
    return sa.Column(
        name, sa.Integer(), sa.ForeignKey(target, ondelete=ondelete), nullable=nullable
    )


def _create(table, indexed, *columns):
    """Create ``table`` and its ``ix_<table>_<column>`` indexes unless present."""
    if table in set(sa.inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        table,
        *_id_columns(),
        *columns,
        sa.UniqueConstraint('public_id', name=f'{table}_public_id_key'),
    )
    for column in indexed:
        op.create_index(f'ix_{table}_{column}', table, [column])


def upgrade():
    _create(
        'project_areas',
        ['project_id', 'parent_area_id'],
        _fk('project_id', 'projects.id', 'CASCADE'),
        _fk('parent_area_id', 'project_areas.id', 'SET NULL', nullable=True),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column(
            'area_type',
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'other'"),
        ),
        sa.Column(
            'sort_order', sa.Integer(), nullable=False, server_default=sa.text('0')
        ),
        sa.Column('created_by', sa.String(length=255), nullable=True),
        _timestamp('created_at'),
        _timestamp('updated_at'),
    )
    _create(
        'itp_templates',
        ['template_key'],
        sa.Column(
            'template_key',
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text('gen_random_uuid()'),
        ),
        sa.Column('version', sa.Integer(), nullable=False, server_default=sa.text('1')),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column(
            'status',
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'draft'"),
        ),
        sa.Column('body', postgresql.JSONB(), nullable=False),
        sa.Column('created_by', sa.String(length=255), nullable=True),
        sa.Column('created_by_sub', sa.String(length=255), nullable=True),
        _timestamp('created_at'),
        _timestamp('updated_at'),
        sa.UniqueConstraint('template_key', 'version', name='uq_itp_templates_version'),
    )
    _create(
        'project_itps',
        ['project_id', 'area_id', 'template_id'],
        _fk('project_id', 'projects.id', 'CASCADE'),
        _fk('area_id', 'project_areas.id', 'SET NULL', nullable=True),
        _fk('template_id', 'itp_templates.id', 'SET NULL', nullable=True),
        sa.Column('template_version', sa.Integer(), nullable=True),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column(
            'status',
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'not_started'"),
        ),
        sa.Column('body', postgresql.JSONB(), nullable=False),
        sa.Column('pack_s3_key', sa.String(length=512), nullable=True),
        sa.Column('pack_version', sa.Integer(), nullable=True),
        sa.Column('created_by', sa.String(length=255), nullable=True),
        _timestamp('created_at'),
        _timestamp('updated_at'),
    )
    _create(
        'itp_items',
        ['project_itp_id'],
        _fk('project_itp_id', 'project_itps.id', 'CASCADE'),
        sa.Column('section', sa.String(length=255), nullable=True),
        sa.Column('element_name', sa.String(length=255), nullable=True),
        sa.Column('requirement', sa.Text(), nullable=False),
        sa.Column('classification', sa.String(length=20), nullable=False),
        sa.Column(
            'status',
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column(
            'sort_order', sa.Integer(), nullable=False, server_default=sa.text('0')
        ),
        _timestamp('created_at'),
        _timestamp('updated_at'),
    )
    _create(
        'signoff_roles',
        ['project_id'],
        _fk('project_id', 'projects.id', 'CASCADE'),
        sa.Column('role_name', sa.String(length=255), nullable=False),
        sa.Column('party', sa.String(length=20), nullable=False),
        sa.Column('signer_email', sa.String(length=255), nullable=True),
        _timestamp('created_at'),
        sa.UniqueConstraint('project_id', 'role_name', name='uq_signoff_roles_name'),
    )
    _create(
        'itp_item_required_roles',
        ['itp_item_id', 'signoff_role_id'],
        _fk('itp_item_id', 'itp_items.id', 'CASCADE'),
        _fk('signoff_role_id', 'signoff_roles.id', 'CASCADE'),
        sa.UniqueConstraint(
            'itp_item_id', 'signoff_role_id', name='uq_itp_item_required_role'
        ),
    )
    _create(
        'external_sign_tokens',
        ['project_itp_id', 'area_id', 'signoff_role_id'],
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        _fk('project_itp_id', 'project_itps.id', 'CASCADE', nullable=True),
        _fk('area_id', 'project_areas.id', 'CASCADE', nullable=True),
        _fk('signoff_role_id', 'signoff_roles.id', 'CASCADE'),
        sa.Column('signer_email', sa.String(length=255), nullable=False),
        sa.Column(
            'expires_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now() + interval '14 days'"),
        ),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'revoked', sa.Boolean(), nullable=False, server_default=sa.text('false')
        ),
        sa.Column('created_by', sa.String(length=255), nullable=True),
        _timestamp('created_at'),
        sa.UniqueConstraint('token_hash', name='external_sign_tokens_token_hash_key'),
        sa.CheckConstraint(
            'num_nonnulls(project_itp_id, area_id) = 1',
            name='ck_external_sign_tokens_one_document',
        ),
        sa.CheckConstraint(
            'char_length(token_hash) = 64',
            name='ck_external_sign_tokens_hash_length',
        ),
    )
    _create(
        'itp_signatures',
        ['project_itp_id', 'itp_item_id', 'signoff_role_id', 'external_token_id'],
        _fk('project_itp_id', 'project_itps.id', 'CASCADE'),
        _fk('itp_item_id', 'itp_items.id', 'CASCADE', nullable=True),
        _fk('signoff_role_id', 'signoff_roles.id', 'SET NULL', nullable=True),
        _fk('external_token_id', 'external_sign_tokens.id', 'SET NULL', nullable=True),
        sa.Column('role_name', sa.String(length=255), nullable=False),
        sa.Column('party', sa.String(length=20), nullable=False),
        sa.Column('signer_name', sa.String(length=255), nullable=True),
        sa.Column('signer_email', sa.String(length=255), nullable=False),
        sa.Column('signer_sub', sa.String(length=255), nullable=True),
        sa.Column('method', sa.String(length=20), nullable=False),
        _timestamp('signed_at'),
        sa.Column('gps_lat', sa.Numeric(9, 6), nullable=True),
        sa.Column('gps_lng', sa.Numeric(9, 6), nullable=True),
        sa.Column('weather', postgresql.JSONB(), nullable=True),
        sa.Column('signature_s3_key', sa.String(length=512), nullable=True),
    )

    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if PIN_COLUMN not in {c['name'] for c in inspector.get_columns(PINS)}:
        op.add_column(PINS, sa.Column(PIN_COLUMN, sa.Integer(), nullable=True))
    inspector = sa.inspect(bind)
    if PIN_FK not in {fk['name'] for fk in inspector.get_foreign_keys(PINS)}:
        op.create_foreign_key(
            PIN_FK, PINS, 'itp_items', [PIN_COLUMN], ['id'], ondelete='SET NULL'
        )
    if PIN_INDEX not in {ix['name'] for ix in inspector.get_indexes(PINS)}:
        op.create_index(PIN_INDEX, PINS, [PIN_COLUMN])

    for function, table, condition, message in GUARDS:
        op.execute(
            f"""
            CREATE OR REPLACE FUNCTION {function}() RETURNS trigger AS $$
            BEGIN
                IF {condition} THEN
                    RAISE EXCEPTION '{message}', OLD.id
                        USING ERRCODE = 'restrict_violation';
                END IF;
                RETURN OLD;
            END;
            $$ LANGUAGE plpgsql
            """
        )
        op.execute(f'DROP TRIGGER IF EXISTS {function} ON {table}')
        op.execute(
            f'CREATE TRIGGER {function} BEFORE DELETE ON {table} '
            f'FOR EACH ROW EXECUTE FUNCTION {function}()'
        )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names()) & set(NEW_TABLES)
    for table in sorted(existing):
        count = bind.execute(sa.text(f'SELECT count(*) FROM {table}')).scalar()
        if count:
            raise RuntimeError(
                f'Refusing to downgrade e7c2a9f4b613: {table} holds {count} rows. '
                'Back up and truncate it deliberately before downgrading.'
            )

    if PIN_COLUMN in {c['name'] for c in inspector.get_columns(PINS)}:
        linked = bind.execute(
            sa.text(f'SELECT count(*) FROM {PINS} WHERE {PIN_COLUMN} IS NOT NULL')
        ).scalar()
        if linked:
            raise RuntimeError(
                f'Refusing to downgrade e7c2a9f4b613: {linked} pin(s) are linked '
                'to ITP items. Clear inspection_pins.itp_item_id deliberately first.'
            )
        if PIN_INDEX in {ix['name'] for ix in inspector.get_indexes(PINS)}:
            op.drop_index(PIN_INDEX, table_name=PINS)
        if PIN_FK in {fk['name'] for fk in inspector.get_foreign_keys(PINS)}:
            op.drop_constraint(PIN_FK, PINS, type_='foreignkey')
        op.drop_column(PINS, PIN_COLUMN)

    for table in NEW_TABLES:
        if table in existing:
            op.drop_table(table)
    for function, _table, _condition, _message in GUARDS:
        op.execute(f'DROP FUNCTION IF EXISTS {function}()')
