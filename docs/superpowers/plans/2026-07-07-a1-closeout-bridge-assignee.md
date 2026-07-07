# A1 閉環收尾（連動橋＋assignee）Implementation Plan（Spec-1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Spec：`docs/superpowers/specs/2026-07-07-a1-closeout-bridge-assignee-design.md`
> 前置：INFRA plan（`2026-07-07-infra-capability-slice.md`）Task 1/2 已 merge（`leaseEvidence()` 與供應端已在）。

**Goal:** A1 連動橋高亮真正可用（證據綠→handoff→Review Room 高亮→ack），BCF 審查面板指派欄從待建翻真（O7 已拍板：自由文字 assignee）。

**Architecture:** 重大現況修正——**assignee 後端大半已存在**：issues 表已有 `assignee` 欄（store.py:27-55）、`IssueCreate.assignee` 已收值（api.py:36-49）、BCF `AssignedTo` 已會寫（bcf_writer.py:73-74）。缺的是：**事後改指派 endpoint＋audit、from-* 帶指派、proxy 路由、前端 UI**。連動橋依 2026-07-02 解耦架構：A1 **不**自開 DataChannel，高亮＝證據綠時 handoff 到 Review Room，由 `ReviewSessionViewerPane` 發 `highlightPrimsRequest` 並以 ack 為準。

**Tech Stack:** FastAPI + SQLite（governance-service）、Express proxy（coordinator）、React 18 + Vitest（console）。

## Global Constraints

- **解凍範圍（使用者 2026-07-07 簽核，僅 additive）**：`governance-service/issues/api.py`、`governance-service/issues/store.py`、`bim-review-coordinator/src/routes/governanceProxy.ts`（逐路由註冊制，新端點必須加路由——已查證非 catch-all）。`bcf/bcf_writer.py` 經查**免改**（AssignedTo 已實作）。其餘凍結檔禁改；既有路徑字串 byte-identical。
- status enum `open/assigned/in_progress/resolved/rejected/reopened` 逐字不動；指派**不**自動改 status。
- 誠實鐵律：證據型更新（POST 成功→重抓→才更新）、ack 才算成功、`usd_prim_path=null` 禁捏造。
- governance-service 測試：`cd governance-service && "/c/Program Files/Python312/python.exe" -m pytest tests/ -v`（host Python 3.12；勿用 root .venv）。
- coordinator 驗證：`cd bim-review-coordinator && npm run verify`。console 驗證：`cd web-viewer-sample && npm run verify`。
- 每 Task 前 GitNexus `impact`、commit 前 `detect_changes`。分支：`feat/a1-bridge-assignee`。

---

### Task 1: 後端 assign endpoint（additive）

**Files:**
- Modify: `governance-service/issues/store.py`（`IssueStore`，transition 在 :189-221 可仿）
- Modify: `governance-service/issues/api.py`（端點群 :51-115）
- Test: `governance-service/tests/test_issues.py`（fixture `client_and_db` :10-17 現成）

**Interfaces:**
- Produces: `POST /api/issues/{issue_id}/assign`，body `{"assignee": string|null}` → 回完整 issue dict（含 `assignee`）；404 issue 不存在。audit：`issue_events` 插一筆 `event_type="assign"`。
- Produces(store): `IssueStore.assign(issue_id: str, assignee: Optional[str]) -> dict`。

- [ ] **Step 1: 寫失敗測試**（加進 `test_issues.py`）

```python
def test_assign_set_clear_and_audit(client_and_db):
    client, _ = client_and_db
    iid = client.post("/api/issues", json={"title": "t", "ifc_guid": "G1"}).json()["id"]

    # 設值
    r = client.post(f"/api/issues/{iid}/assign", json={"assignee": "MEP 王小明"})
    assert r.status_code == 200
    assert r.json()["assignee"] == "MEP 王小明"
    # status 不因指派而變
    assert r.json()["status"] == "open"

    # 清除
    assert client.post(f"/api/issues/{iid}/assign", json={"assignee": None}).json()["assignee"] is None

    # audit：created + 2 次 assign = 3 events；assign 事件帶前後值
    events = client.get(f"/api/issues/{iid}").json()["events"]
    assert [e["event_type"] for e in events] == ["created", "assign", "assign"]
    assert "MEP 王小明" in events[1]["note"]

    # 404
    assert client.post("/api/issues/iss_nope/assign", json={"assignee": "x"}).status_code == 404


def test_create_with_assignee_roundtrip(client_and_db):
    client, _ = client_and_db
    created = client.post("/api/issues", json={"title": "t", "ifc_guid": "G1", "assignee": "阿強"}).json()
    assert created["assignee"] == "阿強"
    listed = client.get("/api/issues").json()["issues"]
    assert listed[0]["assignee"] == "阿強"
```

- [ ] **Step 2: 跑測試確認失敗** — `"/c/Program Files/Python312/python.exe" -m pytest tests/test_issues.py -v -k assign`，預期 404/405 類失敗。
- [ ] **Step 3: 實作**

store.py（時間戳與交易寫法**逐字仿 transition 區塊 :189-221 的既有 locals**）：

```python
def assign(self, issue_id: str, assignee: Optional[str]) -> dict:
    with self._conn() as conn:
        conn.isolation_level = None
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM issues WHERE id=?", (issue_id,)).fetchone()
        if row is None:
            conn.execute("ROLLBACK")
            raise KeyError(issue_id)
        now = _now()  # ← 用 transition 區塊同一個時間戳 helper／寫法
        old = row["assignee"]
        conn.execute("UPDATE issues SET assignee=?, updated_at=? WHERE id=?", (assignee, now, issue_id))
        conn.execute(
            "INSERT INTO issue_events(id, issue_id, event_type, from_status, to_status, note, created_at)"
            " VALUES(?,?,?,?,?,?,?)",
            (_new_id("ev"), issue_id, "assign", None, None,
             f"assignee: {old or '-'} -> {assignee or '-'}", now),
        )
        conn.execute("COMMIT")
    return self.get_issue(issue_id)
```

api.py（models 區 :36-49 加、端點放 transition 之後）：

```python
class AssignBody(BaseModel):
    assignee: Optional[str] = None


@router.post("/api/issues/{issue_id}/assign")
def assign_issue(issue_id: str, body: AssignBody):
    try:
        return _get_store().assign(issue_id, body.assignee)
    except KeyError:
        raise HTTPException(status_code=404, detail="issue not found")
```

- [ ] **Step 4: 跑測試確認通過**，再全套 `pytest tests/ -v` 確認零回歸。
- [ ] **Step 5: Commit** — `feat(issues): assign endpoint + audit（O7）`。

### Task 2: from-rule-run / from-diff 支援建立即指派（additive body）

**Files:**
- Modify: `governance-service/issues/api.py`（`issues_from_rule_run` :83-84、`issues_from_diff` :114-115）
- Test: `governance-service/tests/test_issues.py`（seed helpers `_seed_rule_run`/`_seed_diff` :20-45 現成）

**Interfaces:**
- Produces: 兩端點接受 optional JSON body `{"assignee": string}`；批次建立的每筆 issue 帶該 assignee。proxy 已透傳 body（governanceProxy.ts:283-288 已查證），**proxy 免改**。

- [ ] **Step 1: 寫失敗測試**

```python
def test_from_rule_run_with_assignee(client_and_db):
    client, db_path = client_and_db
    run_id = _seed_rule_run(db_path)
    r = client.post(f"/api/issues/from-rule-run/{run_id}", json={"assignee": "結構組"})
    assert r.status_code == 201
    for iid in r.json()["issue_ids"]:
        assert client.get(f"/api/issues/{iid}").json()["issue"]["assignee"] == "結構組"

def test_from_rule_run_without_body_unchanged(client_and_db):
    client, db_path = client_and_db
    run_id = _seed_rule_run(db_path)
    r = client.post(f"/api/issues/from-rule-run/{run_id}")   # 無 body，行為不變
    assert r.status_code == 201
```

- [ ] **Step 2: 跑測試確認失敗**（422 或 assignee 為 None）。
- [ ] **Step 3: 實作** — 兩端點簽名加 `body: Optional[AssignBody] = None`，組 batch items 時每筆 dict 加 `"assignee": (body.assignee if body else None)`；確認 `create_issues_batch`（store.py:115-166）的 INSERT 欄位清單含 `assignee`（schema 已有欄；若 INSERT 未列此欄，additive 補上並讓無值時為 None）。
- [ ] **Step 4: 測試通過＋全套 pytest 零回歸**（特別確認既有 from-diff 422 行為與冪等測試仍綠）。
- [ ] **Step 5: Commit** — `feat(issues): from-rule-run/from-diff 建立即指派（optional body）`。

### Task 3: BCF AssignedTo 驗證（verify-first，預期免改）

- [ ] **Step 1: 檢查既有測試** — `grep -n "AssignedTo" governance-service/tests/test_bcf.py`；已有覆蓋→跳到 Step 3。
- [ ] **Step 2: 補測試**（缺才補；`build_bcfzip` 可直接單元測，模式照 test_bcf.py 現有）：

```python
def test_bcfzip_topic_contains_assigned_to():
    from bcf.bcf_writer import build_bcfzip
    import io, zipfile
    issue = {"id": "iss_x", "kind": "issue", "title": "t", "status": "assigned", "severity": "high",
             "ifc_guid": "0" * 22, "assignee": "MEP 王小明", "created_at": "2026-07-07T00:00:00Z"}
    data, count = build_bcfzip([issue])
    assert count == 1
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        markup = next(n for n in z.namelist() if n.endswith("markup.bcf"))
        xml = z.read(markup).decode("utf-8")
    assert "<AssignedTo>MEP 王小明</AssignedTo>" in xml
```

- [ ] **Step 3: 跑測試**（bcf_writer.py:73-74 已實作，預期直接 PASS＝驗證完成；FAIL 才動 bcf_writer，僅允許 additive）。
- [ ] **Step 4: Commit**（若有新測試）— `test(bcf): 鎖定 AssignedTo 匯出行為`。

### Task 4: coordinator proxy — assign 路由（additive 一條）

**Files:**
- Modify: `bim-review-coordinator/src/routes/governanceProxy.ts`（issues 區 :271-288 末尾）

- [ ] **Step 1: 加路由**（逐字，仿 transition :280-282）：

```ts
app.post("/api/governance/issues/:issueId/assign", (request, response) => {
  void forward(response, "POST", `/api/issues/${encodeURIComponent(request.params.issueId)}/assign`, request.body);
});
```

- [ ] **Step 2: 驗證** — `cd bim-review-coordinator && npm run verify`（既有 proxy 測試若逐路由列舉，仿現有案例補一筆 assign 轉發測試；無此類測試則 build+test 綠即可）。
- [ ] **Step 3: `detect_changes`** — diff 僅 governanceProxy.ts 新增區塊。
- [ ] **Step 4: Commit** — `feat(proxy): governance issues assign 透傳（additive）`。

### Task 5: governanceClient — assignIssue ＋ IssueRow.assignee

**Files:**
- Modify: `web-viewer-sample/src/console/governanceClient.ts`（`transitionIssue` :201 旁；`IssueRow` 型別 additive 加 `assignee?: string | null`）
- Test: `web-viewer-sample/src/console/governanceClient.test.ts`

- [ ] **Step 1: 寫失敗測試**（照該檔既有 fetch mock 模式）：`assignIssue("iss_1", "王") → POST /api/governance/issues/iss_1/assign、body {"assignee":"王"}`；`assignIssue("iss_1", null)` body `{"assignee":null}`。
- [ ] **Step 2: 跑測試確認失敗**。
- [ ] **Step 3: 實作**（逐字仿 `transitionIssue` 的 jsonFetch 寫法）：

```ts
assignIssue: (issueId: string, assignee: string | null) =>
  jsonFetch<IssueRow>(`/api/governance/issues/${encodeURIComponent(issueId)}/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignee }),
  }),
```

- [ ] **Step 4: 測試通過**。
- [ ] **Step 5: Commit** — `feat(console): governanceClient.assignIssue`。

### Task 6: BCF 審查面板指派欄（dashed 待建 → 真控制）

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`（A1 BCF 面板表格 :870-892；`transitionA1Issue` :584-594 可仿）
- Test: `web-viewer-sample/src/console/A1BcfAssign.test.tsx`（新檔，掛載模式照 SessionManagementPage.test.tsx）

**Interfaces:**
- Consumes: Task 5 `governanceClient.assignIssue`。

- [ ] **Step 1: 寫失敗測試** — mock `listIssues` 回一筆 `{..., assignee: null}` → 面板 assignee 欄顯「未指派」＋輸入框；輸入「王」按儲存 → `assignIssue` 被呼叫、成功後欄位顯「王」（用 mockResolvedValue 回更新後 issue；斷言**先呼叫成功才更新**——mockRejectedValue 時欄位維持「未指派」並顯錯誤）。
- [ ] **Step 2: 跑測試確認失敗**。
- [ ] **Step 3: 實作** — 表頭（:871）`status` 後加 `<th>assignee</th>`；每列加：

```tsx
<td data-testid={`a1-issue-assignee-${issue.id}`}>
  <input className="ec-input" style={{ width: 90 }} defaultValue={issue.assignee ?? ""}
    placeholder={t("未指派", "unassigned")} data-testid={`a1-assignee-input-${issue.id}`} />
  <Btn data-testid={`a1-assignee-save-${issue.id}`}
    caption={`POST /api/governance/issues/${issue.id}/assign`}
    onClick={() => { void saveAssignee(issue); }}>{t("指派", "Assign")}</Btn>
</td>
```

handler（仿 transitionA1Issue :584-594，證據型更新）：

```tsx
const saveAssignee = useCallback(async (issue: IssueRow) => {
  const input = document.querySelector<HTMLInputElement>(`[data-testid="a1-assignee-input-${issue.id}"]`);
  const value = input?.value.trim() ?? "";
  setActionErr(null);
  try {
    const updated = await governanceClient.assignIssue(issue.id, value === "" ? null : value);
    setA1Issues((items) => items.map((item) => (item.id === updated.id ? updated : item)));
  } catch (e) {
    setActionErr(`${t("指派失敗：", "Assign failed: ")}${String(e)}`);
  }
}, []);
```

（「開 Issue」流程 `makeIssues`（:514-559）順帶支援批次指派：呼叫 `issuesFromRuleRun` 前若面板有預設指派輸入值則帶 body——**可選**，本 Task 最小面只做逐筆指派。）

- [ ] **Step 4: 測試通過＋`npm run verify`**。
- [ ] **Step 5: Commit** — `feat(a1): BCF 審查面板 assignee 真控制（IX-A1-07 P1 收斂）`。

### Task 7: A1 連動橋——證據驅動啟用＋多 GUID handoff＋Review Room 自動高亮

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`（A1 bridge rail :844-859、`buildA1ReviewRoomHandoffHash` :250-272、`stageMatched` :631-635、sessions loader）
- Modify: `web-viewer-sample/src/console/ReviewSessionViewerPane.tsx`（`parseReviewRoomHandoff` :38-56、auto-highlight/canHighlight :241-278）
- Test: `web-viewer-sample/src/console/A1BridgeEnable.test.tsx`（新檔）＋ `ReviewSessionViewerPane.test.tsx`（加 case）

**Interfaces:**
- Produces: handoff hash 新 optional 參數 `usd_prim_paths`（逗號分隔）＋`ifc_guids`（同序）；`parseReviewRoomHandoff` 回傳型別 additive 加 `usd_prim_paths?: string[]`。
- Consumes: `leaseEvidence()`（INFRA Task 1）、既有 `viewerRef.sendHighlight(items[])`（ReviewSessionViewerPane :269 已為陣列簽名）。

- [ ] **Step 1: 寫失敗測試（A1 端）** — 掛載 A1 頁（mock runtimeStatus 帶證據全綠 session＋mock rule-run 狀態進 scored 含 2 筆有 `usd_prim_path` 的 failures）：
  - 斷言 `[data-testid="a1-bridge-highlight"]` **enabled**，點擊後 `window.location.hash` 含 `#review?` 且 `usd_prim_paths` 含兩條路徑。
  - 證據缺一（`datachannel_ready:false`）→ disabled 且 `title` 屬性含原因。
  - failures 全無 `usd_prim_path` → disabled（title 註明 name_fallback 不可高亮）。
- [ ] **Step 2: 跑測試確認失敗**。
- [ ] **Step 3: 實作（A1 端）**
  - sessions loader 加 5000ms interval（與 `#sessions` 同 cadence；寫法同 INFRA Task 1 Step 3(c)，先定位本頁現行 runtimeStatus 載入處再包 interval）。
  - 收集 chips：從本頁 rule-run failures state 取有 `usd_prim_path` 的前 20 筆（變數名以現檔為準；若 scored 後未持有 failures 明細，於 scored 時 `governanceClient.getFailures(runId, undefined, 20, 0)` 取一次存 state）。bridge rail Field 群後渲染 chips（`data-testid="a1-bridge-chips"`，每 chip 顯 `ifc_guid`）。
  - 啟用條件（四條件缺一不可＋chips 非空）：

```tsx
const ev = selectedSessionSummary ? leaseEvidence(selectedSessionSummary, Date.now()) : null;
const bridgeReasons: string[] = [];
if (!selectedSession) bridgeReasons.push(t("未選 session", "no session"));
if (!ev?.datachannelReady) bridgeReasons.push("DataChannel");
if (!(ev?.firstFrameAt)) bridgeReasons.push("first_frame");
if (!stageMatched) bridgeReasons.push("stage_match");
if (bridgeChips.length === 0) bridgeReasons.push(t("無可高亮構件（usd_prim_path）", "no highlightable prims"));
const bridgeReady = bridgeReasons.length === 0;
```

  - 高亮鍵（取代 :853 hardcoded disabled）：

```tsx
<Btn data-testid="a1-bridge-highlight" disabled={!bridgeReady}
  caption={bridgeReady
    ? t("經 Review Room 發 highlightPrimsRequest（source:a1），以 viewer ack 為準", "...")
    : `${t("P1.5→待證據：", "blocked on: ")}${bridgeReasons.join(" / ")}（${t("開 Session 管理 →", "open Sessions →")}）`}
  onClick={() => {
    const q = new URLSearchParams({ source: "a1", session: selectedSession, rule_run_id: runId ?? "" });
    q.set("usd_prim_paths", bridgeChips.map((c) => c.usd_prim_path!).join(","));
    q.set("ifc_guids", bridgeChips.map((c) => c.ifc_guid ?? "").join(","));
    window.location.hash = `#review?${q.toString()}`;
  }}>
  {t("在 3D 中標示", "Highlight in 3D")}
</Btn>
```

  - idle 對稱：`useEffect`——`selectedSessionSummary?.status` 變 `closing|closed` 時 `setSelectedSession("")`（橋回 idle，與 `#sessions` 供應端同步）。
- [ ] **Step 4: 實作（Review Room 端）** — `parseReviewRoomHandoff` additive 解析 `usd_prim_paths`/`ifc_guids`（split(",") 過濾空值，zip 成 items）；到站且 `canHighlight` 全綠時對 items 陣列呼 `viewerRef.current?.sendHighlight(items)`（單 GUID 舊參數行為不變）；ack（`highlight_result`）沿既有 command trace 呈現。加測試：hash 帶兩條 `usd_prim_paths` → `sendHighlight` 收到 2 items。
- [ ] **Step 5: 全部測試通過＋`npm run verify`**。
- [ ] **Step 6: Commit** — `feat(a1): 連動橋證據驅動啟用＋多 GUID handoff＋RR 自動高亮（IX-A1-06/08）`。

### Task 8: IX-A1-03 驗證（verify-first）

- [ ] **Step 1: 人工驗證** — 開 `#a1` 跑一次 rule-run，點記分板規則列展開命中構件（repo 已有 `getFailures` 懶載入 :120）；行為存在→截圖為證，回報「互動規格 A.2 該項已過時」；不存在才實作（展開列呼 `getFailures(runId, rule, 50, offset)` 渲染分頁表）。
- [ ] **Step 2: Commit**（僅在需實作時）。

### Task 9: E2E 全鏈 evidence ＋ PR

- [ ] **Step 1: 無 GPU 態截圖** — `#a1`：證據未齊 disabled＋title 原因（誠實態驗收）。
- [ ] **Step 2: 真 Kit 全鏈**（部署機執行；環境依 `scripts/deploy.ps1` golden path）：選檔→檢核→審查（指派一筆→匯出 .bcfzip 解壓驗 `<AssignedTo>`）→bridge 證據四格轉綠→點高亮→Review Room 自動高亮→command trace 顯 ack。截圖＋trace 落 `artifacts/e2e/a1-bridge/`（PNG `git add -f`）。Kit 環境不可用→PR Known gaps 誠實列「GPU 段 not observed」，不得宣稱完成。
- [ ] **Step 3: 關 session 對稱驗收** — `#sessions` 結束 session → 回 `#a1` 橋回 idle（兩頁截圖）。
- [ ] **Step 4: spec 檔補實作狀態行**（`2026-07-07-a1-closeout-bridge-assignee-design.md`，滿足 missing_openspec）＋開 PR `feat(a1): 連動橋＋assignee 閉環（Spec-1）`，body 填 Frontend Verification 七列＋governance 表格；`gh pr merge --squash --auto --delete-branch`。
