import os
from contextlib import asynccontextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect

from app.api.router import api_router
from app.core.config import settings
from app.core.database import create_db_and_tables, engine, auto_migrate_sqlite_columns
from app.services.firefly import firefly_client


def run_db_migrations(target_engine=engine) -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    alembic_cfg = Config(str(backend_dir / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(backend_dir / "migrations"))
    alembic_cfg.set_main_option(
        "sqlalchemy.url", target_engine.url.render_as_string(hide_password=False)
    )

    inspector = inspect(target_engine)
    has_receipt = inspector.has_table("receipt")
    has_alembic = inspector.has_table("alembic_version")
    is_memory = target_engine.url.database in (None, "", ":memory:")

    if not has_receipt:
        create_db_and_tables(target_engine)
        if is_memory:
            with target_engine.connect() as connection:
                alembic_cfg.attributes["connection"] = connection
                command.stamp(alembic_cfg, "head")
        else:
            command.stamp(alembic_cfg, "head")
        return

    if is_memory:
        with target_engine.connect() as connection:
            alembic_cfg.attributes["connection"] = connection
            if not has_alembic:
                command.stamp(alembic_cfg, "0001_pre_workbench_baseline")
            command.upgrade(alembic_cfg, "head")
        auto_migrate_sqlite_columns(target_engine)
        return

    if not has_alembic:
        command.stamp(alembic_cfg, "0001_pre_workbench_baseline")
    command.upgrade(alembic_cfg, "head")
    auto_migrate_sqlite_columns(target_engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize and migrate SQLite schema on startup
    run_db_migrations(engine)
    yield
    await firefly_client.aclose()


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    lifespan=lifespan
)

# Set up CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(api_router, prefix=settings.API_V1_STR)


@app.get("/health")
def health_check():
    return {"status": "ok", "app": settings.PROJECT_NAME}


# If frontend production build exists, serve it
frontend_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"))
if os.path.exists(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="static")
