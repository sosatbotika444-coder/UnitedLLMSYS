from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import get_settings


settings = get_settings()

engine_kwargs: dict[str, object] = {
    "future": True,
    "pool_pre_ping": True,
}

if settings.database_backend == "sqlite":
    engine_kwargs["connect_args"] = {
        "check_same_thread": False,
        "timeout": max(5, settings.sqlite_busy_timeout_ms / 1000),
    }
else:
    engine_kwargs.update({
        "pool_size": max(5, settings.database_pool_size),
        "max_overflow": max(0, settings.database_max_overflow),
        "pool_timeout": max(5, settings.database_pool_timeout_seconds),
        "pool_recycle": max(300, settings.database_pool_recycle_seconds),
        "pool_use_lifo": True,
    })

engine = create_engine(settings.database_url, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, expire_on_commit=False, bind=engine)


if settings.database_backend == "sqlite":
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
        cursor.execute(f"PRAGMA busy_timeout={max(5000, settings.sqlite_busy_timeout_ms)};")
        cursor.execute("PRAGMA foreign_keys=ON;")
        cursor.execute("PRAGMA temp_store=MEMORY;")
        cursor.close()


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
