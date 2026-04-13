from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import RedirectResponse

from app.config import get_settings
from app.database import Base, engine, ensure_runtime_schema
from app.motive import motive_snapshot_runtime_status, start_motive_snapshot_refresh_worker, stop_motive_snapshot_refresh_worker
from app.official_stations import live_price_runtime_status, start_live_price_refresh_workers, stop_live_price_refresh_workers
from app.routes.auth import router as auth_router
from app.routes.driver import router as driver_router
from app.routes.loads import router as loads_router
from app.routes.motive import router as motive_router
from app.routes.navigation import router as navigation_router
from app.routes.safety import router as safety_router


settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    ensure_runtime_schema()
    start_live_price_refresh_workers()
    start_motive_snapshot_refresh_worker(settings)
    try:
        yield
    finally:
        stop_motive_snapshot_refresh_worker()
        stop_live_price_refresh_workers()


app = FastAPI(title="United Lane System API", lifespan=lifespan)

app.add_middleware(
    GZipMiddleware,
    minimum_size=max(512, settings.gzip_minimum_size),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(driver_router, prefix="/api")
app.include_router(loads_router, prefix="/api")
app.include_router(navigation_router, prefix="/api")
app.include_router(motive_router, prefix="/api")
app.include_router(safety_router, prefix="/api")


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse(url="/docs")


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "database_backend": settings.database_backend,
        "compression": "gzip",
        "motive_configured": bool(settings.motive_api_key or settings.motive_access_token),
        "live_price_background_refresh": live_price_runtime_status(),
        "motive_snapshot_cache": motive_snapshot_runtime_status(),
    }
