MUTATING_EVENTS = {
    "openStageRequest",
    "loadArtifactGroupRequest",
    "selectPrimsRequest",
    "makePrimsPickable",
    "resetStage",
    "highlightPrimsRequest",
    "clearHighlightRequest",
    "focusPrimRequest",
}

READONLY_EVENTS = {
    "loadingStateQuery",
    "getChildrenRequest",
}

UNAUTHORIZED_MUTATING_COMMAND = "unauthorized_mutating_command"
UNAUTHORIZED_MUTATING_REASON = "primary lease required"


def payload_dict(value):
    get_dict = getattr(value, "get_dict", None)
    if callable(get_dict):
        value = get_dict()
    return value if isinstance(value, dict) else {}


def is_authorized_mutator(payload) -> bool:
    request_payload = payload_dict(payload)
    role = str(request_payload.get("role") or "").lower()
    session_id = str(request_payload.get("session_id") or "")
    lease_token = str(
        request_payload.get("viewer_lease_token")
        or request_payload.get("lease_token")
        or ""
    )
    if role != "primary":
        return False
    if not session_id or not lease_token:
        return False
    return True


def unauthorized_result_payload(payload, **extra):
    request_payload = payload_dict(payload)
    result = {
        "result": "error",
        "error": UNAUTHORIZED_MUTATING_COMMAND,
        "reason": UNAUTHORIZED_MUTATING_REASON,
        **extra,
    }
    for key in ("request_id", "binding_revision_id"):
        value = request_payload.get(key)
        if value:
            result[key] = value
    return result
