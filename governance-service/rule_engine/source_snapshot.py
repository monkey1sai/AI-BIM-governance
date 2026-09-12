"""Parse the exact private copy whose bytes are hashed for immutable run evidence."""
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory

from .engine import open_model


def load_source_snapshot(ifc_path):
    # A private copy avoids hashing one revision and parsing a later path revision.
    # Preserve suffix for IFC/IFCZIP parsing; never mutate the owner's source file.
    with TemporaryDirectory(prefix="a1-rule-source-") as directory:
        snapshot = Path(directory) / ("source" + Path(ifc_path).suffix)
        digest = hashlib.sha256()
        with open(ifc_path, "rb") as source, snapshot.open("wb") as target:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
                target.write(chunk)
        model = open_model(str(snapshot))
        return model, digest.hexdigest()
