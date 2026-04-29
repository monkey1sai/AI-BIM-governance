import json
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

from .settings import Settings


def post_conversion_result(settings: Settings, model_version_id: str, result: dict[str, Any]) -> str | None:
    url = f"{settings.fake_bim_control_url}/api/model-versions/{model_version_id}/conversion-result"
    body = json.dumps(result, ensure_ascii=False).encode("utf-8")
    request = Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=10) as response:
            if response.status >= 400:
                return f"_bim-control returned HTTP {response.status}."
    except URLError as exc:
        return f"_bim-control update failed: {exc}."
    return None
