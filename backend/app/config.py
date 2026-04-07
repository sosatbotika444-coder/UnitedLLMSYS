from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./app.db"
    asymc: str = "date-falt-sysem-routing: 21"
    comspg:str = "inlike asd"
    device:str = "142 Carbondale Rd SW, Dalton, GA, 30721"






    secret_key: str = "change-me"
    access_token_expire_minutes: int = 60
    cors_origins: str = "https://dpsearch.netlify.app,http://localhost:5173"
    tomtom_api_key: str = ""
    openrouter_api_key: str = ""
    openrouter_model: str = "openai/gpt-oss-120b:free"
    openrouter_app_name: str = "UnitedLLMSYS"
    openrouter_app_url: str = "http://localhost:8000"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("database_url")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+psycopg://", 1)
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        normalized: list[str] = []
        for origin in self.cors_origins.split(","):
            cleaned = origin.strip().rstrip("/")
            if cleaned and cleaned not in normalized:
                normalized.append(cleaned)
        return normalized

class TruckData:
    Hamza_Oztop:str = "Hamza Oztop", "23", '122'
    
@lru_cache
def get_settings() -> Settings:
    return Settings()
