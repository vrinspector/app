from sqlmodel import create_engine

from app.core.config import settings

# make sure all SQLModel models are imported (app.models) before initializing DB
# otherwise, SQLModel might fail to initialize relationships properly
# for more details: https://github.com/fastapi/full-stack-fastapi-template/issues/28
engine = create_engine(str(settings.DATABASE_URL), pool_pre_ping=True)

# Tables are created and evolved with Alembic migrations (scripts/prestart.sh).
# There is no seed data: identity lives in Auth0, not in a local users table.
