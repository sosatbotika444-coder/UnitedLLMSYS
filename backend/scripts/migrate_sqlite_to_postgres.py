from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine, delete, func, inspect, select, text
from sqlalchemy.orm import sessionmaker

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

from app.config import get_settings
from app.database import Base
from app.models import Load, RoutingFuelStop, RoutingRequest, RoutingRoute, User

MODELS_IN_ORDER = [User, Load, RoutingRequest, RoutingRoute, RoutingFuelStop]


def normalize_database_url(value: str) -> str:
    if value.startswith("postgresql://"):
        return value.replace("postgresql://", "postgresql+psycopg://", 1)
    if value.startswith("postgres://"):
        return value.replace("postgres://", "postgresql+psycopg://", 1)
    return value


def row_payload(instance, model):
    payload = {}
    for column in model.__table__.columns:
        payload[column.name] = getattr(instance, column.name)
    return payload


def reset_postgres_sequence(session, table_name: str, column_name: str = "id"):
    session.execute(
        text(
            f"SELECT setval(pg_get_serial_sequence('\"{table_name}\"', '{column_name}'), COALESCE(MAX({column_name}), 1), MAX({column_name}) IS NOT NULL) FROM \"{table_name}\""
        )
    )


def migrate(source_sqlite_url: str, target_postgres_url: str, truncate: bool):
    source_engine = create_engine(source_sqlite_url, future=True)
    target_engine = create_engine(normalize_database_url(target_postgres_url), future=True)

    SourceSession = sessionmaker(bind=source_engine, autoflush=False, autocommit=False, expire_on_commit=False)
    TargetSession = sessionmaker(bind=target_engine, autoflush=False, autocommit=False, expire_on_commit=False)

    Base.metadata.create_all(bind=target_engine)

    source_tables = set(inspect(source_engine).get_table_names())

    with SourceSession() as source_session, TargetSession() as target_session:
        if truncate:
            for model in reversed(MODELS_IN_ORDER):
                target_session.execute(delete(model))
            target_session.commit()

        for model in MODELS_IN_ORDER:
            if model.__tablename__ not in source_tables:
                print(f"{model.__tablename__}: source table missing, skipped")
                continue

            rows = source_session.scalars(select(model).order_by(model.id.asc())).all()
            if not rows:
                print(f"{model.__tablename__}: 0 rows")
                continue

            existing_ids = set(target_session.scalars(select(model.id)).all())
            inserted = 0
            for row in rows:
                payload = row_payload(row, model)
                if payload.get("id") in existing_ids:
                    continue
                target_session.add(model(**payload))
                inserted += 1

            target_session.commit()
            print(f"{model.__tablename__}: inserted {inserted} rows")

        for model in MODELS_IN_ORDER:
            if "id" in model.__table__.columns:
                reset_postgres_sequence(target_session, model.__tablename__)
        target_session.commit()

        summary = {model.__tablename__: target_session.scalar(select(func.count()).select_from(model)) or 0 for model in MODELS_IN_ORDER}
        print("migration-summary")
        for table_name, count in summary.items():
            print(f"  {table_name}: {count}")


def main():
    parser = argparse.ArgumentParser(description="Migrate current SQLite data into PostgreSQL")
    parser.add_argument(
        "--source-sqlite",
        default=f"sqlite:///{(PROJECT_ROOT / 'app.db').as_posix()}",
        help="SQLite source URL. Default points to backend/app.db",
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
