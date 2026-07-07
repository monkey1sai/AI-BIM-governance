# A3 clash 碰撞偵測 Implementation Plan（Spec-3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Spec：`docs/superpowers/specs/2026-07-07-a3-clash-ifcclash-design.md`
> 可與 A1/A2 plan 平行（不同模組）；與 A1 plan 都會 additive 動 `issues/api.py` 與 `governanceProxy.ts`——**不得同分支並行編輯同檔**，後 merge 者先 rebase。

**Goal:** governance-service 新增 clash 模組（ifcclash 官方引擎、非同步 job、hard guard、size guard），`#a3` FederationPage 出真碰撞清單並可轉 Issue。

**Architecture:** 新模組 `governance-service/clash/`（api/engine/store/worker），比照 `diff_engine`/`federation` 模式（SQLite 同 `governance.db`、FastAPI BackgroundTasks、`{items,total,limit,offset}` envelope）。引擎跑在 **subprocess**（`clash/worker.py`）：可硬 timeout、OCC crash 不拖垮服務。**成員 IFC 路徑由 clash-run request 明給**（federation store 只存 `usd_path`，不動凍結的 federation/api.py）。

**Tech Stack:** FastAPI + SQLite + ifcclash（IfcOpenShell 官方）+ React 18 console。

## Global Constraints

- **解凍範圍（核可 spec 即簽核，僅 additive）**：`governance-service/app.py` 僅一行 `include_router`；`issues/api.py` 僅新增 from-clash-run 端點；`governanceProxy.ts` 僅新增 clash 路由。federation/api.py、federation/store.py **禁改**。
- **spec 偏差（在此揭露）**：Spec-3 §2.2「guard 結果進 `/health`」與 §2.1「app.py 僅一行」矛盾——採較嚴者：**不改 `/health`**，改由 clash router 自帶 `GET /api/clash-engine` probe 端點承擔誠實回報。
- D-27 hard guard：引擎不可用→建 run 回 422＋機器可讀原因；**絕不靜默回 0 碰撞**。
- size guard：輸入 IFC 總大小 > `CLASH_SIZE_WARN_MB`（env，預設 80）→ 回應帶 `size_warning: true`，UI 需二次確認；subprocess timeout `CLASH_TIMEOUT_S`（env，預設 600）→ run=failed 附原因。
- 不自研碰撞演算法；只包裝 ifcclash 官方 API。
- 測試：`cd governance-service && "/c/Program Files/Python312/python.exe" -m pytest tests/ -v`；console `npm run verify`。
- GitNexus impact/detect_changes；分支：`feat/a3-clash-ifcclash`。

---

### Task 0: 環境能力驗證（硬 gate——全過才進 Task 1）

- [ ] **Step 1: 安裝驗證** — host Python 3.12 環境：`"/c/Program Files/Python312/python.exe" -m pip install ifcclash`（記錄版本）；`python -c "import ifcclash; print(ifcclash.__file__)"`。
- [ ] **Step 2: API 形狀勘查** — 讀安裝後的 `ifcclash` 原始碼（`ifcclash/ifcclash.py`），記下：`Clasher`/`ClashSettings` 建構參數、clash set dict 的欄位（`a`/`b` file selector、`mode`、`tolerance`、`check_all`）、結果 JSON 結構（clash 的 key：兩構件 GlobalId、type、position）。**Task 2 的 worker 依此實測形狀為準**；本 plan 內引擎程式碼為依官方文件的預期形狀，如有出入以勘查結果調整包裝層（API 契約不變）。
- [ ] **Step 3: smoke** — 寫 `artifacts/tmp-clash-spike/spike.py` 對 `storage/` 兩份真 IFC（270 圖書館＋許良宇；路徑用主工作區絕對路徑）跑最小 clash set，記錄：能否出結果、耗時、是否缺 OCC 類依賴（缺→補裝並重驗；補不起來→**停在 hard guard 交付模式**：Task 1/3/4/5 照做、Task 2 引擎永遠回 unavailable，Task 6 驗收改驗 422/guard UX）。
- [ ] **Step 4: 紀錄** — 安裝方式、版本、smoke 耗時、能力結論寫進 `artifacts/tmp-clash-spike/RESULT.md`（進 PR body 引用）。**依賴衝突（host Py312 governance runtime）先回報再動，不擅自升降級既有套件。**

### Task 1: clash store（TDD）

**Files:**
- Create: `governance-service/clash/__init__.py`（空檔）
- Create: `governance-service/clash/store.py`
- Test: `governance-service/tests/test_clash_store.py`

**Interfaces:**
- Produces: `ClashStore(db_path)`：`create_run(federated_set_id, pairs, tolerance, size_warning) -> run_id`（前綴 `cr`，status=queued）、`mark_running(run_id)`、`complete_run(run_id, results: list[dict])`（status=succeeded＋批次插 results）、`fail_run(run_id, error)`、`get_run(run_id) -> dict|None`、`get_results(run_id, limit, offset) -> tuple[list[dict], int]`（severity high→medium→low 排序＋total）。
- results dict 欄位：`id, clash_run_id, a_ifc_guid, b_ifc_guid, a_ifc_class, b_ifc_class, clash_type, severity, position_json, created_at`。

- [ ] **Step 1: 寫失敗測試**

```python
import os
from clash.store import ClashStore


def _mk(tmp_path):
    return ClashStore(str(tmp_path / "gov.db"))


def test_run_lifecycle(tmp_path):
    s = _mk(tmp_path)
    rid = s.create_run("set_1", [{"a_ifc_path": "a.ifc", "b_ifc_path": "b.ifc"}], 0.002, size_warning=False)
    assert rid.startswith("cr_")
    assert s.get_run(rid)["status"] == "queued"
    s.mark_running(rid)
    assert s.get_run(rid)["status"] == "running"
    s.complete_run(rid, [
        {"a_ifc_guid": "A" * 22, "b_ifc_guid": "B" * 22, "a_ifc_class": "IfcWall", "b_ifc_class": "IfcDuctSegment",
         "clash_type": "pierce", "severity": "high", "position_json": "[1,2,3]"},
        {"a_ifc_guid": "C" * 22, "b_ifc_guid": "D" * 22, "a_ifc_class": "IfcSlab", "b_ifc_class": "IfcPipeSegment",
         "clash_type": "clearance", "severity": "low", "position_json": None},
    ])
    run = s.get_run(rid)
    assert run["status"] == "succeeded"
    items, total = s.get_results(rid, limit=10, offset=0)
    assert total == 2
    assert items[0]["severity"] == "high"   # 排序：high 先


def test_fail_run(tmp_path):
    s = _mk(tmp_path)
    rid = s.create_run("set_1", [], 0.002, size_warning=True)
    s.fail_run(rid, "timeout after 600s")
    run = s.get_run(rid)
    assert run["status"] == "failed" and "timeout" in run["error"]
    assert run["size_warning"] is True
```

- [ ] **Step 2: 跑測試確認失敗**（ModuleNotFoundError）。
- [ ] **Step 3: 實作 `clash/store.py`**（schema/`_conn`/`_new_id` 模式逐字仿 `issues/store.py`）：

```python
_SCHEMA = """
CREATE TABLE IF NOT EXISTS clash_runs(
  id TEXT PRIMARY KEY,
  federated_set_id TEXT,
  status TEXT,
  size_warning INTEGER,
  tolerance REAL,
  pairs_json TEXT,
  error TEXT,
  started_at TEXT,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS clash_results(
  id TEXT PRIMARY KEY,
  clash_run_id TEXT,
  a_ifc_guid TEXT, b_ifc_guid TEXT,
  a_ifc_class TEXT, b_ifc_class TEXT,
  clash_type TEXT, severity TEXT,
  position_json TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_clash_results_run ON clash_results(clash_run_id);
"""
```

排序用 `ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id`；`get_results` 另回 `SELECT COUNT(*)` total。status 只允許 `queued→running→succeeded|failed`。

- [ ] **Step 4: 測試通過。** — [ ] **Step 5: Commit** — `feat(clash): ClashStore（run/results 落地）`。

### Task 2: 引擎包裝＋subprocess worker（guards）

**Files:**
- Create: `governance-service/clash/engine.py`
- Create: `governance-service/clash/worker.py`
- Test: `governance-service/tests/test_clash_engine.py`

**Interfaces:**
- Produces(engine): `probe() -> dict`（`{"available": bool, "reason": str|None}`；import ifcclash 失敗或 Task 0 判缺幾何能力→available=False）；`run_pairs(pairs: list[dict], tolerance: float, timeout_s: int) -> list[dict]`（回 Task 1 results dict 形狀；逾時 raise `ClashTimeout`；引擎錯誤 raise `ClashEngineError`）。
- Produces(worker): `python -m clash.worker <in.json> <out.json>`——in：`{"pairs":[{"a_ifc_path","b_ifc_path"}],"tolerance":0.002}`；out：`{"clashes":[{a_ifc_guid,b_ifc_guid,a_ifc_class,b_ifc_class,clash_type,position}]}`。
- severity 映射（engine 內固定函式）：`pierce|collision → high`、`protrusion → medium`、`clearance → low`、未知型別 → `medium`。

- [ ] **Step 1: 寫失敗測試**（不依賴真 ifcclash——worker 以 subprocess 邊界隔離，engine 單測用假 worker）：

```python
import json
from clash.engine import probe, run_pairs, ClashTimeout, _severity_of


def test_severity_mapping():
    assert _severity_of("pierce") == "high"
    assert _severity_of("collision") == "high"
    assert _severity_of("protrusion") == "medium"
    assert _severity_of("clearance") == "low"
    assert _severity_of("whatever") == "medium"


def test_probe_shape():
    p = probe()
    assert set(p) == {"available", "reason"}
    assert isinstance(p["available"], bool)


def test_run_pairs_timeout(monkeypatch, tmp_path):
    import clash.engine as eng
    monkeypatch.setattr(eng, "_worker_cmd", lambda in_p, out_p: ["python", "-c", "import time; time.sleep(5)"])
    try:
        run_pairs([{"a_ifc_path": "x.ifc", "b_ifc_path": "y.ifc"}], 0.002, timeout_s=1)
        assert False, "should timeout"
    except ClashTimeout:
        pass
```

- [ ] **Step 2: 跑測試確認失敗**。
- [ ] **Step 3: 實作**

`engine.py` 核心（subprocess＋timeout；`_worker_cmd` 抽出便於測試 monkeypatch）：

```python
import importlib.util, json, os, subprocess, sys, tempfile

class ClashEngineError(RuntimeError): ...
class ClashTimeout(ClashEngineError): ...

_SEV = {"pierce": "high", "collision": "high", "protrusion": "medium", "clearance": "low"}

def _severity_of(clash_type: str) -> str:
    return _SEV.get(clash_type, "medium")

def probe() -> dict:
    if importlib.util.find_spec("ifcclash") is None:
        return {"available": False, "reason": "ifcclash not installed"}
    return {"available": True, "reason": None}

def _worker_cmd(in_path: str, out_path: str) -> list[str]:
    return [sys.executable, "-m", "clash.worker", in_path, out_path]

def run_pairs(pairs, tolerance, timeout_s):
    with tempfile.TemporaryDirectory() as td:
        in_p, out_p = os.path.join(td, "in.json"), os.path.join(td, "out.json")
        with open(in_p, "w", encoding="utf-8") as f:
            json.dump({"pairs": pairs, "tolerance": tolerance}, f)
        try:
            proc = subprocess.run(_worker_cmd(in_p, out_p), capture_output=True, text=True, timeout=timeout_s)
        except subprocess.TimeoutExpired as exc:
            raise ClashTimeout(f"clash worker timeout after {timeout_s}s") from exc
        if proc.returncode != 0:
            raise ClashEngineError(f"clash worker failed: {proc.stderr[-2000:]}")
        with open(out_p, encoding="utf-8") as f:
            clashes = json.load(f)["clashes"]
    return [{
        "a_ifc_guid": c["a_ifc_guid"], "b_ifc_guid": c["b_ifc_guid"],
        "a_ifc_class": c.get("a_ifc_class"), "b_ifc_class": c.get("b_ifc_class"),
        "clash_type": c.get("clash_type", "collision"),
        "severity": _severity_of(c.get("clash_type", "collision")),
        "position_json": json.dumps(c.get("position")) if c.get("position") is not None else None,
    } for c in clashes]
```

`worker.py`（**形狀以 Task 0 Step 2 勘查為準**；預期骨架——用 ifcclash 官方 Clasher，逐 pair 一個 clash set，輸出統一 JSON）：

```python
"""clash worker：subprocess 邊界。輸入/輸出 JSON 檔；只在此 import ifcclash。"""
import json, sys

def main() -> int:
    in_path, out_path = sys.argv[1], sys.argv[2]
    with open(in_path, encoding="utf-8") as f:
        req = json.load(f)
    from ifcclash.ifcclash import Clasher, ClashSettings   # Task 0 勘查後如有出入在此調整
    settings = ClashSettings()
    settings.output = out_path + ".raw"
    clasher = Clasher(settings)
    clasher.clash_sets = [{
        "name": f"pair_{i}",
        "a": [{"file": p["a_ifc_path"]}],
        "b": [{"file": p["b_ifc_path"]}],
        "tolerance": req.get("tolerance", 0.002),
        "mode": "intersection",
    } for i, p in enumerate(req["pairs"])]
    clasher.clash()
    clasher.export()
    with open(settings.output, encoding="utf-8") as f:
        raw_sets = json.load(f)
    clashes = []
    for cs in raw_sets:
        for key, c in (cs.get("clashes") or {}).items():
            clashes.append({
                "a_ifc_guid": c.get("a_global_id") or key.split("-")[0],
                "b_ifc_guid": c.get("b_global_id") or key.split("-")[-1],
                "a_ifc_class": c.get("a_ifc_class"), "b_ifc_class": c.get("b_ifc_class"),
                "clash_type": c.get("type", "collision"),
                "position": c.get("position"),
            })
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"clashes": clashes}, f)
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: 測試通過**；若 Task 0 smoke 成功，另跑一次 worker 對真檔（不進測試套件，結果記到 RESULT.md）。
- [ ] **Step 5: Commit** — `feat(clash): 引擎包裝＋subprocess worker（timeout/severity 映射）`。

### Task 3: clash API＋app 掛載（TDD）

**Files:**
- Create: `governance-service/clash/api.py`
- Modify: `governance-service/app.py`（:72 後 additive 兩行：import＋include_router）
- Modify: `governance-service/issues/api.py`（additive：from-clash-run）
- Test: `governance-service/tests/test_clash_api.py`

**Interfaces:**
- Produces:
  - `GET  /api/clash-engine` → `{"available": bool, "reason": str|null}`
  - `POST /api/clash-runs`，body `{"federated_set_id": str, "pairs": [{"a_member_id"?: str, "a_ifc_path": str, "b_member_id"?: str, "b_ifc_path": str}], "tolerance"?: float}` → 202 `{"clash_run_id", "status": "queued", "size_warning": bool}`；set 不存在或非 built→400；任一 ifc_path 不存在→400；引擎不可用→**422**（`{"detail": {"code": "clash_engine_unavailable", "reason": ...}}`）
  - `GET  /api/clash-runs/{run_id}` → run dict＋`{"engine": probe()}`；404
  - `GET  /api/clash-runs/{run_id}/results?limit=&offset=` → `{"items", "total", "limit", "offset"}`
  - `POST /api/issues/from-clash-run/{run_id}`，optional body `{"clash_ids"?: [..], "assignee"?: str}` → 201 `{"created", "skipped", "issue_ids"}`（冪等鍵=`source_type="clash_result"`、`source_ref=f"{run_id}:{clash_id}"`；`ifc_guid`=a_ifc_guid；title 含兩構件與類別）

- [ ] **Step 1: 寫失敗測試**（fixture 照 `test_issues.py` 的 `client_and_db` 模式＋`GOV_FED_OUT`；用 `monkeypatch` 打樁 `clash.engine.probe`/`run_pairs` 免依賴真引擎）：

```python
def _seed_built_set(db_path):
    # create_set 參數以 federation/store.py 現檔簽名為準（:55-62）；
    # 若與此不符，改走 HTTP：client.post("/api/federated-sets", json=...) 建立後再 set_build_result。
    from federation.store import FederationStore
    fs = FederationStore(db_path)
    set_id = fs.create_set("p1", "館體×機電")
    fs.set_build_result(set_id, "C:/tmp/federated_review.usda")
    return set_id


def test_engine_unavailable_422(client_and_db, monkeypatch, tmp_path):
    client, db_path = client_and_db
    import clash.engine as eng
    monkeypatch.setattr(eng, "probe", lambda: {"available": False, "reason": "no OCC"})
    set_id = _seed_built_set(db_path)
    ifc = tmp_path / "a.ifc"; ifc.write_text("x")
    r = client.post("/api/clash-runs", json={"federated_set_id": set_id,
        "pairs": [{"a_ifc_path": str(ifc), "b_ifc_path": str(ifc)}]})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "clash_engine_unavailable"


def test_run_lifecycle_and_issue_idempotent(client_and_db, monkeypatch, tmp_path):
    client, db_path = client_and_db
    import clash.engine as eng
    monkeypatch.setattr(eng, "probe", lambda: {"available": True, "reason": None})
    monkeypatch.setattr(eng, "run_pairs", lambda pairs, tol, timeout_s: [
        {"a_ifc_guid": "A" * 22, "b_ifc_guid": "B" * 22, "a_ifc_class": "IfcWall",
         "b_ifc_class": "IfcDuct", "clash_type": "pierce", "severity": "high", "position_json": "[0,0,0]"}])
    set_id = _seed_built_set(db_path)
    ifc = tmp_path / "a.ifc"; ifc.write_text("x")
    r = client.post("/api/clash-runs", json={"federated_set_id": set_id,
        "pairs": [{"a_ifc_path": str(ifc), "b_ifc_path": str(ifc)}]})
    assert r.status_code == 202
    rid = r.json()["clash_run_id"]
    # TestClient 的 BackgroundTasks 在回應後同步執行 → 直接查
    assert client.get(f"/api/clash-runs/{rid}").json()["status"] == "succeeded"
    res = client.get(f"/api/clash-runs/{rid}/results").json()
    assert res["total"] == 1 and res["items"][0]["severity"] == "high"
    # 轉 Issue 冪等
    r1 = client.post(f"/api/issues/from-clash-run/{rid}", json={"assignee": "機電組"})
    assert r1.status_code == 201 and r1.json()["created"] == 1
    r2 = client.post(f"/api/issues/from-clash-run/{rid}")
    assert r2.json()["created"] == 0 and r2.json()["skipped"] == 1


def test_set_not_built_400(client_and_db, monkeypatch, tmp_path):
    client, db_path = client_and_db
    import clash.engine as eng
    monkeypatch.setattr(eng, "probe", lambda: {"available": True, "reason": None})
    from federation.store import FederationStore
    set_id = FederationStore(db_path).create_set("p1", "draft set")   # status=draft
    ifc = tmp_path / "a.ifc"; ifc.write_text("x")
    assert client.post("/api/clash-runs", json={"federated_set_id": set_id,
        "pairs": [{"a_ifc_path": str(ifc), "b_ifc_path": str(ifc)}]}).status_code == 400
```

- [ ] **Step 2: 跑測試確認失敗**。
- [ ] **Step 3: 實作 `clash/api.py`**（BackgroundTasks 模式逐字仿 app.py rule-run :219-256；DB 路徑解析仿 issues/api.py :15-16；size guard：`sum(os.path.getsize(p) for 每對兩檔去重) > int(os.environ.get("CLASH_SIZE_WARN_MB", "80")) * 1024 * 1024`；timeout `int(os.environ.get("CLASH_TIMEOUT_S", "600"))`）。背景函式：`mark_running → engine.run_pairs → complete_run`，`ClashTimeout/ClashEngineError/Exception → fail_run(str(exc))`。`issues/api.py` 的 from-clash-run 仿 from-rule-run :83-111：讀 `ClashStore.get_results(run_id, limit=2000, offset=0)`，組 items（`source_type="clash_result"`、`source_ref=f"{run_id}:{row['id']}"`、`title=f"[clash] {row['a_ifc_class']}×{row['b_ifc_class']} {row['a_ifc_guid'][:8]}…"`、`severity=row["severity"]`、`ifc_guid=row["a_ifc_guid"]`、`assignee`）→ `create_issues_batch`。`app.py` :72 後加：

```python
# A3 clash 碰撞偵測（ifcclash 官方引擎，獨立 router 模組；Spec-3 解凍：僅此兩行）。
from clash.api import router as clash_router  # noqa: E402

app.include_router(clash_router)
```

- [ ] **Step 4: 測試通過＋全套 pytest 零回歸**。
- [ ] **Step 5: Commit** — `feat(clash): API（202/422/results/from-clash-run 冪等）＋app 掛載`。

### Task 4: coordinator proxy — clash 路由（additive）

**Files:**
- Modify: `bim-review-coordinator/src/routes/governanceProxy.ts`（federated-sets 區 :249-266 之後）

- [ ] **Step 1: 加路由**（仿既有寫法；GET results 帶 query 用檔內 `queryString` helper）：

```ts
// A3 clash proxy（Spec-3；additive）。
app.get("/api/governance/clash-engine", (_request, response) => {
  void forward(response, "GET", "/api/clash-engine");
});
app.post("/api/governance/clash-runs", (request, response) => {
  void forward(response, "POST", "/api/clash-runs", request.body);
});
app.get("/api/governance/clash-runs/:runId", (request, response) => {
  void forward(response, "GET", `/api/clash-runs/${encodeURIComponent(request.params.runId)}`);
});
app.get("/api/governance/clash-runs/:runId/results", (request, response) => {
  void forward(response, "GET", `/api/clash-runs/${encodeURIComponent(request.params.runId)}/results${queryString(request.originalUrl)}`);
});
app.post("/api/governance/issues/from-clash-run/:runId", (request, response) => {
  void forward(response, "POST", `/api/issues/from-clash-run/${encodeURIComponent(request.params.runId)}`, request.body);
});
```

- [ ] **Step 2: `npm run verify` 綠＋`detect_changes`。** — [ ] **Step 3: Commit** — `feat(proxy): clash 路由透傳（additive）`。

### Task 5: `#a3` Clash Panel（UI）

**Files:**
- Modify: `web-viewer-sample/src/console/governanceClient.ts`（additive 四函式＋型別）
- Modify: `web-viewer-sample/src/console/pages.tsx`（`FederationPage` :2047，build 成功區之後）
- Test: `web-viewer-sample/src/console/A3ClashPanel.test.tsx`（新檔）

**Interfaces:**
- Produces(client)：`clashEngine()`、`createClashRun(body)`、`getClashRun(id)`、`getClashResults(id, limit=50, offset=0)`、`issuesFromClashRun(runId, body?)`——路徑對 Task 4，jsonFetch 寫法仿檔內既有。
- UI 狀態機：`probe 不可用 → guard 態`；`未跑 → 空狀態（模式 6）`；`queued/running → 輪詢 2000ms`；`succeeded → 結果表`；`failed → 錯誤原因`。

- [ ] **Step 1: 寫失敗測試** — 三個 case：
  1. `clashEngine` 回 `{available:false, reason:"no OCC"}` → panel 顯 `data-testid="a3-clash-guard"` 含「碰撞引擎不可用（缺 OCC）」，**無**執行鈕、**無**任何 0/數字。
  2. 可用＋建 run（mock `createClashRun`→202 含 `size_warning:true`）→ IntentDialog 文案含 size 警告；confirm 後輪詢 `getClashRun` 到 succeeded → `getClashResults` 渲染表（severity Badge、兩構件 GUID）。
  3. 勾選兩筆按「轉 Issue」→ `issuesFromClashRun` 被呼叫、成功顯 created 數（證據型）。
- [ ] **Step 2: 跑測試確認失敗**。
- [ ] **Step 3: 實作** — FederationPage 在 build 成功資訊區後加 Panel：guard 態（probe mount 時抓一次）；執行區（pair 輸入：預設以 set members 的 `discipline` 兩兩配對列出、每對兩個 server-local IFC path 輸入框——federation 只存 usd_path，IFC 路徑由操作員填，欄位下註記可從 `#a1` 檔案庫複製路徑；tolerance 輸入預設 0.002）；IntentDialog 確認（含 size_warning 文案）；輪詢與結果表（`{items,total}`、severity 用既有 Badge/ProvTag 樣式、checkbox 勾選）；「轉 Issue（可帶指派）」鈕＋assignee 輸入（呼 `issuesFromClashRun(runId, {clash_ids, assignee})`）；3D 飛點鈕 render `disabled` `prov="p15"` caption「M4 後接 highlightPrimsRequest（source:a3）」。全區證據型更新、未跑=空狀態不畫數字。
- [ ] **Step 4: 測試通過＋`npm run verify`**。
- [ ] **Step 5: Commit** — `feat(a3): Clash Panel（guard/size 警告/結果/轉 Issue）`。

### Task 6: 真資料 E2E＋抽查＋PR

- [ ] **Step 1: 引擎態 E2E** — 依 Task 0 結論二擇一：(a) 引擎可用：對 storage 兩份真 IFC 建 federated set→build→clash run→結果清單截圖；跑 `artifacts/tmp-clash-spike/sample10.py`（讀 results API 取前 10 筆，輸出兩構件 GUID＋類別＋position 到 `artifacts/e2e/a3-clash/sample10.txt` 供人工抽查）；轉 Issue→重按一次驗冪等（created=0）。(b) 引擎不可用：guard 態截圖（「碰撞引擎不可用」）＋422 API 證據——此即 hard-guard 交付。
- [ ] **Step 2: 截圖落 `artifacts/e2e/a3-clash/`**（`git add -f`）。
- [ ] **Step 3: spec 補實作狀態行**（`2026-07-07-a3-clash-ifcclash-design.md`）＋RESULT.md 摘要進 PR body；開 PR `feat(a3): clash 碰撞偵測（Spec-3）`，body 填 Frontend Verification＋governance 表格；`app.py` diff 確認僅兩行；`gh pr merge --squash --auto --delete-branch`。
