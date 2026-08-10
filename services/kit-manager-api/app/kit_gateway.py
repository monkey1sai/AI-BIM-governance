import json
from urllib.error import URLError
from urllib.request import ProxyHandler, Request, build_opener


class KitRuntimeGateway:
    def __init__(self, control_url: str, timeout_seconds: int = 3):
        self.control_url = control_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        # The launcher admits only loopback or an address assigned to this host.
        # Do not let inherited HTTP_PROXY settings change the actual TCP peer.
        self._opener = build_opener(ProxyHandler({}))

    def open_stage(self, payload: dict) -> str:
        return self._post("/api/runtime/open-stage", payload)

    def close_stage(self, payload: dict) -> str:
        return self._post("/api/runtime/close-stage", payload)

    def _post(self, path: str, payload: dict) -> str:
        if not self.control_url:
            # This repository does not expose the historical
            # /api/runtime/open-stage or close-stage HTTP authority.  An empty
            # endpoint is an explicit, honest blocked state; do not synthesize a
            # request against the conversion API just because it is healthy.
            return "blocked_runtime_control_unconfigured"
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = Request(
            f"{self.control_url}{path}",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with self._opener.open(request, timeout=self.timeout_seconds) as response:
                if response.status >= 400:
                    return f"failed_http_{response.status}"
                return "sent"
        except URLError:
            return "blocked_runtime_control_unavailable"
        except Exception as exc:
            return f"failed_{exc.__class__.__name__}"
