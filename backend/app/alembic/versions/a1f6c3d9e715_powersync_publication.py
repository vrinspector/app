"""PowerSync publication for offline sync (rebuild increment 18)

PRD v2.63 Block 11: phones keep a local SQLite copy of their projects through
PowerSync, which reads the app database's changes by logical replication. It
reads only the tables named in a publication; this revision creates that
publication, ``powersync``, for exactly the tables ``powersync/sync-config.yaml``
syncs. No table, column or row changes.

* Upgrade creates the publication, or resets its table list when it already
  exists (idempotent). If the migrating role may not create publications (it
  needs CREATE on the database and ownership of the tables), it logs a warning
  and carries on, so the API still deploys; the owner then runs
  ``powersync/README.md`` → "Publication" as a privileged user at RG-3.
* Downgrade drops the publication (no data is involved).

Logical replication also needs ``wal_level = logical`` (on RDS:
``rds.logical_replication = 1``) and a role with REPLICATION for the service;
both are server settings, not migrations, and are owner actions at RG-3.

Revision ID: a1f6c3d9e715
Revises: b7d4e1f9a206
Create Date: 2026-11-14 07:00:00.000000

"""

import logging

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a1f6c3d9e715"
down_revision = "b7d4e1f9a206"
branch_labels = None
depends_on = None

PUBLICATION = "powersync"

# Frozen copy of the synced tables (tests/alembic checks it against
# powersync/sync-config.yaml). Add a table here and in the sync config
# together, in a new revision.
TABLES = (
    "projects",
    "project_members",
    "inspections",
    "findings",
    "photos",
    "drawings",
    "inspection_pins",
    "project_areas",
    "project_itps",
    "itp_items",
    "signoff_roles",
)


def upgrade():
    table_list = ", ".join(f"public.{name}" for name in TABLES)
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = '{PUBLICATION}') THEN
                EXECUTE 'ALTER PUBLICATION {PUBLICATION} SET TABLE {table_list}';
            ELSE
                EXECUTE 'CREATE PUBLICATION {PUBLICATION} FOR TABLE {table_list}';
            END IF;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE WARNING 'Publication {PUBLICATION} not created: the migrating '
                'role lacks the privilege. Offline sync needs it; see '
                'powersync/README.md (Publication).';
        END
        $$;
        """
    )
    created = (
        op.get_bind()
        .execute(
            sa.text("SELECT count(*) FROM pg_publication WHERE pubname = :name"),
            {"name": PUBLICATION},
        )
        .scalar()
    )
    if not created:
        logging.getLogger("alembic.runtime.migration").warning(
            "Publication %s not created: the migrating role lacks the privilege. "
            "Offline sync needs it; see powersync/README.md (Publication).",
            PUBLICATION,
        )


def downgrade():
    op.execute(f"DROP PUBLICATION IF EXISTS {PUBLICATION}")
