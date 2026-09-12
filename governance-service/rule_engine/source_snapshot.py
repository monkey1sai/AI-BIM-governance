"""Parse the exact private copy whose bytes are hashed for immutable run evidence."""
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory

import ifcopenshell


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
        # This unique path is deleted below and cannot produce a cache hit.
        # Keep private snapshots out of the shared stable-source model cache.
        model = ifcopenshell.open(str(snapshot))
        return model, digest.hexdigest()
