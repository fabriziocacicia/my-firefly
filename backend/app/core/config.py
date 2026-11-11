import os
from pathlib import Path
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "Firefly III Companion"
    API_V1_STR: str = "/api/v1"
    
    FIREFLY_URL: str = "http://192.168.1.25:8012"
    FIREFLY_TOKEN: str = ""
    
    DATABASE_URL: str = "sqlite:///./data/companion.db"
    STORAGE_DIR: str = "./data/receipts"
    
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://localhost:8000"

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()

# Ensure storage directory exists
Path(settings.STORAGE_DIR).mkdir(parents=True, exist_ok=True)
