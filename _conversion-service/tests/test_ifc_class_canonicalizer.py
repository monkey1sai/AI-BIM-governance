import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ifc_class_canonicalizer import canonical_ifc_class, canonical_ifc_class_key


def test_canonical_ifc_class_normalizes_known_ifc_tokens():
    assert canonical_ifc_class("IFCWALLSTANDARDCASE") == "IfcWallStandardCase"
    assert canonical_ifc_class("ifcrampflight") == "IfcRampFlight"
    assert canonical_ifc_class("IfcDoor") == "IfcDoor"


def test_canonical_ifc_class_key_matches_different_input_styles():
    assert canonical_ifc_class_key("IFCCURTAINWALL") == canonical_ifc_class_key("IfcCurtainWall")
    assert canonical_ifc_class_key(" ifcbeam ") == "ifcbeam"
