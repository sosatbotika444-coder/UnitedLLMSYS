from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./app.db"
    database_pool_size: int = 20
    database_max_overflow: int = 40
    database_pool_timeout_seconds: int = 30
    database_pool_recycle_seconds: int = 1800
    sqlite_busy_timeout_ms: int = 15000
    gzip_minimum_size: int = 1024
    asymc: str = "date-falt-sysem-routing: 21"
    comspg: str = "inlike asd"
    device: str = "142 Carbondale Rd SW, Dalton, GA, 30721"
    secret_key: str = "change-me"
    access_token_expire_minutes: int = 60
    cors_origins: str = "https://dpsearch.netlify.app,http://localhost:5173"
    tomtom_api_key: str = ""
    openrouter_api_key: str = ""
    openrouter_model: str = "openai/gpt-oss-120b:free"
    openrouter_chat_model: str = "openai/gpt-4.1-mini"
    openrouter_chat_max_output_tokens: int = 300
    openrouter_app_name: str = "UnitedLLMSYS"
    openrouter_app_url: str = "http://localhost:8000"
    route_guidance_ai_enabled: bool = False
    route_guidance_ai_timeout_seconds: float = 4.0
    motive_api_base_url: str = "https://api.gomotive.com"
    motive_oauth_base_url: str = "https://gomotive.com"
    motive_api_key: str = ""
    motive_access_token: str = ""
    motive_refresh_token: str = ""
    motive_client_id: str = ""
    motive_client_secret: str = ""
    motive_redirect_uri: str = ""
    motive_time_zone: str = "America/New_York"
    motive_metric_units: bool = False
    motive_user_id: int | None = None
    motive_snapshot_ttl_seconds: int = 45
    motive_snapshot_stale_ttl_seconds: int = 86400
    motive_snapshot_disk_cache_enabled: bool = True
    motive_snapshot_cache_file: str = ""
    motive_background_refresh_enabled: bool = True
    motive_background_refresh_interval_seconds: int = 60
    motive_vehicle_history_days: int = 2
    live_price_background_refresh_enabled: bool = True
    live_price_cache_ttl_seconds: int = 900
    live_price_cache_stale_ttl_seconds: int = 43200
    live_price_cache_persist_seconds: int = 5
    live_price_queue_workers: int = 4
    live_price_queue_max_size: int = 2048

    model_config = SettingsConfigDict(env_file=(".env", "backend/.env"), env_file_encoding="utf-8-sig", extra="ignore")

    @field_validator("database_url")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+psycopg://", 1)
        return value

    @field_validator("motive_api_base_url", "motive_oauth_base_url")
    @classmethod
    def normalize_urls(cls, value: str) -> str:
        return value.rstrip("/")

    @property
    def cors_origin_list(self) -> list[str]:
        normalized: list[str] = []
        for origin in self.cors_origins.split(","):
            cleaned = origin.strip().rstrip("/")
            if cleaned and cleaned not in normalized:
                normalized.append(cleaned)
        return normalized

    @property
    def database_backend(self) -> str:
        lowered = self.database_url.lower()
        if lowered.startswith("sqlite"):
            return "sqlite"
        if lowered.startswith("postgresql+psycopg"):
            return "postgresql"
        return "other"


class TruckData:
    Hamza_Oztop: str = "Hamza Oztop", "23", "122"


@lru_cache
def get_settings() -> Settings:
    return Settings()
