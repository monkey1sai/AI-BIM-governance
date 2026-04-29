from pathlib import Path
import shutil
from urllib.parse import urlparse
from urllib.request import url2pathname, urlopen


def download_source(source_url: str, destination: Path, timeout_seconds: int = 60) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    parsed = urlparse(source_url)
    if parsed.scheme in {"http", "https"}:
        with urlopen(source_url, timeout=timeout_seconds) as response:
            with destination.open("wb") as handle:
                shutil.copyfileobj(response, handle)
        return destination

    if parsed.scheme == "file":
        shutil.copy2(Path(url2pathname(parsed.path)), destination)
        return destination

    source_path = Path(source_url)
    if source_path.is_file():
        shutil.copy2(source_path, destination)
        return destination

    raise ValueError(f"Unsupported source_url: {source_url}")


def write_json(path: Path, payload: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(payload, encoding="utf-8")
