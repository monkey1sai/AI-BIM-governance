"""A2/A3/Issues/BCF over-the-wire 實測 — 對 running governance-service :49102。
誠實:identity diff 標 0 change(非假裝有差異);失敗即記錄。"""
import urllib.request, json, time, os

BASE = "http://127.0.0.1:49102"
HERE = os.path.dirname(os.path.abspath(__file__))
FIXT = r"C:\Repos\active\iot\AI-BIM-governance\storage\fixture-bytes.ifc"
A1_RUN = None  # 從 a1-otw-evidence.json 讀
try:
    with open(os.path.join(HERE, "a1-otw-evidence.json"), encoding="utf-8") as f:
        A1_RUN = json.load(f)["A1"]["run_id"]
except Exception:
    pass
EVID = {}

def call(method, path, body=None, timeout=300, raw_bytes=False):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        if raw_bytes:
            return r.status, r.read()
        raw = r.read().decode()
        try:
            return r.status, json.loads(raw)
        except Exception:
            return r.status, raw

# ---------- A2: identity diff (honest 0-change baseline) ----------
print("=== A2: diff fixture vs itself (identity baseline) ===")
t0 = time.time()
st, d = call("POST", "/api/diffs", {"base_ifc_path": FIXT, "target_ifc_path": FIXT,
             "base_model_version_id": "v-base", "target_model_version_id": "v-target"})
print("POST /api/diffs ->", st, json.dumps(d, ensure_ascii=False)[:160])
diff_id = d.get("diff_id")
final = {}
for _ in range(120):
    st, final = call("GET", f"/api/diffs/{diff_id}")
    stt = final.get("status") or (final.get("diff") or {}).get("status")
    if stt in ("succeeded", "failed", "error", "completed", "done"):
        break
    time.sleep(2)
st, items = call("GET", f"/api/diffs/{diff_id}/items")
item_list = items.get("items", items if isinstance(items, list) else [])
EVID["A2"] = {"diff_id": diff_id, "status_obj": final, "elapsed_s": round(time.time()-t0,1),
              "items_count": len(item_list) if isinstance(item_list, list) else "?"}
print(f"A2 diff status={EVID['A2']['status_obj'].get('status') or (final.get('diff') or {}).get('status')} "
      f"items={EVID['A2']['items_count']} elapsed={EVID['A2']['elapsed_s']}s")

# ---------- A3: federation with minimal real USD members ----------
print("=== A3: federated-set build with pxr-authored USD members ===")
usd_dir = os.path.join(HERE, "usd-members")
os.makedirs(usd_dir, exist_ok=True)
from pxr import Usd, UsdGeom
def make_usd(path, prim, mpu=1.0):
    s = Usd.Stage.CreateNew(path)
    UsdGeom.SetStageUpAxis(s, UsdGeom.Tokens.z)
    UsdGeom.SetStageMetersPerUnit(s, mpu)
    UsdGeom.Xform.Define(s, "/World")
    UsdGeom.Cube.Define(s, f"/World/{prim}")
    s.GetRootLayer().Save()
    return path
arch = make_usd(os.path.join(usd_dir, "arch.usda"), "Arch_Box")
stru = make_usd(os.path.join(usd_dir, "struct.usda"), "Struct_Box")
st, s1 = call("POST", "/api/federated-sets", {"name": "OTW Federation 2026-06-03", "project_id": "otw"})
set_id = s1.get("set_id")
print("create set ->", st, set_id)
st, m1 = call("POST", f"/api/federated-sets/{set_id}/members",
              {"model_version_id": "arch-v1", "discipline": "architecture", "usd_path": arch, "layer_order": 0})
st, m2 = call("POST", f"/api/federated-sets/{set_id}/members",
              {"model_version_id": "struct-v1", "discipline": "structure", "usd_path": stru, "layer_order": 1})
print("members ->", m1, m2)
st, vc = call("POST", f"/api/federated-sets/{set_id}/validate-coords")
print("validate-coords ->", st, json.dumps(vc, ensure_ascii=False)[:160])
st, build = call("POST", f"/api/federated-sets/{set_id}/build")
print("build ->", st, json.dumps(build, ensure_ascii=False)[:200])
st, room = call("GET", f"/api/federated-sets/{set_id}/review-room")
out_usd = build.get("usd_path") or build.get("federated_usd_path") or (build.get("set") or {}).get("usd_path")
built_exists = bool(out_usd) and os.path.exists(out_usd)
# 驗 built federated layer 真的用 sublayer 疊合
sub_ok = None
if built_exists:
    try:
        from pxr import Sdf
        lyr = Sdf.Layer.FindOrOpen(out_usd)
        sub_ok = list(lyr.subLayerPaths) if lyr else None
    except Exception as e:
        sub_ok = f"err:{e}"
EVID["A3"] = {"set_id": set_id, "validate_coords": vc, "build": build,
              "built_usd": out_usd, "built_exists": built_exists, "sublayers": sub_ok,
              "review_room_keys": list(room.keys()) if isinstance(room, dict) else None}
print(f"A3 built_usd={out_usd} exists={built_exists} sublayers={sub_ok}")

# ---------- Issues + BCF chain (A1 -> issues -> bcfzip, model_version bound) ----------
print("=== Issues: from-rule-run + lifecycle + BCF export ===")
issues_evid = {}
if A1_RUN:
    st, fr = call("POST", f"/api/issues/from-rule-run/{A1_RUN}")
    issues_evid["from_rule_run"] = {"status": st, "created": fr.get("created")}
    print("from-rule-run ->", st, "created", fr.get("created"))
    st, lst = call("GET", "/api/issues?model_version_id=otw-2026-06-03-a1")
    bound = lst.get("issues", [])
    issues_evid["bound_to_model_version"] = len(bound)
    print("issues bound to model_version otw-2026-06-03-a1:", len(bound))
# standalone issue + transition lifecycle
st, iss = call("POST", "/api/issues", {"title": "OTW lifecycle probe", "severity": "high",
              "ifc_guid": "TEST_GUID", "model_version_id": "otw-2026-06-03-a1"})
iid = iss.get("id")
# 合法 transition：store.py ISSUE_STATUSES 不含 "in_review"；open 的合法目標為
# {assigned,in_progress,resolved,rejected}（_ALLOWED["open"]），用 in_progress。
st, tr = call("POST", f"/api/issues/{iid}/transition", {"to_status": "in_progress", "note": "otw"})
st, got = call("GET", f"/api/issues/{iid}")
issues_evid["lifecycle"] = {"created_id": iid, "after_transition_status": (got.get("issue") or {}).get("status"),
                            "events": len(got.get("events", []))}
print("lifecycle:", issues_evid["lifecycle"])
# BCF export bound to model_version
try:
    st, bcf = call("GET", "/api/bcf/export?model_version_id=otw-2026-06-03-a1", raw_bytes=True)
    issues_evid["bcf_export"] = {"status": st, "bytes": len(bcf), "sig": bcf[:2].hex()}
    print(f"BCF export bytes={len(bcf)} sig={bcf[:2].hex()} (PK=504b)")
    with open(os.path.join(HERE, "bcf-export-sample.bcfzip"), "wb") as f:
        f.write(bcf)
except Exception as e:
    issues_evid["bcf_export"] = {"error": str(e)}
    print("BCF export ERROR:", e)
EVID["Issues_BCF"] = issues_evid

# 落檔到 evidence 目錄（HERE），讓 A2/A3/Issues/BCF 輸出可被歸檔複查。
with open(os.path.join(HERE, "a2a3-issues-otw-evidence.json"), "w", encoding="utf-8") as f:
    json.dump(EVID, f, ensure_ascii=False, indent=2)
print("WROTE a2a3-issues-otw-evidence.json")
