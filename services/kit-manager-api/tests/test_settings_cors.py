from app.settings import Settings


def test_cors_origins_defaults_to_wildcard_when_unset(monkeypatch):
    monkeypatch.delenv("KIT_MANAGER_CORS_ORIGINS", raising=False)

    settings = Settings.from_env()

    assert settings.cors_origins == ["*"]


def test_cors_origins_parses_comma_separated_allowlist(monkeypatch):
    monkeypatch.setenv("KIT_MANAGER_CORS_ORIGINS", "https://a.com,https://b.com")

    settings = Settings.from_env()

    assert settings.cors_origins == ["https://a.com", "https://b.com"]


def test_cors_origins_empty_string_falls_back_to_wildcard(monkeypatch):
    monkeypatch.setenv("KIT_MANAGER_CORS_ORIGINS", "")

    settings = Settings.from_env()

    assert settings.cors_origins == ["*"]
