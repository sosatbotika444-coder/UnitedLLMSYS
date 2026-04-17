from sqlalchemy import create_engine, event, inspect, text
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


def _execute_schema_statements(statements: list[str]) -> None:
    if not statements:
        return
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def ensure_runtime_schema() -> None:
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    if "users" not in table_names:
        return

    user_columns = {column["name"] for column in inspector.get_columns("users")}
    statements: list[str] = []

    def add_column(name: str, definition: str) -> None:
        if name not in user_columns:
            statements.append(f"ALTER TABLE users ADD COLUMN {name} {definition}")

    add_column("department", "VARCHAR(32) NOT NULL DEFAULT 'fuel'")
    add_column("username", "VARCHAR(80)")
    add_column("is_banned", "BOOLEAN NOT NULL DEFAULT FALSE" if settings.database_backend == "postgresql" else "BOOLEAN NOT NULL DEFAULT 0")
    add_column("ban_reason", "TEXT NOT NULL DEFAULT ''")
    add_column("created_at", "TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP" if settings.database_backend == "postgresql" else "DATETIME")
    add_column("updated_at", "TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP" if settings.database_backend == "postgresql" else "DATETIME")
    add_column("last_login_at", "TIMESTAMP WITH TIME ZONE" if settings.database_backend == "postgresql" else "DATETIME")

    _execute_schema_statements(statements)

    indexes = {index["name"] for index in inspector.get_indexes("users")}
    index_statements: list[str] = []
    if "ix_users_username_unique" not in indexes:
        index_statements.append("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username_unique ON users (username)")
    if "ix_users_is_banned" not in indexes:
        index_statements.append("CREATE INDEX IF NOT EXISTS ix_users_is_banned ON users (is_banned)")
    _execute_schema_statements(index_statements)
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
