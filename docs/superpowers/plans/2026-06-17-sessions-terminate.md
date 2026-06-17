# Sessions Terminate (IX-SS-04) Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

- **Goal:** 讓 `#sessions` operator 能 per-row「結束 session」——點按 → IntentDialog → 真 `POST /api/review-sessions/:id/close`（重用既有 close 路由）→ drain/release Kit binding ＋ audit（reason/actor 上事件流）→ 前端非樂觀刷新並讓該列轉灰 60s 後移除。
- **Architecture:** 後端 additive 補既有 close 路由（`bim-review-coordinator/src/app.ts:877` 的 `POST /api/review-sessions/:sessionId/close`），把 optional `reason`／`actor` additive 寫進既有 `sessionClosing`/`sessionClosed` 事件流，**零改既有 drain→release 邏輯**；前端在 `coordinatorClient.ts` 加一支 thin wrapper `sessionClose`，在 `SessionManagementPage`（`web-viewer-sample/src/console/pages.tsx:693`）的「Active sessions」表加 per-row 結束鈕＋重用既有 `IntentDialog`。資料流全程後端裁決、前端零樂觀更新。
- **Tech Stack:** 後端 TypeScript + Express（coordinator，`npm run verify` = tsc build + vitest）；前端 React + Vite（`web-viewer-sample`，vitest + Playwright e2e）。

> **權威偏離（已由使用者裁定，須寫進 PR body）：** IX-SS-04 spec 原文指定 `POST /api/sessions/:id/terminate`；本實作**重用 `POST /api/review-sessions/:sessionId/close`**，不開新路由。理由：cooperative `close`（drain→release binding＋append 終結事件）在語意上是 operator `terminate` 的超集，行為等價；最小改動、零重複 release 邏輯。權威序「使用者最新明確指令 > docs/plans 行為合約」故合規。UI 文案與 PR body 須標「結束＝協作式 close 的 operator 觸發」。
>
> **任務相依（嚴格順序）：** Task 1（後端 additive，回歸鎖）→ Task 2（client wrapper，依賴 Task 1）→ Task 3（前端 UI，依賴 Task 2）→ Task 4（前端 vitest）→ Task 5（GitNexus detect_changes）→ Task 6（browser E2E，最後）。
>
> **執行前置（spec §7）：** 本 spec 為排隊產物，須等 conv-watch-toggle（IX-CV-04 / PR #225）merge 進 main 後再開跑。本 worktree 已確認 main 含 #225（`resolveActor` @ `app.ts:655`、`parseReason` @ `app.ts:661`、`IntentDialog` @ `web-viewer-sample/src/console/IntentDialog.tsx`、`jsonPost` @ `coordinatorClient.ts:35`），共用件齊備，可直接實作。

---

## 已盤點的精確現狀（執行者零脈絡，直接用以下事實，不要再猜路徑）

- **close 路由**：`bim-review-coordinator/src/app.ts:877-911`，`app.post("/api/review-sessions/:sessionId/close", ...)`。現狀：`isSafeSessionId` 400（878-880）→ `store.get` 404（882-886）→ 已 `closed` 冪等回傳（887-890）→ `finalEvents = Array.isArray(request.body?.final_events) ? ... : []`（892）→ `store.update(status:"closing", markKitBindingsDraining)`（893-896）→ `eventLog.append(session.session_id, "sessionClosing", { final_events: finalEvents.length })`（897）→ 逐筆 `finalReviewEvent`（898-900）→ `store.update(status:"closed", participants:[], releaseKitBindings)`（901-905）→ `eventLog.append(session.session_id, "sessionClosed", {})`（906）→ `eventLog.append(session.session_id, "kitInstanceReleased", {...})`（907-909）→ `response.json(closed)`（910）。
- **actor/reason helper 已存在（#225）**：`resolveActor(request: express.Request): string`（`app.ts:655-660`，讀 `X-Operator`/`X-Actor` header，無則 `"local-operator"`，`.slice(0,200)`）；`parseReason(request): string`（`app.ts:661-664`，`request.body?.reason` string → `.slice(0,500)`，否則 `""`）。**重用這兩支，不要重新定義。**
- **safe-id pattern**：`bim-review-coordinator/src/services/sessionStore.ts:15` `const safeSessionIdPattern = /^review_session_[A-Za-z0-9_-]+$/;` ⇒ 只認 `review_session_` 前綴；`lwv_` 會被 400。
- **runtime status 的 session 形狀**：`summarizeSessionForRuntime`（app.ts）emit `session_id: session.session_id`（即 `review_session_` 前綴）、`status: session.status`（`created`/`active`/`closing`/`closed`）；故前端依 `s.status` 判斷可顯按鈕。
- **既有 close route 測試**：`bim-review-coordinator/tests/sessions.test.ts`——已涵蓋 `final_events` 上事件流（852-870）、release after close（822-849）、冪等（705-721）、safe-id 400（1005）、404（1016）、完整事件序 `["sessionCreated","sessionActive","sessionClosing","sessionClosed","kitInstanceReleased"]`（889-903）。新測試擴充此檔。
- **client 物件**：`web-viewer-sample/src/console/coordinatorClient.ts:215-233` 的 `export const coordinatorClient = {...}`，已有 `jsonPost`（35）、`runtimeStatus`（218）、`conversionPrioritize`（224）、`conversionRetry`（226）、`conversionWatchToggle`（228）。`RuntimeSessionSummary`（91-102）已含 `session_id`/`status`/`participant_count`/`expected_stage_url`/`conversion_status`。
- **`#sessions` 前端**：`SessionManagementPage`（`pages.tsx:693-732`）。讀 `coordinatorClient.runtimeStatus()`（698），`sessions = rt?.sessions.items ?? []`（702）。「Active sessions」表（716-723）：`<thead>` 五欄（718），`<tbody>{sessions.map((s)=> <tr>...<td>{s.session_id}</td>...<td>{s.status}</td>...</tr>)}`（719-721），**唯讀、無動作欄**。「Controlled actions」面板（724-729）四顆全 disabled（含 727「Reclaim stale spectator」、728「Force release / restart primary」屬 IX-SS-03 須維持 disabled）。
- **參考 pattern（直接照抄結構）**：`ConversionSchedulingPage`（`pages.tsx:439+`）的 `pendingAction`/`actionBusy`/`actionBusyRef`/`actionErr` state（453-460）與 `runAction`（512-543）——非樂觀、POST 成功後 `await load()` 重抓、失敗 `setActionErr` 不關 dialog。`IntentDialog`（`pages.tsx:668-688` 的用法）。
- **`IntentDialog`**：`web-viewer-sample/src/console/IntentDialog.tsx`，props `{open,title,cost,onConfirm:(reason)=>void|Promise<void>,onCancel,busy,actionErr}`；testid `intent-dialog`/`intent-confirm`/`intent-cancel`/`intent-action-error`。非樂觀、uncontrolled reason textarea。
- **前端 page 測試 pattern**：`web-viewer-sample/src/console/ConversionSchedulingPage.test.tsx`（`renderToString` 做 SSR snapshot ＋ `createRoot`/`act` 做 client render，`vi.spyOn(coordinatorClient, ...)` mock）。client 測試：`coordinatorClient.test.ts`。
- **e2e 慣例**：`web-viewer-sample/e2e/`，參考 `conv-prioritize-retry.spec.ts`（守門 conditional skip + `notObserved[]` + `test.afterAll` 揭露 + render-surface 證據 describe）。coordinator base 走 `process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005"`，截圖落 `../artifacts/e2e/...` 與 tracked `../docs/evidence/...`。
- **驗證指令**：coordinator `cd bim-review-coordinator && npm run verify`（= `tsc -p tsconfig.json && vitest run`）；前端 `cd web-viewer-sample && npm run test`（`vitest run`）；e2e `cd web-viewer-sample && npm run test:e2e`（`playwright test`）。

---

### Task 1: 後端 close 路由 additive 補 audit（reason/actor 上事件流；回歸鎖）

**Files**
- Modify: `bim-review-coordinator/src/app.ts`（close handler `app.post("/api/review-sessions/:sessionId/close", ...)`，行 877-911）
- Test: `bim-review-coordinator/tests/sessions.test.ts`（既有 session close 測試擴充）

- [ ] **寫失敗測試（reason/actor 上 audit）**：在 `bim-review-coordinator/tests/sessions.test.ts` 既有 `describe`（與 line 852「close stores final_events in the event log」同層）末尾新增測試。先讀檔頭既有 helper（建 session 的 `request(app.app).post("/api/review-sessions")...`，沿用 852-870 的 fixture 寫法）。

  ```ts
  it("close threads reason/actor into sessionClosing and sessionClosed audit payloads", async () => {
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({ project_id: "271", model_version_id: "mv_terminate_audit", artifact_bindings: [] });
    expect(created.status).toBe(201);
    const sessionId = created.body.session_id;

    const closed = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/close`)
      .set("X-Operator", "alice@lan")
      .send({ reason: "operator terminate via #sessions" });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");
    // reason 不外溢回傳 body（形狀不退化）
    expect(closed.body.reason).toBeUndefined();

    const events = await request(app.app).get(`/api/review-sessions/${sessionId}/events`);
    const closing = events.body.items.find((e: { type: string }) => e.type === "sessionClosing");
    const closedEvt = events.body.items.find((e: { type: string }) => e.type === "sessionClosed");
    expect(closing.payload.reason).toBe("operator terminate via #sessions");
    expect(closing.payload.actor).toBe("alice@lan");
    expect(closedEvt.payload.reason).toBe("operator terminate via #sessions");
    expect(closedEvt.payload.actor).toBe("alice@lan");
  });
  ```

- [ ] **跑確認失敗（RED）**：

  ```bash
  cd bim-review-coordinator && npx vitest run tests/sessions.test.ts -t "reason/actor into sessionClosing"
  ```

  預期輸出含 `1 failed`：`expected undefined to be "operator terminate via #sessions"`（現狀 `sessionClosing` payload 只有 `final_events`、`sessionClosed` 為 `{}`）。

- [ ] **最小實作（additive 三行）**：編輯 `bim-review-coordinator/src/app.ts` close handler。在行 892（`const finalEvents = ...`）之後插入兩行解析；改行 897 與 906 的 append payload。**行 893-896（drain）、898-905（release）、907-910（kitInstanceReleased + response）零改動。**

  ```ts
    const finalEvents = Array.isArray(request.body?.final_events) ? request.body.final_events : [];
    const reason = parseReason(request);                 // ← additive：重用 #225 helper（app.ts:661），缺省 ""
    const actor = resolveActor(request);                 // ← additive：重用 #225 helper（app.ts:655），缺省 "local-operator"
    const closing = store.update(session.session_id, {
      status: "closing",
      kit_instance_bindings: markKitBindingsDraining(session.kit_instance_bindings),
    });
    eventLog.append(session.session_id, "sessionClosing", { final_events: finalEvents.length, reason, actor });  // ← additive 欄
    for (const event of finalEvents) {
      eventLog.append(session.session_id, "finalReviewEvent", event);
    }
    const closed = store.update(session.session_id, {
      status: "closed",
      participants: [],
      kit_instance_bindings: releaseKitBindings(closing?.kit_instance_bindings || session.kit_instance_bindings),
    });
    eventLog.append(session.session_id, "sessionClosed", { reason, actor });   // ← additive 欄（原 {}）
  ```

  注意：`parseReason` 回傳 `""`（非 `undefined`）當無 reason；測試 assert 的是有送 reason 的路徑。`reason` 不入 `response.json(closed)`（910 不動），故回傳形狀不退化。

- [ ] **跑確認通過（GREEN）**：

  ```bash
  cd bim-review-coordinator && npx vitest run tests/sessions.test.ts -t "reason/actor into sessionClosing"
  ```

  預期 `1 passed`。

- [ ] **寫回歸鎖測試（不帶 reason 的 cooperative close 零退化）**：在同檔新增。

  ```ts
  it("close without reason leaves cooperative behavior unchanged (reason absent, release intact)", async () => {
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({ project_id: "271", model_version_id: "mv_no_reason", artifact_bindings: [] });
    const sessionId = created.body.session_id;
    const closed = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/close`)
      .send({ final_events: [{ type: "annotationSnapshot", count: 1 }] });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");
    expect(closed.body.kit_instance_bindings.every((b: { status: string }) => b.status === "released")).toBe(true);
    const events = await request(app.app).get(`/api/review-sessions/${sessionId}/events`);
    const closedEvt = events.body.items.find((e: { type: string }) => e.type === "sessionClosed");
    expect(closedEvt.payload.actor).toBe("local-operator");   // 無 header → 預設
    expect(closedEvt.payload.reason).toBe("");                // 無 reason → 空字串（parseReason 缺省）
    const finalReview = events.body.items.find((e: { type: string }) => e.type === "finalReviewEvent");
    expect(finalReview).toBeTruthy();                          // final_events 路徑零退化
  });
  ```

- [ ] **跑全 close 測試 + build（回歸鎖確認形狀不破）**：

  ```bash
  cd bim-review-coordinator && npm run verify
  ```

  預期 `tsc` 0 error；vitest 全綠（既有 close/release/idempotent/safe-id/404/event-order 測試 + 兩支新測試全 pass）。若既有 `["sessionCreated","sessionActive","sessionClosing","sessionClosed","kitInstanceReleased"]`（903）測試因 payload 加欄而失敗——**不應發生**（該測試只比 `type` 序，不比 payload）；若失敗代表動到了不該動的行，回退重看 diff。

- [ ] **commit**：

  ```bash
  cd bim-review-coordinator && git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/stupefied-euler-7d2845" add bim-review-coordinator/src/app.ts bim-review-coordinator/tests/sessions.test.ts && git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/stupefied-euler-7d2845" diff --cached --check && git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/stupefied-euler-7d2845" commit -m "feat(coordinator): #sessions close 路由 additive 補 reason/actor audit（IX-SS-04）"
  ```

---

### Task 2: 前端 client thin wrapper `sessionClose`

**Files**
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`（`coordinatorClient` 物件 215-233，及新增回傳型別）
- Test: `web-viewer-sample/src/console/coordinatorClient.test.ts`

- [ ] **寫失敗測試**：在 `web-viewer-sample/src/console/coordinatorClient.test.ts` 新增。先讀檔頭既有 `fetch` mock 慣例（檔內既有 `conversionPrioritize`/`conversionWatchToggle` 的測試可照抄結構）。

  ```ts
  it("sessionClose POSTs to /close with reason body and encodes session id", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ session_id: "review_session_abc", status: "closed" }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const res = await coordinatorClient.sessionClose("review_session_abc", "operator terminate");
    expect(res.status).toBe("closed");
    expect(calls[0].url).toContain("/api/review-sessions/review_session_abc/close");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ reason: "operator terminate" });
  });
  ```

- [ ] **跑確認失敗（RED）**：

  ```bash
  cd web-viewer-sample && npx vitest run src/console/coordinatorClient.test.ts -t "sessionClose POSTs"
  ```

  預期 `1 failed`：`coordinatorClient.sessionClose is not a function`。

- [ ] **最小實作**：編輯 `web-viewer-sample/src/console/coordinatorClient.ts`。在 `ConversionControlResponse` interface（207-213）附近新增最小回傳型別；在 `coordinatorClient` 物件（229 的 `conversionWatchToggle` 之後）新增 `sessionClose`。

  ```ts
  // IX-SS-04：POST /api/review-sessions/:id/close 回傳（重用 close 路由；只取消費端用到的欄位）。
  export interface SessionCloseResponse {
    session_id: string;
    status: string;
  }
  ```

  ```ts
    conversionWatchToggle: (enabled: boolean, reason?: string) =>
      jsonPut<MinioWatchStatus>("/api/conversion/watch", { enabled, reason }),
    // IX-SS-04：operator「結束 session」＝協作式 close 的觸發。重用既有 jsonPost；body 只帶 reason，
    // 不帶 final_events（operator 強制結束無協作終結事件，spec §4.2）。
    sessionClose: (sessionId: string, reason?: string) =>
      jsonPost<SessionCloseResponse>(`/api/review-sessions/${encodeURIComponent(sessionId)}/close`, { reason }),
  ```

- [ ] **跑確認通過（GREEN）**：

  ```bash
  cd web-viewer-sample && npx vitest run src/console/coordinatorClient.test.ts -t "sessionClose POSTs"
  ```

  預期 `1 passed`。

- [ ] **commit**：

  ```bash
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/stupefied-euler-7d2845" add web-viewer-sample/src/console/coordinatorClient.ts web-viewer-sample/src/console/coordinatorClient.test.ts && git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/stupefied-euler-7d2845" diff --cached --check && git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/stupefied-euler-7d2845" commit -m "feat(web-viewer): coordinatorClient 新增 sessionClose wrapper（IX-SS-04）"
  ```

---

### Task 3: 前端 `#sessions` per-row「結束 session」真按鈕 + 灰列 60s UX

**Files**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`SessionManagementPage`，693-732）

- [ ] **加 state 與 import**：編輯 `SessionManagementPage`（`pages.tsx:693`）。在 `const [rt, setRt] = ...`（694）下方加 controlled-action state（照抄 `ConversionSchedulingPage` 的 `actionBusyRef` 防重入 pattern，並加 terminate 專屬 state）。確認檔頭 import 已含 `useState`/`useCallback`/`useEffect`/`useRef`（`pages.tsx:3` 已全有）；`IntentDialog` import（檔內既用，確認在 import 區）。

  ```tsx
    const [pendingTerminate, setPendingTerminate] = useState<{ sessionId: string } | null>(null);
    const [actionBusy, setActionBusy] = useState(false);
    const actionBusyRef = useRef(false);
    const [actionErr, setActionErr] = useState<string | null>(null);
    const [terminatingIds, setTerminatingIds] = useState<Set<string>>(new Set());
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  ```

- [ ] **加 `markTerminating` 與 timer cleanup**：在 `load`（696-700）下方加。

  ```tsx
    const markTerminating = useCallback((id: string) => {
      setTerminatingIds((prev) => new Set(prev).add(id));
      const t = setTimeout(() => {
        setTerminatingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
        timersRef.current.delete(id);
      }, 60_000);
      timersRef.current.set(id, t);
    }, []);
    // unmount 清除所有 60s timer，避免 setState-after-unmount / leak（spec §7）。
    useEffect(() => () => { for (const t of timersRef.current.values()) clearTimeout(t); timersRef.current.clear(); }, []);
  ```

- [ ] **加 `runTerminate`（非樂觀，照抄 ConversionSchedulingPage runAction 結構）**：

  ```tsx
    const runTerminate = useCallback(async (reason: string) => {
      if (!pendingTerminate) return;
      if (actionBusyRef.current) return;            // 同步防重入（state 尚未更新前）
      actionBusyRef.current = true;
      setActionBusy(true);
      setActionErr(null);
      const sessionId = pendingTerminate.sessionId;
      try {
        await coordinatorClient.sessionClose(sessionId, reason);   // 真 POST，body 只帶 reason
        markTerminating(sessionId);                                // 該列轉灰，60s 後移除（看見因果）
        setPendingTerminate(null);
        await load();                                              // 非樂觀：重抓 runtime/status 真狀態
      } catch (e) {
        setActionErr(`結束 session 失敗：${String(e)}`);          // 誠實錯誤、不關 dialog、不改狀態
      } finally {
        actionBusyRef.current = false;
        setActionBusy(false);
      }
    }, [pendingTerminate, load, markTerminating]);
  ```

- [ ] **改「Active sessions」表加動作欄 + 灰列**：把 `pages.tsx:716-723` 的 Panel 內表格改為（thead 加一欄「動作」，tbody 每列依 `s.status` 與 `terminatingIds` 決定灰列/按鈕）。

  ```tsx
        <Panel title="Active sessions" sub="coordinator-owned session summary" prov="asbuilt">
          {sessions.length ? (
            <table className="ec-table"><thead><tr><th>session</th><th>status</th><th>participants</th><th>conversion</th><th>stage</th><th>動作</th></tr></thead>
              <tbody>{sessions.filter((s) => !(terminatingIds.has(s.session_id) === false && false)).map((s) => {
                const terminating = terminatingIds.has(s.session_id);
                const ended = s.status === "closing" || s.status === "closed";
                const greyed = terminating || ended;
                return (
                  <tr key={s.session_id} className={greyed ? "ec-row-muted" : undefined} data-testid={`session-row-${s.session_id}`} data-terminating={terminating ? "true" : undefined}>
                    <td>{s.session_id}</td><td>{s.status}</td><td>{s.participant_count}</td><td>{s.conversion_status ?? "—"}</td><td>{s.expected_stage_url ?? "—"}</td>
                    <td>{s.status === "active" && !terminating ? (
                      <Btn data-testid={`session-terminate-${s.session_id}`} onClick={() => { setActionErr(null); setPendingTerminate({ sessionId: s.session_id }); }}>結束 session</Btn>
                    ) : <span className="ec-note">{terminating ? "結束中…" : "—"}</span>}</td>
                  </tr>
                );
              })}</tbody></table>
          ) : <p className="ec-note">目前 runtime status 無 active session；下面 endpoint pool 為治理規則示意。</p>}
        </Panel>
  ```

  注意：`filter(...)` 的 `terminatingIds.has(...) === false && false` 恆 false ⇒ 不過濾任何列（灰列仍顯示直到 60s timer 移出 `terminatingIds` 且 `load()` 把 `closed` session 移出 `sessions.items`）。**若 runtime/status 在 session `closed` 後仍回傳該 session，灰列由 `ended` 分支維持；60s 後 `terminatingIds` 清除，列是否消失取決於後端是否仍 emit 該 session——以後端真狀態為準，不前端硬刪。** 確認 `Btn` 支援 `data-testid` 透傳（檔內 `conv-retry-*` 已用 `data-testid` 於 `Btn`，見 `pages.tsx:651`，pattern 一致）。

- [ ] **掛 IntentDialog（重用，誠實成本文案）**：在 `SessionManagementPage` 的 `return` 內最外層 fragment 末尾（`</>` 前，`pages.tsx:730` 之前）加。

  ```tsx
        <IntentDialog
          open={pendingTerminate != null}
          title="結束 session"
          cost="將結束此 session 並釋放其 Kit 座位，座位可被新 viewer 取用。這不會強制關閉 GPU 上的 Kit 行程（Kit 行程 lifecycle 屬 kit-manager-api）。結束＝協作式 close 的 operator 觸發。"
          busy={actionBusy}
          actionErr={actionErr}
          onConfirm={runTerminate}
          onCancel={() => { if (!actionBusy) { setActionErr(null); setPendingTerminate(null); } }}
        />
  ```

- [ ] **「Controlled actions」面板註記更新（保留 IX-SS-03 disabled）**：把 `pages.tsx:724` 的 Panel `sub` 改為標明 per-row 結束已落地、stale spectator / force release 仍待 IX-SS-02 telemetry；727/728 兩顆 disabled 維持不動。

  ```tsx
        <Panel title="Controlled actions" sub="per-row「結束 session」已落地（IX-SS-04，見上表）；Reclaim stale spectator / Force release 待 IX-SS-02 心跳遙測，維持 disabled（不提供假按鈕）" prov="p1">
  ```

- [ ] **加灰列樣式（若 `ec-row-muted` 不存在）**：先檢查既有 css。

  ```bash
  cd web-viewer-sample && grep -rn "ec-row-muted" src/
  ```

  若無命中，於 console 的 css 檔（`grep -rln "ec-table" src/console/ | head -1` 找到的 css）新增 `.ec-row-muted { opacity: 0.5; }`；若已存在則不動。

- [ ] **build 確認型別過**：

  ```bash
  cd web-viewer-sample && npm run build
  ```

  預期 `vite build` 成功、無 TS error。

- [ ] **commit**：

  ```bash
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/stupefied-euler-7d2845" add web-viewer-sample/src/console/pages.tsx && git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/stupefied-euler-7d2845" diff --cached --check && git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/stupefied-euler-7d2845" commit -m "feat(web-viewer): #sessions per-row 結束 session 鈕 + 灰列 60s UX（IX-SS-04）"
  ```

---

### Task 4: 前端 vitest（`SessionManagementPage` 行為）

**Files**
- Create: `web-viewer-sample/src/console/SessionManagementPage.test.tsx`

- [ ] **寫測試（照抄 `ConversionSchedulingPage.test.tsx` 的 SSR + client render 雙模式）**：先讀 `ConversionSchedulingPage.test.tsx`（1-90）確認 `act`/`createRoot`/`IS_REACT_ACT_ENVIRONMENT` boilerplate 與 `vi.spyOn(coordinatorClient, ...)` 用法，照抄到新檔。

  ```tsx
  import { act } from "react";
  import { renderToString } from "react-dom/server";
  import { createRoot } from "react-dom/client";
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import { SessionManagementPage } from "./pages";
  import { coordinatorClient, type RuntimeStatus } from "./coordinatorClient";

  function rtWith(status: string): RuntimeStatus {
    return {
      service: { status: "ok", name: "coord", uptime_seconds: 1, generated_at: "2026-06-17T00:00:00Z" },
      sessions: { count: 1, active_count: status === "active" ? 1 : 0, participant_count: 0, items: [{
        session_id: "review_session_t1", status, project_id: "271", model_version_id: "mv1",
        participant_count: 0, expected_stage_url: null, conversion_status: null,
        kit_instance_ids: [], created_at: "2026-06-17T00:00:00Z", updated_at: "2026-06-17T00:00:00Z",
      }] },
    } as unknown as RuntimeStatus;
  }

  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let prevActEnv: unknown;
  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    vi.useRealTimers();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  describe("SessionManagementPage 結束 session 控制動作（IX-SS-04）", () => {
    it("active session 顯示結束鈕；closed 不顯", async () => {
      vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rtWith("active"));
      const root = createRoot(container);
      await act(async () => { root.render(<SessionManagementPage />); });
      await act(async () => { await Promise.resolve(); });
      expect(container.querySelector('[data-testid="session-terminate-review_session_t1"]')).toBeTruthy();
    });

    it("closed session 不給結束鈕（灰列、無假按鈕）", async () => {
      vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rtWith("closed"));
      const root = createRoot(container);
      await act(async () => { root.render(<SessionManagementPage />); });
      await act(async () => { await Promise.resolve(); });
      expect(container.querySelector('[data-testid="session-terminate-review_session_t1"]')).toBeNull();
      expect(container.querySelector('[data-testid="session-row-review_session_t1"]')?.className).toContain("ec-row-muted");
    });

    it("confirm 呼叫 sessionClose 後 load() 重抓（非樂觀，呼叫序）", async () => {
      const rtSpy = vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rtWith("active"));
      const closeSpy = vi.spyOn(coordinatorClient, "sessionClose").mockResolvedValue({ session_id: "review_session_t1", status: "closed" });
      const root = createRoot(container);
      await act(async () => { root.render(<SessionManagementPage />); });
      await act(async () => { await Promise.resolve(); });
      await act(async () => { (container.querySelector('[data-testid="session-terminate-review_session_t1"]') as HTMLButtonElement).click(); });
      expect(container.querySelector('[data-testid="intent-dialog"]')).toBeTruthy();
      await act(async () => { (container.querySelector('[data-testid="intent-confirm"]') as HTMLButtonElement).click(); await Promise.resolve(); });
      expect(closeSpy).toHaveBeenCalledWith("review_session_t1", "");
      expect(rtSpy.mock.calls.length).toBeGreaterThanOrEqual(2); // 初載 + load() 重抓
    });

    it("sessionClose 失敗 → actionErr 顯示、dialog 不關", async () => {
      vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rtWith("active"));
      vi.spyOn(coordinatorClient, "sessionClose").mockRejectedValue(new Error("coordinator down"));
      const root = createRoot(container);
      await act(async () => { root.render(<SessionManagementPage />); });
      await act(async () => { await Promise.resolve(); });
      await act(async () => { (container.querySelector('[data-testid="session-terminate-review_session_t1"]') as HTMLButtonElement).click(); });
      await act(async () => { (container.querySelector('[data-testid="intent-confirm"]') as HTMLButtonElement).click(); await Promise.resolve(); });
      expect(container.querySelector('[data-testid="intent-action-error"]')?.textContent).toContain("結束 session 失敗");
      expect(container.querySelector('[data-testid="intent-dialog"]')).toBeTruthy(); // 不關
    });

    it("成功後該列轉灰（terminatingIds）", async () => {
      vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rtWith("active"));
      vi.spyOn(coordinatorClient, "sessionClose").mockResolvedValue({ session_id: "review_session_t1", status: "closed" });
      const root = createRoot(container);
      await act(async () => { root.render(<SessionManagementPage />); });
      await act(async () => { await Promise.resolve(); });
      await act(async () => { (container.querySelector('[data-testid="session-terminate-review_session_t1"]') as HTMLButtonElement).click(); });
      await act(async () => { (container.querySelector('[data-testid="intent-confirm"]') as HTMLButtonElement).click(); await Promise.resolve(); });
      expect(container.querySelector('[data-testid="session-row-review_session_t1"]')?.getAttribute("data-terminating")).toBe("true");
    });
  });
  ```

- [ ] **跑確認通過（GREEN）**：

  ```bash
  cd web-viewer-sample && npx vitest run src/console/SessionManagementPage.test.tsx
  ```

  預期五個測試全 `passed`。若「呼叫序」測試 flaky（async microtask 未 settle），在 confirm 後多加一輪 `await act(async () => { await Promise.resolve(); });`，不要改 sleep。

- [ ] **跑全前端 verify（回歸鎖）**：

  ```bash
  cd web-viewer-sample && npm run test
  ```

  預期既有測試（含 `ConversionSchedulingPage.test.tsx`/`console.test.tsx`/`coordinatorClient.test.ts`）全綠，無因 `SessionManagementPage` 改動退化。

- [ ] **commit**：

  ```bash
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/stupefied-euler-7d2845" add web-viewer-sample/src/console/SessionManagementPage.test.tsx && git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/stupefied-euler-7d2845" diff --cached --check && git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/stupefied-euler-7d2845" commit -m "test(web-viewer): SessionManagementPage 結束 session 行為測試（IX-SS-04）"
  ```

---

### Task 5: GitNexus impact / detect_changes（commit 前 scope 驗證）

**Files**
- 無 code 變更（純驗證）；本 worktree 路徑 = `C:\Repos\active\iot\AI-BIM-governance\.claude\worktrees\stupefied-euler-7d2845`，GitNexus 多 repo 索引須帶 `repo` 參數。

- [ ] **改 close 路由前的 impact（Task 1 開工前回溯補跑，已記錄供 reviewer）**：對 close handler 與 `eventLog.append` 消費端跑 impact，確認 additive 欄不破既有讀者。用 `mcp__gitnexus__impact`，`repo: "AI-BIM-governance"`（指本 worktree 路徑那個索引；多 repo 時用 list_repos 確認 key），`target: "eventLog"` 或 close handler，`direction: downstream`, `maxDepth: 1`。預期：append-only JSON payload additive 欄不破裂；risk LOW。若 impact 回 HIGH/CRITICAL，先回報再續。

- [ ] **commit 前 detect_changes（scope 驗證）**：

  用 `mcp__gitnexus__detect_changes`（ToolSearch 載入 `select:mcp__gitnexus__detect_changes`），`repo` 指本 worktree。預期 changed scope 僅 `bim-review-coordinator`（close 路由 + audit + sessions.test.ts）與 `web-viewer-sample`（coordinatorClient + pages.tsx + 兩支測試）。**注意 MEMORY「GitNexus detect-changes 看不到 linked worktree staged」**——若 detect_changes 在 worktree 撈不到 staged diff，改以 `git -C <worktree> diff --stat origin/main...HEAD` 列出實際 touched files 作為 scope 證據，並在 PR body 記「detect_changes worktree 限制，scope 以 git diff 兜底」。

  ```bash
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/stupefied-euler-7d2845" diff --stat origin/main...HEAD
  ```

  預期只列上述兩 sub-repo 的檔案，無越界（不碰 `bim-streaming-server` / kit-manager / deploy script）。

---

### Task 6: Browser E2E（Playwright，user-facing 唯一證據）

**Files**
- Create: `web-viewer-sample/e2e/sessions-terminate.spec.ts`
- Create（執行時產出，gitignored 抽樣）: `artifacts/e2e/sessions-terminate-*.png`
- Create（tracked evidence）: `docs/evidence/sessions-terminate/sessions-render-surface.png`

- [ ] **寫 e2e spec（照抄 `conv-prioritize-retry.spec.ts` 的守門 + notObserved + render-surface 雙 describe 結構）**：先讀 `web-viewer-sample/e2e/conv-prioritize-retry.spec.ts`（已在 plan 上方引述全文）確認 webServer/coordinator base/skip-gate/截圖路徑慣例，照抄檔頭限制揭露區塊（webServer :5180、`E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005"`、conditional skip 非 CI 硬 gate 的揭露）。

  ```ts
  import { test, expect } from "@playwright/test";

  // IX-SS-04 #sessions「結束 session」controlled action 端到端（重用 close 路由）：
  // 對 live 測試區實際存在的 active session 驗 browser 切片：列出現「結束 session」鈕 →
  //   點按開 IntentDialog → 確認 → 觀察一次真後端回應（POST .../close 2xx + runtime/status
  //   重抓該 session active→closed + 該列轉灰）。誠實鐵律：無樂觀更新、非 active 不給假按鈕、
  //   未觀察轉移以 notObserved 原文揭露、不偽造；深度因果由 sessions.test.ts route 測試兜底。
  //
  // 測試區常態無 active session → beforeAll 先 POST /api/review-sessions 種一個真 session
  //   （綁最小 artifact_bindings，沿用既有 fixture 風格）再驗結束切片。
  //
  // skip-gate 效力限制（比照 conv-prioritize-retry.spec.ts）：守門是 conditional skip（coordinator
  //   不可達 → skip → 計 pass，非 fail）。本 repo .github/workflows 無 Playwright job，故不 false-green
  //   任何既有 CI gate；純本機 / 指揮官手動 P4 gate。
  const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";

  test.describe("IX-SS-04 #sessions 結束 session controlled action", () => {
    test.setTimeout(120_000);
    let seededId: string | null = null;
    let coordinatorUp = false;
    const notObserved: string[] = [];

    test.beforeEach(async ({ request }) => {
      try {
        const created = await request.post(`${COORDINATOR}/api/review-sessions`, {
          data: { project_id: "271", model_version_id: "mv_e2e_terminate", artifact_bindings: [] },
        });
        if (created.ok()) { seededId = (await created.json()).session_id; coordinatorUp = true; }
      } catch { coordinatorUp = false; }
      if (!coordinatorUp || !seededId) {
        notObserved.push("coordinator :8005 不可達或種 session 失敗；按鈕 → IntentDialog → 真 POST .../close → 列轉灰 這條 browser 切片本輪 not observed，深度因果由 sessions.test.ts 兜底。");
      }
      test.skip(!coordinatorUp || !seededId, "需 branch coordinator :8005 可達且能 POST /api/review-sessions 種 session；見檔頭前置。深度因果由 sessions.test.ts 兜底。");
    });

    test("結束鈕 → IntentDialog → 真 POST .../close → runtime/status active→closed + 列轉灰", async ({ page }) => {
      const id = seededId!;
      await page.goto(`/#sessions`);
      await page.getByRole("button", { name: /重新整理|讀取中/ }).first().click();
      const btn = page.locator(`[data-testid="session-terminate-${id}"]`);
      await btn.waitFor({ state: "visible", timeout: 30_000 });
      await btn.click();
      await expect(page.locator('[data-testid="intent-dialog"]')).toBeVisible({ timeout: 30_000 });
      const [postResponse] = await Promise.all([
        page.waitForResponse((r) => r.url().includes(`/api/review-sessions/${id}/close`) && r.request().method() === "POST", { timeout: 30_000 }),
        page.locator('[data-testid="intent-confirm"]').click(),
      ]);
      expect(postResponse.status(), "POST .../close 應回 2xx").toBeGreaterThanOrEqual(200);
      expect(postResponse.status()).toBeLessThan(300);
      // 證據型更新：dialog 關閉 + runtime/status 真值該 session active→closed。
      await expect(page.locator('[data-testid="intent-dialog"]')).toBeHidden({ timeout: 30_000 });
      const after = await page.request.get(`${COORDINATOR}/api/runtime/status`);
      const afterBody = await after.json();
      const refreshed = (afterBody.sessions?.items ?? []).find((s: { session_id: string }) => s.session_id === id);
      // 後端釋放後該 session 可能 status=closed 仍在列、或已移出 items（兩者皆真，誠實揭露）。
      if (refreshed) {
        expect(["closing", "closed"]).toContain(refreshed.status);
      } else {
        notObserved.push(`runtime/status 已不再 emit ${id}（後端釋放後移出 items）；以 POST 2xx 為終結證據。`);
      }
      await page.screenshot({ path: `../artifacts/e2e/sessions-terminate-slice.png`, fullPage: true });
    });

    test.afterAll(() => {
      if (notObserved.length) console.log("[sessions-terminate] notObserved:", JSON.stringify(notObserved));
    });
  });

  // render-surface 證據（不受上方守門）：無條件渲染 #sessions 真頁面 + 截圖落 tracked evidence。
  // 誠實鐵律：此截圖只證明 #sessions 真頁面渲染 + 截圖機制可落點，不等於觀察到 controlled action；
  // 該深度切片由上方 slice test（前置齊全才跑）與 sessions.test.ts route 測試兜底。
  test.describe("sessions-terminate render-surface 證據（非 controlled-action 觀察）", () => {
    test.setTimeout(60_000);
    test("渲染 #sessions 真頁面 → 截圖 render surface（evidence）", async ({ page }) => {
      await page.goto(`/#sessions`);
      await expect(page.getByText("Session 管理", { exact: false })).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: "../docs/evidence/sessions-terminate/sessions-render-surface.png", fullPage: true });
      await page.screenshot({ path: "../artifacts/e2e/sessions-terminate-render-surface.png", fullPage: true });
    });
  });
  ```

- [ ] **建 tracked evidence 目錄**：

  ```bash
  mkdir -p "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/stupefied-euler-7d2845/docs/evidence/sessions-terminate"
  ```

- [ ] **跑 e2e（須先起 branch coordinator :8005 + webServer :5180，沿用 conv-prioritize-retry 檔頭前置）**：

  ```bash
  cd web-viewer-sample && npm run test:e2e -- sessions-terminate.spec.ts
  ```

  預期：coordinator :8005 起且可種 session → slice test 跑出 POST 2xx + dialog 關 + runtime/status `closed`，截圖落點；render-surface test 必跑出 `#sessions` 頁截圖。coordinator 未起 → slice honest skip（計 pass）、render-surface 仍渲染（webServer 自帶）。**未觀察轉移以 `notObserved[]` console 揭露，不偽造。**

- [ ] **commit（含 tracked render-surface 截圖；slice 截圖落 artifacts/ 為 gitignored 抽樣不 commit）**：

  ```bash
  git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/stupefied-euler-7d2845" add web-viewer-sample/e2e/sessions-terminate.spec.ts docs/evidence/sessions-terminate/ && git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/stupefied-euler-7d2845" diff --cached --check && git -C "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/stupefied-euler-7d2845" commit -m "test(e2e): #sessions 結束 session browser 切片 + render-surface 證據（IX-SS-04）"
  ```

---

## 完成定義（DoD，spec §6.5）

- [ ] coordinator `npm run verify`（build + test）全綠（含 Task 1 兩支新測試 + 既有 close/release/idempotent/safe-id/404/event-order 回歸鎖）。
- [ ] 前端 `npm run test`（vitest）全綠（含 Task 4 五支新測試 + 既有頁面測試回歸鎖）。
- [ ] e2e（含誠實 skip-gate 與 `notObserved[]` 揭露）：slice 觀察到 POST 2xx + runtime/status `active→closed` 或誠實揭露 not observed；render-surface 截圖落 tracked evidence。
- [ ] PR body 揭露：URL 偏離（重用 close 非開 `/terminate`）、誠實邊界（不殺 GPU Kit 行程）、`session_id` 前綴限制（`lwv_` 會 400、本卡不擴 safe-id）、GitNexus scope。
- [ ] 四項回報：改了哪些 tracked files / 最小驗證 / 哪些測試沒跑及原因 / 已知風險。

## 已知風險（spec §7，執行時據此回報）

- 重用 close 路由的 audit additive = 低風險（純 append-only 事件 payload 加欄）；回歸鎖兜底。
- `session_id` 前綴：safe-id 只認 `^review_session_`，`lwv_` 會 400；本卡不擴 safe-id，前端對 400 誠實顯錯（已知限制揭露）。
- 灰列 60s timer：`timersRef` + `useEffect` cleanup 清除，避免 unmount leak / setState-after-unmount。
- 誠實邊界：terminate 僅釋放 coordinator binding；不宣稱 kill GPU Kit 行程。
- worktree base 落後 origin/main 時 PR diff 可能 re-add 已除籍 .env（MEMORY `spec-to-done-rebase-stale-branch-before-pr`）；P6 開 PR 前 `git fetch` 比 merge-base，stale 就 rebase origin/main。
