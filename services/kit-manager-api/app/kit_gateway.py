import json
from urllib.error import URLError
from urllib.request import Request, urlopen


class KitRuntimeGateway:
    def __init__(self, control_url: str, timeout_seconds: int = 3):
        self.control_url = control_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def open_stage(self, payload: dict) -> str:
        return self._post("/api/runtime/open-stage", payload)

    def close_stage(self, payload: dict) -> str:
        return self._post("/api/runtime/close-stage", payload)

    def _post(self, path: str, payload: dict) -> str:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = Request(
            f"{self.control_url}{path}",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                if response.status >= 400:
                    return f"failed_http_{response.status}"
                return "sent"
        except URLError:
            return "blocked_runtime_control_unavailable"
        except Exception as exc:
            return f"failed_{exc.__class__.__name__}"
