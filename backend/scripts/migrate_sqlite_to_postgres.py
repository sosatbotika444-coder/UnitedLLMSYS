from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from sqlalchemy import JSON, MetaData, Table, create_engine, delete, func, inspect, select, text
from sqlalchemy.orm import sessionmaker

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.append(str(BACKEND_ROOT))

from app.config import get_settings
from app.database import Base
import app.models  # noqa: F401

TABLES_IN_ORDER = list(Base.metadata.sorted_tables)


def normalize_database_url(value: str) -> str:
    if value.startswith("postgresql://"):
        return value.replace("postgresql://", "postgresql+psycopg://", 1)
    if value.startswith("postgres://"):
        return value.replace("postgres://", "postgresql+psycopg://", 1)
    return value


def default_sqlite_path() -> Path:
    candidates = [BACKEND_ROOT / "app.db", REPO_ROOT / "app.db"]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def coerce_value(value, target_column):
    if value is None:
        return None
    if isinstance(target_column.type, JSON) and isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def should_omit_value(value, target_column) -> bool:
    if value is not None:
        return False
    return not target_column.nullable and (target_column.default is not None or target_column.server_default is not None)


def reset_postgres_sequence(session, table_name: str, column_name: str = "id"):
    session.execute(
        text(
            f"SELECT setval(pg_get_serial_sequence('\"{table_name}\"', '{column_name}'), COALESCE(MAX({column_name}), 1), MAX({column_name}) IS NOT NULL) FROM \"{table_name}\""
        )
    )


def reflected_source_table(source_engine, table_name: str) -> Table:
    metadata = MetaData()
    return Table(table_name, metadata, autoload_with=source_engine)


def migrate(source_sqlite_url: str, target_postgres_url: str, truncate: bool):
    source_engine = create_engine(source_sqlite_url, future=True)
    target_engine = create_engine(normalize_database_url(target_postgres_url), future=True)

    SourceSession = sessionmaker(bind=source_engine, autoflush=False, autocommit=False, expire_on_commit=False)
    TargetSession = sessionmaker(bind=target_engine, autoflush=False, autocommit=False, expire_on_commit=False)

    Base.metadata.create_all(bind=target_engine)

    source_tables = set(inspect(source_engine).get_table_names())

    with SourceSession() as source_session, TargetSession() as target_session:
        if truncate:
            for table in reversed(TABLES_IN_ORDER):
                target_session.execute(delete(table))
            target_session.commit()

        for target_table in TABLES_IN_ORDER:
            table_name = target_table.name
            if table_name not in source_tables:
                print(f"{table_name}: source table missing, skipped")
                continue

            source_table = reflected_source_table(source_engine, table_name)
            source_column_names = {column.name for column in source_table.columns}
            common_column_names = [column.name for column in target_table.columns if column.name in source_column_names]
            if not common_column_names:
                print(f"{table_name}: no shared columns, skipped")
                continue

            statement = select(source_table)
            if "id" in source_column_names:
                statement = statement.order_by(source_table.c.id.asc())
            rows = source_session.execute(statement).all()
            if not rows:
                print(f"{table_name}: 0 rows")
                continue

            existing_ids = set()
            if "id" in target_table.columns and "id" in common_column_names:
                existing_ids = set(target_session.scalars(select(target_table.c.id)).all())

            inserted = 0
            for row in rows:
                row_mapping = row._mapping
                payload = {}
                for column_name in common_column_names:
                    target_column = target_table.c[column_name]
                    value = coerce_value(row_mapping[column_name], target_column)
                    if should_omit_value(value, target_column):
                        continue
                    payload[column_name] = value
                if "id" in payload and payload["id"] in existing_ids:
                    continue
                target_session.execute(target_table.insert().values(**payload))
                inserted += 1

            target_session.commit()
            print(f"{table_name}: inserted {inserted} rows")

        if target_engine.dialect.name == "postgresql":
            for table in TABLES_IN_ORDER:
                if "id" in table.columns:
                    reset_postgres_sequence(target_session, table.name)
            target_session.commit()

        summary = {table.name: target_session.scalar(select(func.count()).select_from(table)) or 0 for table in TABLES_IN_ORDER}
        print("migration-summary")
        for table_name, count in summary.items():
            print(f"  {table_name}: {count}")


def main():
    parser = argparse.ArgumentParser(description="Migrate current SQLite data into PostgreSQL")
    parser.add_argument(
        "--source-sqlite",
        default=f"sqlite:///{default_sqlite_path().as_posix()}",
        help="SQLite source URL. Default uses backend/app.db, or repo-root app.db if that is the existing local database.",
    )
    parser.add_argument(
        "--target-url",
        default=get_settings().database_url,
        help="PostgreSQL DATABASE_URL. Defaults to backend settings DATABASE_URL",
    )
    parser.add_argument(
        "--truncate",
        action="store_true",
        help="Delete existing PostgreSQL rows before import",
    )
    args = parser.parse_args()

    if not args.target_url:
        raise SystemExit("DATABASE_URL is required for PostgreSQL migration.")

    migrate(args.source_sqlite, args.target_url, args.truncate)


if __name__ == "__main__":
    main()

