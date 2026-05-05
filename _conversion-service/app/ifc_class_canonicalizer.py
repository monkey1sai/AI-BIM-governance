import re


IFC_CLASS_TOKEN_RE = re.compile(r"^IFC[A-Z0-9_]+$", re.I)

KNOWN_IFC_CLASS_NAMES = {
    "IFCBEAM": "IfcBeam",
    "IFCBUILDING": "IfcBuilding",
    "IFCBUILDINGELEMENTPROXY": "IfcBuildingElementProxy",
    "IFCBUILDINGSTOREY": "IfcBuildingStorey",
    "IFCCOLUMN": "IfcColumn",
    "IFCCOVERING": "IfcCovering",
    "IFCCURTAINWALL": "IfcCurtainWall",
    "IFCDOOR": "IfcDoor",
    "IFCFLOWSEGMENT": "IfcFlowSegment",
    "IFCFLOWTERMINAL": "IfcFlowTerminal",
    "IFCMEMBER": "IfcMember",
    "IFCPLATE": "IfcPlate",
    "IFCPROJECT": "IfcProject",
    "IFCRAILING": "IfcRailing",
    "IFCRAMP": "IfcRamp",
    "IFCRAMPFLIGHT": "IfcRampFlight",
    "IFCROOF": "IfcRoof",
    "IFCSITE": "IfcSite",
    "IFCSLAB": "IfcSlab",
    "IFCSPACE": "IfcSpace",
    "IFCSTAIR": "IfcStair",
    "IFCSTAIRFLIGHT": "IfcStairFlight",
    "IFCWALL": "IfcWall",
    "IFCWALLSTANDARDCASE": "IfcWallStandardCase",
    "IFCWINDOW": "IfcWindow",
}


def canonical_ifc_class(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    key = text.upper()
    if key in KNOWN_IFC_CLASS_NAMES:
        return KNOWN_IFC_CLASS_NAMES[key]
    if key.startswith("IFC"):
        return "Ifc" + key[3:].title().replace("_", "")
    return text


def canonical_ifc_class_key(value: object) -> str:
    return canonical_ifc_class(value).lower()


def is_ifc_class_token(value: object) -> bool:
    text = str(value or "").strip()
    return bool(text and IFC_CLASS_TOKEN_RE.fullmatch(text))
