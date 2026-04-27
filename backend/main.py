from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy import text

from app.auth import ensure_admin_user
from app.config import get_settings
from app.database import Base, SessionLocal, engine, ensure_runtime_schema
from app.motive import motive_snapshot_runtime_status, start_motive_snapshot_refresh_worker, stop_motive_snapshot_refresh_worker
from app.official_stations import (
    live_price_runtime_status,
    start_live_price_refresh_workers,
    start_station_catalog_refresh_if_needed,
    station_catalog_runtime_status,
    stop_live_price_refresh_workers,
)
from app.relay_discounts import relay_discount_runtime_status
from app.routes import activity, admin, auth, chat, driver, fuel_authorizations, full_road, loads, motive, navigation, planner, relay_discounts, safety

import app.models  # noqa: F401


settings = get_settings()


def _bootstrap_database() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_runtime_schema()
    with SessionLocal() as db:
        ensure_admin_user(db)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _bootstrap_database()
    start_station_catalog_refresh_if_needed()
    start_live_price_refresh_workers()
    start_motive_snapshot_refresh_worker(settings)
    try:
        yield
    finally:
        stop_motive_snapshot_refresh_worker()
        stop_live_price_refresh_workers()


def create_app() -> FastAPI:
    app = FastAPI(
        title="United Lane System API",
        version="1.0.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list or ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(GZipMiddleware, minimum_size=max(256, settings.gzip_minimum_size))

    api = APIRouter(prefix="/api")

    @api.get("/health")
    def health_check():
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Database health check failed: {exc}",
            ) from exc

        return {
            "status": "ok",
            "database": settings.database_backend,
            "stationCatalog": station_catalog_runtime_status(),
            "livePrices": live_price_runtime_status(),
            "relayDiscounts": relay_discount_runtime_status(),
            "motive": motive_snapshot_runtime_status(),
        }

    api.include_router(auth.router)
    api.include_router(activity.router)
    api.include_router(admin.router)
    api.include_router(chat.router)
    api.include_router(driver.router)
    api.include_router(fuel_authorizations.router)
    api.include_router(full_road.router)
    api.include_router(loads.router)
    api.include_router(motive.router)
    api.include_router(navigation.router)
    api.include_router(planner.router)
    api.include_router(relay_discounts.router)
    api.include_router(safety.router)

    app.include_router(api)

    @app.get("/")
    def root():
        return {
            "name": "United Lane System API",
            "docs": "/docs",
            "health": "/api/health",
        }

    return app


app = create_app()
