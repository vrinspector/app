-- ============================================================================
-- VR Inspector — legacy staging schema, RECONSTRUCTED (not a pg_dump)
-- ============================================================================
-- Purpose: a stand-in for "a copy of the real schema" so the increment 03
-- Alembic baseline can be exercised against a database that already holds the
-- Block 1–8E tables (created on staging without Alembic). The test suite loads
-- this file into a scratch database and then runs `alembic upgrade head`.
--
-- Provenance:
--   * drawings, inspection_pins — PRD v2.59 "Database Schema — Block 8D
--     (deployed)" tables + the Block 8E migration (block8e_migration.sql) and
--     the deployed router's INSERT column lists (staging_drawings_block8e.py).
--   * projects, inspections, findings, photos, project_members — inferred from
--     the deployed single-file SPA's request/response field names
--     (staging_index_with_help_private.html) and the membership join in the
--     deployed drawings router (`project_members.user_email`). Column types
--     and lengths for these five tables are assumptions; see docs/DATA_MODEL.md.
--
-- REPLACE THIS FILE with `pg_dump --schema-only --no-owner --no-privileges`
-- of the staging database (an owner action; it contains no secrets) so the
-- baseline is verified against the real DDL. The test does not depend on the
-- exact types here beyond what the baseline migration reconciles.
-- ============================================================================

CREATE TABLE IF NOT EXISTS projects (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    client      VARCHAR(255),
    location    VARCHAR(255),
    status      VARCHAR(20) NOT NULL DEFAULT 'active',
    created_by  VARCHAR(255),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_members (
    id          SERIAL PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_email  VARCHAR(255) NOT NULL,
    role        VARCHAR(20) NOT NULL DEFAULT 'inspector',
    invited_by  VARCHAR(255),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, user_email)
);

CREATE TABLE IF NOT EXISTS inspections (
    id                SERIAL PRIMARY KEY,
    project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title             VARCHAR(255) NOT NULL,
    inspection_type   VARCHAR(30),
    inspector         VARCHAR(255),
    notes             TEXT,
    status            VARCHAR(20) NOT NULL DEFAULT 'open',
    inspection_status VARCHAR(20) NOT NULL DEFAULT 'open',
    signed_off_by     VARCHAR(255),
    signed_off_at     TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS findings (
    id               SERIAL PRIMARY KEY,
    inspection_id    INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    title            VARCHAR(255) NOT NULL,
    description      TEXT,
    priority         VARCHAR(10) NOT NULL DEFAULT 'medium',
    location_ref     VARCHAR(255),
    status           VARCHAR(20) NOT NULL DEFAULT 'open',
    resolved_by      VARCHAR(255),
    resolved_at      TIMESTAMPTZ,
    resolution_notes TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS photos (
    id            SERIAL PRIMARY KEY,
    inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    s3_key        VARCHAR(512) NOT NULL,
    filename      VARCHAR(255),
    uploaded_by   VARCHAR(255),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Block 8D (PRD v2.59, deployed) — before the Block 8E R6 columns
CREATE TABLE IF NOT EXISTS drawings (
    id             SERIAL PRIMARY KEY,
    project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title          VARCHAR(255) NOT NULL,
    drawing_number VARCHAR(100),
    discipline     VARCHAR(30) NOT NULL DEFAULT 'general',
    filename       VARCHAR(255) NOT NULL,
    s3_key         VARCHAR(512) NOT NULL,
    file_type      VARCHAR(16) NOT NULL DEFAULT 'png',
    file_size      BIGINT,
    view_url       TEXT,
    thumbnail_url  TEXT,
    uploaded_by    VARCHAR(255),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Block 8D (PRD v2.59, deployed) — before Block 8E added page_number
CREATE TABLE IF NOT EXISTS inspection_pins (
    id              SERIAL PRIMARY KEY,
    drawing_id      INTEGER NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
    finding_id      INTEGER REFERENCES findings(id) ON DELETE SET NULL,
    tag_number      VARCHAR(100),
    label           VARCHAR(255),
    x_pct           NUMERIC(6,3) NOT NULL,
    y_pct           NUMERIC(6,3) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'not_started',
    notes           TEXT,
    discipline_data JSONB,
    created_by      VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Block 8E migration (applied to RDS 2026-07-15, idempotent) — byte-exact
-- statements from staging_snapshot_20260716/block8e_migration.sql
ALTER TABLE inspection_pins
  ADD COLUMN IF NOT EXISTS page_number INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN inspection_pins.page_number IS
  'PDF page number (1-indexed). Always 1 for raster images. Added in Block 8E.';

ALTER TABLE drawings ADD COLUMN IF NOT EXISTS page_width_pts NUMERIC;
ALTER TABLE drawings ADD COLUMN IF NOT EXISTS page_height_pts NUMERIC;
