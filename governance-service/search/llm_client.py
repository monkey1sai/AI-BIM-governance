"""Ornith / OpenAI-compatible chat client for A4 NL → structured filters.

Secrets MUST come from environment only (never hardcode keys in repo):
  A4_LLM_BASE_URL   default http://192.168.10.248:18080/v1
  A4_LLM_API_KEY    or ORNITH_API_KEY
  A4_LLM_MODEL      default Ornith-1.0-35B
  A4_LLM_TIMEOUT_S  default 120
  A4_LLM_ENABLED    default true when key present, else false
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Optional


DEFAULT_BASE_URL = "http://192.168.10.248:18080/v1"
DEFAULT_MODEL = "Ornith-1.0-35B"

SYSTEM_PROMPT = """你是 BIM/IFC 語意查詢解譯器。只把使用者問句轉成 JSON 過濾條件，禁止聊天。
硬性規則：
1. 只輸出一個 JSON 物件，不要 markdown 代碼塊、不要解釋文字。
2. schema:
{
  "ifc_classes": ["IfcDoor", ...],
  "storey_tokens": ["4F", "1", ...],
  "property_filters": [{"name":"FireRating","op":"<","value":60}],
  "name_contains": ["可選關鍵字"],
  "notes": ["可選說明"]
}
3. op 只能是 <, <=, >, >=, ==。
4. ifc_classes 必須是合法 Ifc* 型別名（如 IfcDoor/IfcWall/IfcColumn/IfcBeam/IfcSlab/IfcWindow/IfcSpace）。
5. 不得捏造不存在的 IFC class 或亂填 property；不確定就留空陣列並在 notes 說明。
6. 繁中樓層「四樓/4F/FL4」→ storey_tokens 含 "4" 與 "4F"。
7. 「防火門」→ IfcDoor；「牆」→ IfcWall；「柱」→ IfcColumn。
"""


@dataclass(frozen=True)
class LlmConfig:
    base_url: str
    api_key: str
    model: str
    timeout_s: float
    enabled: bool

    @property
    def chat_url(self) -> str:
        return self.base_url.rstrip("/") + "/chat/completions"

    def public_status(self) -> dict[str, Any]:
        # Always surface configured/default base_url + model (from env.sample LAN defaults)
        # so operators can see where Ornith should be even before key is set.
        # Never echo api_key.
        return {
            "enabled": self.enabled,
            "configured": bool(self.api_key),
            "base_url": self.base_url,
            "model": self.model,
            "timeout_s": self.timeout_s,
            "auth": "bearer_env" if self.api_key else "missing",
            "defaults": {
                "base_url": DEFAULT_BASE_URL,
                "model": DEFAULT_MODEL,
            },
        }


def load_llm_config() -> LlmConfig:
    base = (
        os.environ.get("A4_LLM_BASE_URL")
        or os.environ.get("ORNITH_API_BASE")
        or DEFAULT_BASE_URL
    ).rstrip("/")
    key = (
        os.environ.get("A4_LLM_API_KEY")
        or os.environ.get("ORNITH_API_KEY")
        or ""
    ).strip()
    model = os.environ.get("A4_LLM_MODEL") or os.environ.get("ORNITH_MODEL") or DEFAULT_MODEL
    timeout_s = float(os.environ.get("A4_LLM_TIMEOUT_S") or "120")
    enabled_raw = (os.environ.get("A4_LLM_ENABLED") or "").strip().lower()
    if enabled_raw in ("0", "false", "no", "off"):
        enabled = False
    elif enabled_raw in ("1", "true", "yes", "on"):
        enabled = True
    else:
        enabled = bool(key)
    return LlmConfig(base_url=base, api_key=key, model=model, timeout_s=timeout_s, enabled=enabled and bool(key))


class LlmError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def chat_completion(
    *,
    user_content: str,
    system_content: str = SYSTEM_PROMPT,
    config: Optional[LlmConfig] = None,
    temperature: float = 0.0,
    max_tokens: int = 512,
) -> str:
    cfg = config or load_llm_config()
    if not cfg.enabled:
        raise LlmError("llm_disabled", "A4 LLM is not enabled or API key missing (set ORNITH_API_KEY / A4_LLM_API_KEY).")
    if not cfg.api_key:
        raise LlmError("llm_key_missing", "A4 LLM API key not configured.")

    payload = {
        "model": cfg.model,
        "messages": [
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content},
        ],
        "stream": False,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        cfg.chat_url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cfg.api_key}",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=cfg.timeout_s) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:500]
        raise LlmError("llm_http_error", f"LLM HTTP {exc.code}: {body}") from exc
    except urllib.error.URLError as exc:
        raise LlmError("llm_network_error", f"LLM network error: {exc.reason}") from exc
    except TimeoutError as exc:
        raise LlmError("llm_timeout", f"LLM timed out after {cfg.timeout_s}s") from exc

    try:
        doc = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LlmError("llm_bad_json", "LLM response is not JSON") from exc

    choices = doc.get("choices") or []
    if not choices:
        raise LlmError("llm_empty", "LLM returned no choices")
    message = (choices[0] or {}).get("message") or {}
    content = message.get("content")
    if not content or not str(content).strip():
        # Some models put text in reasoning fields; still fail honestly.
        raise LlmError("llm_empty_content", "LLM message content empty")
    return str(content).strip()


def extract_json_object(text: str) -> dict[str, Any]:
    """Parse model text into a JSON object; tolerate optional ``` fences."""
    cleaned = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", cleaned, re.IGNORECASE)
    if fence:
        cleaned = fence.group(1).strip()
    try:
        val = json.loads(cleaned)
        if isinstance(val, dict):
            return val
    except json.JSONDecodeError:
        pass
    # Find first {...} block.
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        val = json.loads(cleaned[start : end + 1])
        if isinstance(val, dict):
            return val
    raise LlmError("llm_filter_parse", "Could not parse JSON filters from LLM output")
