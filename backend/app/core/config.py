from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]
ROOT_DIR = BASE_DIR.parent


class Settings(BaseSettings):
    app_name: str = "IterateDesk"
    app_env: str = "development"

    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    cors_origin_regex: str = r"https://.*\.vercel\.app"

    llm_provider_order: str = "openai,anthropic,groq,gemini"
    llm_timeout_seconds: float = 25.0
    llm_cooldown_seconds: float = 60.0

    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_fallback_models: str = "gpt-4.1-mini"

    anthropic_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("ANTHROPIC_API_KEY", "ANTORPIC_API_KEY"),
    )
    anthropic_model: str = "claude-haiku-5-5"
    anthropic_fallback_models: str = "claude-haiku-4-5"

    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b"
    groq_fallback_models: str = "openai/gpt-oss-20b,qwen/qwen3.8-27b,llama-3.3-70b-versatile"

    gemini_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("GEMINI_API_KEY", "GOOGLE_API_KEY"),
    )
    gemini_model: str = "gemini-3.5-flash"
    gemini_fallback_models: str = "gemini-3.1-flash-lite,gemini-flash-lite-latest"

    tavily_api_key: str = ""

    pinecone_api_key: str = ""
    pinecone_index_name: str = "iteratedesk-it-kb"
    pinecone_namespace: str = "company-it-kb"
    pinecone_cloud: str = "aws"
    pinecone_region: str = "us-east-1"

    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_cache_dir: str = str(BASE_DIR / ".cache" / "fastembed")

    top_k: int = 4
    max_retries: int = 1
    chunk_size: int = 900
    chunk_overlap: int = 120
    max_upload_mb: int = 15
    auto_seed_kb: bool = True
    rate_limit_per_minute: int = 20

    admin_api_key: str = Field(
        default="change-me",
        validation_alias=AliasChoices("ADMIN_API_KEY", "ADMIN_KEY"),
    )

    audit_db_path: str = str(BASE_DIR / "data" / "audit.db")
    upload_dir: str = str(BASE_DIR / "uploads")
    sample_kb_dir: str = str(BASE_DIR / "data" / "sample_kb")

    model_config = SettingsConfigDict(
        env_file=(str(ROOT_DIR / ".env"), str(BASE_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    @property
    def provider_order(self) -> list[str]:
        return [p.strip().lower() for p in self.llm_provider_order.split(",") if p.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
