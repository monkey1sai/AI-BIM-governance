"""Kit WebRTC E2E：用既有 conversion 產物建 review session（綁 artifact → 設 expected stage），
供 viewer /ui/open 載入並驗 stage truth matched。不用 curl。"""
import json
import urllib.request

BASE = "http://127.0.0.1:8004"
JOB = "stream_conv_20260528071743_b74a3e04"
MV = "270V4_d28a1574-5600-4bd7-bac1-f607e744810f"
USDC = f"http://192.168.10.105:49101/artifacts/{JOB}/model.usdc"
MAPPING = f"http://192.168.10.105:49101/artifacts/{JOB}/element_mapping.json"


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data,
                                 headers={"Content-Type": "application/json"}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, {"_err": e.read().decode("utf-8", "replace")[:400]}
    except Exception as e:  # noqa: BLE001
        return None, {"_err": f"{type(e).__name__}: {str(e)[:200]}"}


body = {
    "tenant_id": "tenant_demo_001",
    "project_id": "270",
    "model_version_id": MV,
    "created_by": "e2e_opus48",
    "mode": "single_kit_shared_state",
    "options": {"auto_allocate_kit": True},
    "artifact_bindings": [{
        "artifact_group_id": "ag_270V4",
        "artifact_id": f"ifc_{MV}",
        "model_version_id": MV,
        "artifact_role": "derived",
        "url": USDC,
        "mapping_url": MAPPING,
        "load_order": 0,
        "ready_status": "ready",
        "conversion_authority": "bim-streaming-server",
        "conversion_job_id": JOB,
        "conversion_status": "succeeded",
    }],
}

st, resp = call("POST", "/api/review-sessions", body)
print("=== POST /api/review-sessions ->", st, "===")
print(json.dumps(resp, ensure_ascii=False)[:900])
sid = resp.get("session_id") or resp.get("review_session_id") or (resp.get("session") or {}).get("session_id")
print("session_id =", sid)
if sid:
    st2, sc = call("GET", f"/api/review-sessions/{sid}/stream-config")
    print("=== GET stream-config ->", st2, "===")
    print(json.dumps(sc, ensure_ascii=False)[:900])
    out = {"session_id": sid, "expected_stage_url": USDC, "create_status": st, "stream_config": sc}
    import os
    with open(os.path.join(os.path.dirname(__file__), "kit-session-handoff.json"), "w", encoding="utf-8") as f:
        json.dump({"create": resp, "stream_config": sc}, f, ensure_ascii=False, indent=2)
    print("VIEWER_URL =", f"{BASE}/ui/open?session={sid}&projectId=270&modelVersionId={MV}&userId=e2e_opus48&displayName=opus48")
