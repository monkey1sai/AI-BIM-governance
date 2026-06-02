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


def test_cors_origins_comma_only_falls_back_to_wildcard(monkeypatch):
    # 非空輸入但 filter 後為空(全逗號/空白)→ ["*"],避免 allow_origins=[] 擋所有 origin(Copilot review)
    monkeypatch.setenv("KIT_MANAGER_CORS_ORIGINS", ", ,")

    settings = Settings.from_env()

    assert settings.cors_origins == ["*"]
