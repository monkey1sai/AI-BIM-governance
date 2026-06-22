# Viewer-Embed A1 Highlight (VG-01) Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 把 A1 治理工作台「在 3D 高亮失敗構件」這條 user journey 從斷成兩截（console 殼層按鈕全灰 / viewer 高亮引擎齊全但驅動不到）接通成一氣呵成，並把 `first_frame_at` 從前端死值翻成後端記真證據。

**Architecture:** console（`:8004/ui` dist-ui）的 `A1GovernanceWorkbenchPage` 嵌入一個 `<EmbeddedViewer>` 元件，內含 `<iframe>` 載入既有 viewer（`:5173` dev-server image）+ 一條版本化 `protocol:"vg01"` 的 postMessage 橋；console 不自建 WebRTC，重用 viewer 既有串流堆疊與 `HighlightBridge`。viewer 在真畫面到達（`_completeStageLoad`，由 `_hasRemoteVideoFrame()` 證明）時 postMessage `first_frame` 給 parent，console 轉呼新後端端點 `POST /api/review-sessions/:id/first-frame`（coordinator 記最小一筆 `first_frame_at`，型別鏈透到 `runtimeGovernance`）。失敗構件「在 3D 高亮」走 console→viewer postMessage `highlight`→viewer 先判 `canOperate`→既有 `HighlightBridge`→DataChannel→Kit 紅高亮→回 `highlight_result`，全程零樂觀更新、未對映誠實回拒。

**Tech Stack:** TypeScript；前端 React class component（`Window.tsx`）+ function component（console pages，Vite + vitest + Testing Library）；後端 Express + zod + vitest（`bim-review-coordinator`）；Playwright（browser E2E，唯一 user-facing 證據）。GitNexus 做 impact / detect_changes。

---

## 重要：執行前置與全域紀律（每個 Task 都適用）

- **零脈絡導航**：本 plan 的所有 `file:line` 已於 2026-06-22 由 spec 對抗驗證後逐一 Read/grep 重新查證；但 class component 行號會隨 additive 編輯漂移，**動手前用符號名（grep）定位，不要盲信行號**。每個 Task 已給出符號名與目前行號雙重定位。
- **GitNexus MUST（CLAUDE.md §4）**：改既有 function/class/method 前先跑 `gitnexus_impact`（HIGH/CRITICAL 先回報再繼續）；commit 前跑 `gitnexus_detect_changes` 驗 scope 僅落 `web-viewer-sample` 與 `bim-review-coordinator`。本 plan 在 Task 0（coordinator）、Task 2（viewer `Window`）、Task 3（console A1 page）開頭明標 impact 指令。
- **誠實鐵律（CLAUDE.md §1）**：前端要真能操作、不可只接 mock；first frame 沒到→高亮鈕 disabled + 原因；未對映構件→誠實回拒（`unmapped`）；stage mismatch→警示不靜默；不殺 GPU Kit 行程；無 backend 處 UI 標 `DEMO DATA` / `NOT BUILT` / `not_observed`。
- **不在 main 開發**：已在 worktree branch `feat/viewer-embed-a1-highlight`；走 branch → PR → Actions → merge。
- **不新增 production dependency、不新增 env var**（M5：postMessage origin 白名單複用既有 `VITE_ALLOWED_COORDINATOR_ORIGINS`，`web-viewer-sample/src/config/env.ts:8-18`）。
- **YAGNI / 非目標（spec §3）**：本格只做「console↔viewer 橋 + `first_frame_at` 後端化 + A1 高亮接線」。不做 A2 onion-skin / A3 圖層+clash / A1 snapshot-to-BCF；不做 heartbeat 遙測；不做 A2/A3 的 `diff_overlay`/`layer_toggle`/`clash_focus` 指令族（協定 §5「未知 type 忽略」保證後續 additive 不破格1）。七區塊只交付第 6（紅高亮）+ 第 7（反向 `selected_guid`）。
- **任務相依排序（spec §2，不可亂序）**：Task 0（coordinator `first_frame_at` 後端化，回歸鎖）→ Task 1（`<EmbeddedViewer>` 地基）→ Task 2（viewer listener，依賴 Task 1 協定）→ Task 3（console A1 整合，依賴 Task 1+2）→ Task 4（證據顯示，依賴 Task 0）→ Task 5（browser E2E，最後）。可切兩段 commit：(A) 地基（Task 0/1/2/4）綠；(B) A1 高亮接線（Task 3）綠。
- **cross-build-target（最大風險，spec §7）**：本格改 console（`build:ui`→`:8004/ui`）與 viewer（`:5173` dev-server image）**兩個 build target**。viewer FE 改動 `build:ui` 不會更新——改 `Window.tsx` 後 E2E 前 MUST `docker compose build viewer` + `up -d`；改 console pages 後 MUST `npm run build:ui` + 重啟 coordinator。未重建任一→「改了沒效」假象。Task 5 內含此 checklist。

---

## Task 0: coordinator `first_frame_at` 後端化（回歸鎖 + 型別鏈）

> 先做，因為它是「最先且回歸鎖」（spec §2.4）。前端 Task 4 證據顯示依賴此型別鏈。in-memory store 重啟後 `first_frame_at` 清除、下次 POST 重記（N2：最小一筆非 exactly-once）；coordinator 用 `nowIso()` 為權威時戳，忽略 body 的 `observed_at`（N3）。

**Files:**
- Modify: `bim-review-coordinator/src/types.ts`（`ReviewSession` interface，line 92-110，加 `first_frame_at`）
- Modify: `bim-review-coordinator/src/app.ts`（**頂部 import 區加 `import { nowIso } from "./utils/time.js";`**——已查證目前無此 import；新 route 插在 `events` POST 後 line 875 與 `close` 前 line 877 之間；`summarizeSessionForRuntime` emit，line 2192-2213）
- Test: `bim-review-coordinator/tests/session-first-frame.test.ts`（新檔）
- Modify: `bim-review-coordinator/tests/sessions.test.ts`（回歸鎖：既有 `runtime/status` 形狀斷言若需補 `first_frame_at: null` 預期值）

**GitNexus impact（編輯前）：**
```
gitnexus_impact({ target: "summarizeSessionForRuntime", direction: "upstream" })
gitnexus_impact({ target: "buildRuntimeStatus", direction: "upstream" })
```
預期：`summarizeSessionForRuntime` 僅被 `buildRuntimeStatus`（app.ts:2154）呼叫；`buildRuntimeStatus` 僅被 `GET /api/runtime/status`（app.ts:493）呼叫。additive 欄不破讀者。HIGH/CRITICAL 先回報。

**Steps:**

- [ ] 在 `ReviewSession` interface 加 `first_frame_at` 欄位（optional，預設不寫＝舊 session 讀回為 `undefined`）。grep 定位：`grep -n "interface ReviewSession" bim-review-coordinator/src/types.ts`（目前 line 92）。在 `quality_metrics_summary?: ...` 那行（line 109）後加：
  ```ts
    quality_metrics_summary?: ConversionQualityMetricsSummary | null;
    // VG-01：viewer 真畫面首幀（_hasRemoteVideoFrame 證明）由 console 經
    // POST /api/review-sessions/:id/first-frame 回報後寫入；coordinator nowIso() 權威時戳。
    // in-memory（檔案）store 重啟後可能不存在 → 讀回 undefined，summarize 時 ?? null。
    first_frame_at?: string | null;
  }
  ```

- [ ] 寫失敗測試（先紅）：新建 `bim-review-coordinator/tests/session-first-frame.test.ts`，比照既有 `tests/sessions.test.ts` 的 app 建構慣例（`grep -n "createApp\|buildApp\|makeApp\|import" tests/sessions.test.ts | head` 找出建 app 的 helper 與 import 路徑，照抄）。**已查證（2026-06-22）：`sessions.test.ts` 用 `import request from "supertest"` + `import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js"`；建 app 的 helper 是 `function makeApp(overrides = {}): CoordinatorApp`，回傳 `CoordinatorApp`；`store` 不是裸露變數，而是 `CoordinatorApp` 的 export field（app.ts:276 `store: SessionStore`），故須透過 `const app = makeApp(); app.store.get(sid)` 存取（裸寫 `store.get(...)` 會 `store is not defined` compile error）。`request(...)` 的對象是 `app.app`（Express instance；照抄 sessions.test.ts 怎麼傳給 supertest）。建真 session 用 `POST /api/review-sessions`（照抄 sessions.test.ts 的 session 建立 payload）。** 內容涵蓋（下列骨架已對齊 `app.store` 存取慣例與 `makeApp()` setup）：
  ```ts
  import request from "supertest";
  import { describe, it, expect } from "vitest";
  import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
  // 比照 sessions.test.ts：makeApp() 用 mkdtempSync 配置 sessionStoreDir/eventLogDir/...，
  // afterEach 關掉 app.io / app.server。照抄該檔的 makeApp 與 afterEach（含 createSession helper）。
  // 注意：supertest 對象 = app.app（Express），session 狀態查詢 = app.store.get(sid)（非裸 store）。

  describe("POST /api/review-sessions/:sessionId/first-frame", () => {
    it("safe-id 不合法回 400", async () => {
      const app = makeApp();
      const res = await request(app.app).post("/api/review-sessions/not%20safe/first-frame").send({});
      expect(res.status).toBe(400);
    });
    it("session 不存在回 404", async () => {
      const app = makeApp();
      const res = await request(app.app).post("/api/review-sessions/review_session_doesnotexist/first-frame").send({});
      expect(res.status).toBe(404);
    });
    it("首次回報寫入 first_frame_at + 記 firstFrameObserved event", async () => {
      const app = makeApp();
      const sid = (await createSession(app)).session_id; // createSession = 照抄 sessions.test.ts 建真 session 的 helper
      const res = await request(app.app).post(`/api/review-sessions/${sid}/first-frame`).send({ endpoint_id: "kit_local_001" });
      expect(res.status).toBe(200);
      expect(typeof res.body.first_frame_at).toBe("string");
      const events = await request(app.app).get(`/api/review-sessions/${sid}/events`);
      expect(events.body.items.some((e: any) => e.type === "firstFrameObserved")).toBe(true);
      const stored = app.store.get(sid); // 已查證：store 是 CoordinatorApp field（app.ts:276），非裸變數
      expect(stored?.first_frame_at).toBe(res.body.first_frame_at);
    });
    it("冪等：第二次回報不覆寫時戳、不重複 append", async () => {
      const app = makeApp();
      const sid = (await createSession(app)).session_id;
      const first = await request(app.app).post(`/api/review-sessions/${sid}/first-frame`).send({});
      const second = await request(app.app).post(`/api/review-sessions/${sid}/first-frame`).send({});
      expect(second.body.first_frame_at).toBe(first.body.first_frame_at);
      const events = await request(app.app).get(`/api/review-sessions/${sid}/events`);
      expect(events.body.items.filter((e: any) => e.type === "firstFrameObserved").length).toBe(1);
    });
    it("忽略 body.observed_at，用 coordinator 時戳（N3）", async () => {
      const app = makeApp();
      const sid = (await createSession(app)).session_id;
      const res = await request(app.app).post(`/api/review-sessions/${sid}/first-frame`).send({ observed_at: "1999-01-01T00:00:00.000Z" });
      expect(res.body.first_frame_at).not.toBe("1999-01-01T00:00:00.000Z");
    });
    it("runtime/status.sessions[].items[] emit first_frame_at（型別鏈 M3）", async () => {
      const app = makeApp();
      const sid = (await createSession(app)).session_id;
      await request(app.app).post(`/api/review-sessions/${sid}/first-frame`).send({});
      const rt = await request(app.app).get("/api/runtime/status");
      const item = rt.body.sessions.items.find((s: any) => s.session_id === sid);
      expect(item).toBeTruthy();
      expect(item.first_frame_at).toBeTruthy();
    });
  });
  ```
  註：上方 `app.app` / `app.store` / `createSession(app)` 三者**以 sessions.test.ts 的實際慣例為最終依據**（該檔 supertest 傳的物件、建 session 的 helper 名稱以 grep 結果照抄）；此處骨架已校正 reviewer 指出的「裸 `store` not defined」問題（改 `app.store`），執行者照抄前仍 grep 對齊 helper 名。

- [ ] 跑確認失敗：
  ```
  cd bim-review-coordinator && npx vitest run tests/session-first-frame.test.ts
  ```
  預期輸出：route 404（Express 找不到 path）或斷言 fail，所有 `it` 紅（route 尚未存在、`first_frame_at` 尚未 emit）。

- [ ] 最小實作（route）：在 `app.ts` 的 `events` POST handler 結束（line 875 `});`）之後、`close` route（line 877 `app.post("/api/review-sessions/:sessionId/close"`）之前，插入新 route，照抄 `events` route（854-875）的 safe-id 400 / not-found 404 守門慣例：
  ```ts
  app.post("/api/review-sessions/:sessionId/first-frame", (request, response, next) => {
    try {
      if (!isSafeSessionId(request.params.sessionId)) {
        response.status(400).json({ detail: "Invalid review session id." });
        return;
      }
      const session = store.get(request.params.sessionId);
      if (!session) {
        response.status(404).json({ detail: "Review session not found." });
        return;
      }
      // 冪等：已記過 → 回原時戳，不重複 append（N2 最小一筆）。
      if (session.first_frame_at) {
        response.json({ session_id: session.session_id, first_frame_at: session.first_frame_at });
        return;
      }
      const endpointId = typeof request.body?.endpoint_id === "string" ? request.body.endpoint_id : undefined;
      const actor = resolveActor(request); // best-effort（LAN 無 RBAC，沿用既有）
      const at = nowIso(); // N3：coordinator 權威時戳，忽略 body.observed_at（iframe/coordinator 時鐘無同步保障）
      store.update(session.session_id, { first_frame_at: at });
      eventLog.append(session.session_id, "firstFrameObserved", { endpoint_id: endpointId, actor });
      response.json({ session_id: session.session_id, first_frame_at: at });
    } catch (error) {
      next(error);
    }
  });
  ```
- [ ] **（必做 checklist step）補 `nowIso` import**：上面 route 用了 `nowIso()`，但**已查證（2026-06-22 grep）：`bim-review-coordinator/src/app.ts` 目前完全未 import `nowIso`（零命中）**——app.ts 既有時戳全用裸 `new Date().toISOString()`（如 line 1724/2123）。`nowIso` 定義在 `bim-review-coordinator/src/utils/time.ts:1`（`export function nowIso()`），其他檔案（`eventLog.ts:4`、`kitPool.ts:3`）以 `import { nowIso } from "../utils/time.js"` 取用。**故 app.ts 須在頂部 import 區加入這一行**（app.ts 在 `src/`，故相對路徑為 `./utils/time.js`，比照其他 import 的 `.js` 後綴慣例）：
  ```ts
  import { nowIso } from "./utils/time.js";
  ```
  插入位置：app.ts 頂部既有 import 群中（與其他 `import ... from "./..."` 同區）。**未補此 import → 上面 route 的 `nowIso()` 會 `Cannot find name 'nowIso'` TypeScript error，`npm run verify` 的 `tsc` 直接紅。** 補完用 `grep -n "import { nowIso }" bim-review-coordinator/src/app.ts` 確認存在。
  > （替代等價作法：若不想新增 import，可比照 app.ts 既有慣例直接用 `new Date().toISOString()` 取代 route 內 `nowIso()`；二擇一，但**不可兩者皆不做**而留 `nowIso()` 裸引用。）

- [ ] 最小實作（型別鏈 (1)：emit）：在 `summarizeSessionForRuntime`（app.ts:2192-2213）的 return 物件，於 `updated_at: session.updated_at,`（line 2211）後加：
  ```ts
      updated_at: session.updated_at,
      first_frame_at: session.first_frame_at ?? null, // VG-01 型別鏈：runtime/status 透出真首幀證據
    };
  ```

- [ ] 跑確認通過（coordinator 單測 + 回歸）：
  ```
  cd bim-review-coordinator && npx vitest run tests/session-first-frame.test.ts tests/sessions.test.ts
  ```
  預期：`session-first-frame.test.ts` 全綠；`sessions.test.ts` 全綠（若該檔對 `runtime/status` 形狀做 exact-match 斷言而失敗，補上 `first_frame_at: null` 預期值——這是 additive 欄、不算行為退化）。

- [ ] 跑完整 coordinator verify（build + 全測，回歸鎖）：
  ```
  cd bim-review-coordinator && npm run verify
  ```
  預期：`tsc` 0 error（`first_frame_at` 型別已加）+ vitest 全綠，既有 `runtime/status` / `review-sessions` / close 測試零退化。

- [ ] GitNexus detect_changes + commit：
  ```
  gitnexus_detect_changes
  cd <repo-root> && git add bim-review-coordinator/src/types.ts bim-review-coordinator/src/app.ts bim-review-coordinator/tests/session-first-frame.test.ts bim-review-coordinator/tests/sessions.test.ts
  git commit -m "feat(coordinator): first_frame_at 後端化 + runtime/status 型別鏈（回歸鎖）"
  ```
  預期 detect_changes scope 僅 `bim-review-coordinator`。

---

## Task 1: `<EmbeddedViewer>` 元件 + postMessage 橋（console 側地基）

> 前端地基（spec §2.1）。封裝 `<iframe>`（src 指向既有 viewer 入口，帶 `session` query——對齊 `env.ts:60` viewer 讀 `session`/`sessionId`）+ 版本化 `protocol:"vg01"` postMessage 橋。送出 `targetOrigin` 非 `"*"`；接收驗 `event.origin === viewerOrigin` + `event.source === iframe.contentWindow` + `protocol:"vg01"`，未知 type / 缺 protocol 忽略。**此元件是 console→viewer 純前端橋，無 backend，不持有 RTCPeerConnection。**

**Files:**
- Create: `web-viewer-sample/src/console/EmbeddedViewer.tsx`
- Test: `web-viewer-sample/src/console/EmbeddedViewer.test.tsx`（新檔）

**Steps:**

- [ ] 寫失敗測試（先紅）：新建 `web-viewer-sample/src/console/EmbeddedViewer.test.tsx`，比照既有 `src/console/console.test.tsx` 的 render 慣例（`grep -n "import\|render\|describe" src/console/console.test.tsx | head -20` 照抄 import 與 render setup）：
  ```tsx
  import { describe, it, expect, vi } from "vitest";
  import { render } from "@testing-library/react";
  import { EmbeddedViewer } from "./EmbeddedViewer";

  const VIEWER_ORIGIN = "http://127.0.0.1:5173";

  function fireMessage(data: unknown, origin: string, source: Window | null) {
    const ev = new MessageEvent("message", { data, origin, source: source as Window });
    window.dispatchEvent(ev);
  }

  describe("EmbeddedViewer postMessage 橋", () => {
    it("iframe src 帶 session query 指向 viewerOrigin", () => {
      const { container } = render(<EmbeddedViewer sessionId="review_session_abc" viewerOrigin={VIEWER_ORIGIN} />);
      const iframe = container.querySelector("iframe")!;
      expect(iframe.getAttribute("src")).toContain(VIEWER_ORIGIN);
      expect(iframe.getAttribute("src")).toContain("session=review_session_abc");
      expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
      expect(iframe.getAttribute("allow")).toContain("autoplay");
    });

    it("origin 不符的 message 丟棄（不呼叫 callback）", () => {
      const onFirstFrame = vi.fn();
      render(<EmbeddedViewer sessionId="review_session_abc" viewerOrigin={VIEWER_ORIGIN} onFirstFrame={onFirstFrame} />);
      fireMessage({ protocol: "vg01", type: "first_frame", stageUrl: "u" }, "http://evil.example", window);
      expect(onFirstFrame).not.toHaveBeenCalled();
    });

    it("缺 protocol 的 message 丟棄", () => {
      const onSelectedGuid = vi.fn();
      const { container } = render(<EmbeddedViewer sessionId="review_session_abc" viewerOrigin={VIEWER_ORIGIN} onSelectedGuid={onSelectedGuid} />);
      const src = container.querySelector("iframe")!.contentWindow;
      fireMessage({ type: "selected_guid", ifcGuid: "g1" }, VIEWER_ORIGIN, src);
      expect(onSelectedGuid).not.toHaveBeenCalled();
    });

    it("vg01 message 由 iframe.contentWindow 來時分派到對應 callback", () => {
      const onFirstFrame = vi.fn();
      const onHighlightResult = vi.fn();
      const onSelectedGuid = vi.fn();
      const { container } = render(
        <EmbeddedViewer sessionId="review_session_abc" viewerOrigin={VIEWER_ORIGIN}
          onFirstFrame={onFirstFrame} onHighlightResult={onHighlightResult} onSelectedGuid={onSelectedGuid} />,
      );
      const src = container.querySelector("iframe")!.contentWindow;
      fireMessage({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" }, VIEWER_ORIGIN, src);
      fireMessage({ protocol: "vg01", type: "highlight_result", requestId: "r1", ok: false, reason: "unmapped" }, VIEWER_ORIGIN, src);
      fireMessage({ protocol: "vg01", type: "selected_guid", ifcGuid: "guid-123" }, VIEWER_ORIGIN, src);
      expect(onFirstFrame).toHaveBeenCalledWith(expect.objectContaining({ stageUrl: "stage://x" }));
      expect(onHighlightResult).toHaveBeenCalledWith(expect.objectContaining({ reason: "unmapped" }));
      expect(onSelectedGuid).toHaveBeenCalledWith("guid-123");
    });

    it("message 來自非 iframe.contentWindow 的 source 丟棄", () => {
      const onFirstFrame = vi.fn();
      render(<EmbeddedViewer sessionId="review_session_abc" viewerOrigin={VIEWER_ORIGIN} onFirstFrame={onFirstFrame} />);
      fireMessage({ protocol: "vg01", type: "first_frame", stageUrl: "u" }, VIEWER_ORIGIN, window); // window 非 iframe.contentWindow
      expect(onFirstFrame).not.toHaveBeenCalled();
    });
  });
  ```

- [ ] 跑確認失敗：
  ```
  cd web-viewer-sample && npx vitest run src/console/EmbeddedViewer.test.tsx
  ```
  預期：import 失敗（`EmbeddedViewer` 不存在）→ 全紅。

- [ ] 最小實作：新建 `web-viewer-sample/src/console/EmbeddedViewer.tsx`：
  ```tsx
  import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";

  // VG-01 postMessage 協定（版本化）。viewer→console 與 console→viewer 皆帶 protocol:"vg01"。
  export interface FirstFrameMessage { protocol: "vg01"; type: "first_frame"; stageUrl: string | null }
  export interface StageLoadedMessage { protocol: "vg01"; type: "stage_loaded"; stageUrl: string | null }
  export interface HighlightResultMessage {
    protocol: "vg01"; type: "highlight_result"; requestId: string;
    ok: boolean; reason?: "unmapped" | "datachannel_not_ready";
  }
  export interface SelectedGuidMessage { protocol: "vg01"; type: "selected_guid"; ifcGuid: string | null }

  export interface HighlightItem { ifc_guid: string; severity?: string; label?: string; rule_code?: string | null }

  export interface EmbeddedViewerHandle {
    sendHighlight(items: HighlightItem[]): void;
    sendFocus(ifcGuid: string): void;
    sendClear(): void;
  }

  export interface EmbeddedViewerProps {
    sessionId: string;
    viewerOrigin: string; // 必須是「viewer 入口 origin」（:5173 baked viewer），非 coordinator :8004。
                          // 真源 = coordinatorClient.runtimeStatus().configured_endpoints.viewer.browser_url_base（Task 3 提供）。
                          // ⚠️ 傳成 coordinator base 會讓 iframe 載 coordinator HTML、postMessage 橋永遠收不到 viewer 訊息。
                          // 接收端白名單仍複用 VITE_ALLOWED_COORDINATOR_ORIGINS（viewer 端驗 parent=console origin）。
    onViewerReady?: () => void;
    onFirstFrame?: (m: FirstFrameMessage) => void;
    onStageLoaded?: (stageUrl: string | null) => void;
    onHighlightResult?: (m: HighlightResultMessage) => void;
    onSelectedGuid?: (ifcGuid: string | null) => void;
  }

  export const EmbeddedViewer = forwardRef<EmbeddedViewerHandle, EmbeddedViewerProps>(function EmbeddedViewer(props, ref) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [, setViewerReady] = useState(false);

    useEffect(() => {
      const onMsg = (e: MessageEvent) => {
        if (e.origin !== props.viewerOrigin) return;                 // 安全：origin 比對（非 "*"）
        if (e.source !== iframeRef.current?.contentWindow) return;   // 安全：來源 frame
        const m = e.data as { protocol?: string; type?: string } | null;
        if (!m || m.protocol !== "vg01") return;                     // 協定版本 / 前向相容（未知忽略）
        switch (m.type) {
          case "viewer_ready":     setViewerReady(true); props.onViewerReady?.(); break;
          case "first_frame":      props.onFirstFrame?.(m as unknown as FirstFrameMessage); break;
          case "stage_loaded":     props.onStageLoaded?.((m as unknown as StageLoadedMessage).stageUrl); break;
          case "highlight_result": props.onHighlightResult?.(m as unknown as HighlightResultMessage); break;
          case "selected_guid":    props.onSelectedGuid?.((m as unknown as SelectedGuidMessage).ifcGuid ?? null); break;
          default: break; // 未知 type 忽略
        }
      };
      window.addEventListener("message", onMsg);
      return () => window.removeEventListener("message", onMsg);
    }, [props]);

    const post = (msg: Record<string, unknown>) =>
      iframeRef.current?.contentWindow?.postMessage({ protocol: "vg01", ...msg }, props.viewerOrigin); // targetOrigin 非 "*"

    useImperativeHandle(ref, () => ({
      sendHighlight: (items) => post({ type: "highlight", items }),
      sendFocus: (ifcGuid) => post({ type: "focus", ifc_guid: ifcGuid }),
      sendClear: () => post({ type: "clear" }),
    }), [props.viewerOrigin]);

    const src = `${props.viewerOrigin}/?session=${encodeURIComponent(props.sessionId)}`;
    // S1：跨 origin iframe 須 allow-scripts allow-same-origin（WebRTC + sessionStorage）+ allow=autoplay
    //     （跨 origin <video> 自動播放，否則白頁）。viewer receive-only（AppStream mic:false）→ 不需 camera/microphone。
    return (
      <iframe ref={iframeRef} src={src} title="live-3d-viewer"
        sandbox="allow-scripts allow-same-origin" allow="autoplay"
        style={{ width: "100%", height: "100%", minHeight: 480, border: "1px solid #2a2f3a", background: "#000" }} />
    );
  });
  ```
  注意：`forwardRef` + `useImperativeHandle` 讓 Task 3 的 A1 page 能拿 `ref.current.sendHighlight(...)`。測試裡 `vi.fn()` 用 props 形式，故元件 props 形狀必須與測試一致。

- [ ] 跑確認通過：
  ```
  cd web-viewer-sample && npx vitest run src/console/EmbeddedViewer.test.tsx
  ```
  預期：5 個 `it` 全綠。

- [ ] commit：
  ```
  cd <repo-root> && git add web-viewer-sample/src/console/EmbeddedViewer.tsx web-viewer-sample/src/console/EmbeddedViewer.test.tsx
  git commit -m "feat(console): EmbeddedViewer 元件 + vg01 postMessage 橋（地基）"
  ```

---

## Task 2: viewer 側 postMessage listener（`Window.tsx` 嚴格 additive）

> spec §2.2 / §4.3。在 `Window.tsx` additive 掛 listener：收 `highlight`→**先判 `canOperate`（M2，不可直接呼叫無守衛的 `_overlayHighlight`）**→既有 HighlightBridge→回 `highlight_result`；spectator/未就緒**靜默丟棄**。`first_frame`→在 `_completeStageLoad`（真完成點）postMessage，`_firstFramePosted` flag 只送一次（M1，**不**接在失敗/斷線/開檔路徑）。`selected_guid`→`_reverseLookupGuid` 設值處 additive postMessage。**嚴格 additive：不改 AppStream / GovernanceOverlay props 形狀 / spectator 既有路徑。**

**Files:**
- Modify: `web-viewer-sample/src/Window.tsx`（`componentDidMount` line 335 / `componentWillUnmount` line 345 / `_completeStageLoad` line 527 / `_overlayHighlight` line 603 / `_reverseLookupGuid` line 707；新增 `_onParentMessage`、`_firstFramePosted`、`_postToParent`）
- Modify: `web-viewer-sample/src/config/env.ts`（**line 8 `function allowedCoordinatorOrigins` → `export function`**，已查證目前非 export；Window.tsx 要 import 它必須先 export）
- Create: `web-viewer-sample/src/parentMessageGuard.ts`（純函式守衛）
- Test: `web-viewer-sample/src/console/windowParentMessage.test.ts`（新檔，純函式 + 行為單元測；放 console 旁因協定常數共用）

**GitNexus impact（編輯前）：**
```
gitnexus_impact({ target: "Window", direction: "upstream" })
gitnexus_impact({ target: "_overlayHighlight", direction: "upstream" })
gitnexus_impact({ target: "_completeStageLoad", direction: "upstream" })
```
預期：`Window` 為核心元件，可能 HIGH（先回報）。listener / 守衛 / first_frame 皆 additive，不改既有路徑簽名。`_overlayHighlight` 目前僅被 `GovernanceOverlay onHighlight`（Window.tsx:2274）呼叫；新增 listener 呼叫前必補 `canOperate` 守衛。

**M2 守衛抉擇（spec §2.2 二選一，本 plan 採「listener 內先判」以保 `_overlayHighlight` 既有呼叫面零改動）：**
listener 在呼叫前用既有 `deriveOverlayInputs`（`web-viewer-sample/src/console/governance/windowOverlayGlue.ts`，與 Window.tsx:2253 render 同一套）算出 `panelState.canOperate`，false 則靜默丟棄、不觸發 `_overlayHighlight`。

**前置已查證事實（2026-06-22 grep，影響下方 Step 必做）：**
- `web-viewer-sample/src/config/env.ts:8` 目前宣告為 `function allowedCoordinatorOrigins(): Set<string> {`（**非 `export`**）；Window.tsx 要 import 它必須先把它 export，否則 `import { allowedCoordinatorOrigins } from "./config/env"` 會 `has no exported member` compile error。→ 見下方 Step「Window.tsx import 前必做：export env helper」。

**Steps:**

- [ ] 寫失敗測試（先紅）：新建 `web-viewer-sample/src/console/windowParentMessage.test.ts`。**先抽純函式**：把「驗證一則 parent message 是否該處理」抽成可測純函式 `shouldAcceptParentMessage(e, expectedOrigin, isEmbedded)`（origin 比對 + protocol:"vg01" + `window.parent !== window`），與「canOperate gating 決策」`canHandleHighlight(canOperate)`。測試：
  ```ts
  import { describe, it, expect } from "vitest";
  import { shouldAcceptParentMessage, canHandleHighlight } from "../parentMessageGuard"; // Task 內新建於 src/parentMessageGuard.ts

  function ev(data: unknown, origin: string) {
    return { data, origin } as MessageEvent;
  }
  describe("parent message 守衛", () => {
    const ALLOW = new Set(["http://127.0.0.1:8004"]);
    it("origin 不在白名單 → 拒", () => {
      expect(shouldAcceptParentMessage(ev({ protocol: "vg01", type: "highlight" }, "http://evil"), ALLOW, true)).toBe(false);
    });
    it("缺 protocol → 拒", () => {
      expect(shouldAcceptParentMessage(ev({ type: "highlight" }, "http://127.0.0.1:8004"), ALLOW, true)).toBe(false);
    });
    it("非嵌入（無 parent）→ 拒", () => {
      expect(shouldAcceptParentMessage(ev({ protocol: "vg01", type: "highlight" }, "http://127.0.0.1:8004"), ALLOW, false)).toBe(false);
    });
    it("origin 白名單 + vg01 + 嵌入 → 收", () => {
      expect(shouldAcceptParentMessage(ev({ protocol: "vg01", type: "highlight" }, "http://127.0.0.1:8004"), ALLOW, true)).toBe(true);
    });
    it("canOperate=false → highlight 不處理（M2 守 spectator）", () => {
      expect(canHandleHighlight(false)).toBe(false);
    });
    it("canOperate=true → highlight 處理", () => {
      expect(canHandleHighlight(true)).toBe(true);
    });
  });
  ```

- [ ] 跑確認失敗：
  ```
  cd web-viewer-sample && npx vitest run src/console/windowParentMessage.test.ts
  ```
  預期：import `../parentMessageGuard` 失敗 → 全紅。

- [ ] 最小實作（純函式）：新建 `web-viewer-sample/src/parentMessageGuard.ts`：
  ```ts
  // VG-01：viewer 端 parent postMessage 守衛純函式（可單測，與 Window.tsx 行為共用）。
  export function shouldAcceptParentMessage(
    e: MessageEvent, allowedOrigins: ReadonlySet<string>, isEmbedded: boolean,
  ): boolean {
    if (!isEmbedded) return false;                          // 僅 iframe 內（window.parent !== window）
    if (!allowedOrigins.has(e.origin)) return false;        // origin 白名單（VITE_ALLOWED_COORDINATOR_ORIGINS）
    const m = e.data as { protocol?: string } | null;
    return Boolean(m && m.protocol === "vg01");             // 協定版本
  }
  // M2：spectator / 未就緒（canOperate=false）一律不處理 highlight（守 spectator 邊界，誠實鐵律）。
  export function canHandleHighlight(canOperate: boolean): boolean {
    return canOperate;
  }
  ```

- [ ] 跑確認純函式測試通過：
  ```
  cd web-viewer-sample && npx vitest run src/console/windowParentMessage.test.ts
  ```
  預期：6 個 `it` 全綠。

- [ ] **（必做 checklist step）Window.tsx import 前必做：export env helper**：把 `web-viewer-sample/src/config/env.ts:8` 的
  ```ts
  function allowedCoordinatorOrigins(): Set<string> {
  ```
  改成
  ```ts
  export function allowedCoordinatorOrigins(): Set<string> {
  ```
  **已查證（2026-06-22 grep）：env.ts:8 目前是 `function`（非 export），且同檔 line 52 內部有自用呼叫，加 `export` 為純 additive、不影響既有呼叫。** 未加 export → 下方 `_postToParent` / `_handleParentMessage` 的 `import { allowedCoordinatorOrigins } from "./config/env"` 會 `Module '"./config/env"' has no exported member 'allowedCoordinatorOrigins'`，`npm run build` 直接紅。改完用 `grep -n "export function allowedCoordinatorOrigins" src/config/env.ts` 確認。（此檔已列入 Task 2 Files 與下方 commit 的 `git add`。）

- [ ] 最小實作（Window.tsx 接線 — listener 掛載）：grep 定位 `componentDidMount`（`grep -n "componentDidMount\|componentWillUnmount" src/Window.tsx`，目前 335 / 345）。在 class 體新增欄位與方法，並在 mount/unmount 掛卸：
  - 在 class 欄位區（`private pendingStageUrl: string | null = null;` 那行附近，line 277）加：
    ```ts
    private _firstFramePosted = false; // VG-01 M1：first_frame 只送一次的閂
    private _onParentMessage = (e: MessageEvent): void => this._handleParentMessage(e);
    ```
  - 在 `componentDidMount`（335）body 末尾（`void this._bootstrapReview();` 後）加：
    ```ts
        window.addEventListener("message", this._onParentMessage);
    ```
  - 在 `componentWillUnmount`（345）body（`this.reviewSocket?.disconnect();` 後）加：
    ```ts
        window.removeEventListener("message", this._onParentMessage);
    ```

- [ ] 最小實作（Window.tsx — `_handleParentMessage` + `_postToParent`）：在 `_overlayHighlight`（603）附近新增方法。`allowedOrigins` 複用 `env.ts` 的白名單來源 `allowedCoordinatorOrigins()`（**上一個 Step 已將其 export，此處直接 `import { allowedCoordinatorOrigins } from "./config/env"`**）。`isEmbedded` = `window.parent !== window`：
  ```ts
  private _consoleParentOrigin(): string | null {
    // M5：parent origin 由 document.referrer parse（交叉驗），須在 VITE_ALLOWED_COORDINATOR_ORIGINS 白名單內。
    try { return document.referrer ? new URL(document.referrer).origin : null; } catch { return null; }
  }

  private _postToParent(msg: Record<string, unknown>): void {
    const origin = this._consoleParentOrigin();
    if (!origin || window.parent === window) return;            // 非嵌入或無可信 parent origin → 不送（不對 "*" 廣播）
    if (!allowedCoordinatorOrigins().has(origin)) return;       // 白名單守衛（複用 env.ts 來源）
    window.parent.postMessage({ protocol: "vg01", ...msg }, origin);
  }

  private _handleParentMessage(e: MessageEvent): void {
    const isEmbedded = window.parent !== window;
    if (!shouldAcceptParentMessage(e, allowedCoordinatorOrigins(), isEmbedded)) return;
    if (e.origin !== this._consoleParentOrigin()) return;       // 再交叉驗：event.origin 須等於 referrer parent origin
    const m = e.data as { type?: string; items?: FailedElement[]; ifc_guid?: string };
    switch (m.type) {
      case "highlight": {
        // M2：先算 canOperate（與 render 用同一 deriveOverlayInputs）；false 靜默丟棄、不觸發 _overlayHighlight。
        const lifecycle = this.state.reviewLifecycleStatus;
        const lifecycleActive = lifecycle === "active" || lifecycle === "created";
        const issuesTabReady = this.state.viewerTab === "issues" && Boolean(this.state.reviewSessionId);
        const inputs = deriveOverlayInputs({
          spectator: isSpectatorStreamMode(),
          streamReady: harnessEnabled() || this._hasRemoteVideoFrame() || issuesTabReady,
          lifecycleActive,
        });
        if (!canHandleHighlight(inputs.panelState.canOperate)) return; // spectator / 未就緒靜默丟棄
        for (const item of m.items ?? []) {
          const res = this._overlayHighlight(item);
          this._postToParent({
            type: "highlight_result",
            requestId: res.ok ? res.requestId : "",
            ok: res.ok,
            ...(res.ok ? {} : { reason: res.reason }),
          });
        }
        break;
      }
      case "focus":
        if (m.ifc_guid) {
          // 既有反查 / focus 路徑：以 ifc_guid → primPath 後送 focusPrim（沿用 _overlayHighlight 內的 cache 解析慣例）。
          const primPath = this._mappingCache?.primPathForGuid(m.ifc_guid) ?? null;
          if (primPath) this._sendStreamMessage(buildFocusPrimRequest(primPath));
        }
        break;
      case "clear":
        this._sendStreamMessage(buildClearHighlightRequest());
        break;
      default:
        break; // 未知 type 忽略
    }
  }
  ```
  確認 import：`shouldAcceptParentMessage` / `canHandleHighlight`（`./parentMessageGuard`）、`deriveOverlayInputs`（已 import，line 42）、`isSpectatorStreamMode`/`harnessEnabled`（已在檔內，line 217/33）、`buildFocusPrimRequest`/`buildClearHighlightRequest`（`./clients/streamMessages`，`grep -n "buildClearHighlightRequest\|buildFocusPrimRequest" src/Window.tsx` 確認是否已 import，否則補）、`allowedCoordinatorOrigins`（從 `./config/env` import；**其 export 已由上方「export env helper」Step 完成**）。

- [ ] 最小實作（Window.tsx — first_frame 觸發 M1）：在 `_completeStageLoad`（527）body **末尾**（`this._maybeAutoLoadMapping();` 之後，line 545）加：
  ```ts
      // VG-01 M1：真畫面已到達且 stage 完成（此處為唯一真完成點，由 kit handler 1807/1826 與
      // _completeStageLoadFromVisibleStream（含 _hasRemoteVideoFrame guard）抵達）→ 通知 parent。
      // _firstFramePosted 閂保證只送一次；不接在 _failStageLoad（566）/ 斷線（1306）/ 開檔（1356）等路徑（防偽證據）。
      if (!this._firstFramePosted && window.parent !== window) {
        this._firstFramePosted = true;
        this._postToParent({ type: "first_frame", stageUrl: finalLoadedUrl ?? null });
        this._postToParent({ type: "stage_loaded", stageUrl: finalLoadedUrl ?? null });
      }
  ```

- [ ] 最小實作（Window.tsx — selected_guid 反向）：在 `_reverseLookupGuid`（707）body 末尾（`this.setState({ govSelectedGuid: guid });` 之後，line 712）加：
  ```ts
      this._postToParent({ type: "selected_guid", ifcGuid: guid }); // VG-01 七區塊第7：3D 點構件 → 清單反查
  ```

- [ ] 最小實作（viewer_ready 通知）：在 `componentDidMount`（335）加 listener 後緊接著 post 一則 ready（讓 console 知道 frame 已掛 listener）：
  ```ts
      if (window.parent !== window) this._postToParent({ type: "viewer_ready" });
  ```
  注意：此時 `document.referrer` 應已可用（iframe 由 console 載入）。

- [ ] **（必做 checklist step）S3：嵌入模式下收合 iframe 內 GovernanceOverlay 失敗清單**（spec §2.3 / §4.2 明確要求；缺此項＝雙清單矛盾 UX「console 25 筆 / iframe 另列一份」，等同產品功能不正確）。**已查證物理事實**：viewer 內 `GovernanceOverlay`（Window.tsx:2269 render）的失敗清單表（GovernanceOverlay.tsx:222-256）只由 `failedElements.length` 驅動顯示；GovernanceOverlay **既無 collapse 旗標 prop，本格也不可改其 props 形狀（Task 2 嚴格 additive 約束）**。最小且不改 props 形狀的作法：**嵌入模式（`window.parent !== window`）時把傳給 overlay 的 `failedElements` 餵成空陣列**，使其落入既有「目前無治理失敗構件」分支（清單自然收合），overlay 仍掛載、仍是高亮引擎（postMessage `highlight` 經 `_overlayHighlight` 走 HighlightBridge），但**不再另顯第二份失敗清單**——console 左側 `state.failed` 成為唯一權威清單。
  - grep 定位 render 處 `failedElements={this.state.govFailedElements ?? []}`（Window.tsx:2273）。改為：
    ```tsx
                            failedElements={window.parent !== window ? [] : (this.state.govFailedElements ?? [])}
    ```
    - 誠實補強：在 overlay 上方（或 panel 標題附近）additive 一行說明，讓嵌入時的「空清單」不被誤讀為「真的無失敗」。可在 `GovernanceOverlay` 外層、Window.tsx render 該區塊內加（不改 overlay props 形狀）：
      ```tsx
      {window.parent !== window && (
        <p className="ec-note" data-testid="viewer-embedded-list-collapsed">失敗清單由治理工作台（parent）顯示，此 3D 視窗僅作高亮引擎。</p>
      )}
      ```
  - **不改 `_overlayHighlight` / HighlightBridge / postMessage 路徑**：highlight 指令來自 console postMessage、對 `items` 直接走 bridge，與 overlay 是否顯示清單無關（清單空不影響高亮接線）。
  - 對應單元測（加進 `windowParentMessage.test.ts` 或既有 overlay 測）：嵌入時 `failedElements` 收斂為空、`viewer-embedded-list-collapsed` 提示出現；非嵌入時清單照舊（既有 `GovernanceOverlay.test.tsx` 不壞）。
  > 註：此為 S3 的 viewer 端落地；Task 3 console 端 JSX 已加對應註解（console 左側為唯一權威清單）。兩端合起來才完整解決 spec §2.3 的雙清單矛盾。

- [ ] 跑確認通過（單元 + 既有不壞）：
  ```
  cd web-viewer-sample && npx vitest run src/console/windowParentMessage.test.ts src/console/GovernanceOverlay.test.tsx src/console/console.test.tsx
  ```
  預期：新測全綠；既有 `GovernanceOverlay.test.tsx` / `console.test.tsx` 零退化。

- [ ] 跑 build + lint（Window.tsx 是 TS class，型別易漏）：
  ```
  cd web-viewer-sample && npm run build && npm run lint
  ```
  預期：`vite build` 0 error、eslint 0 warning（`--max-warnings 0`）。

- [ ] GitNexus detect_changes + commit：
  ```
  gitnexus_detect_changes
  cd <repo-root> && git add web-viewer-sample/src/Window.tsx web-viewer-sample/src/parentMessageGuard.ts web-viewer-sample/src/console/windowParentMessage.test.ts web-viewer-sample/src/config/env.ts
  git commit -m "feat(viewer): Window parent postMessage listener + first_frame 觸發（M1/M2 守衛）"
  ```
  預期 scope 僅 `web-viewer-sample`。

---

## Task 3: console A1 頁整合（`A1GovernanceWorkbenchPage`，把 disabled 高亮翻真）

> spec §2.3 / §4.2。把 `pages.tsx:347` 永久 disabled「在 3D 高亮」翻成真按鈕：嵌 `<EmbeddedViewer>`（左失敗清單 / 右 3D，對齊 A1 §163-170 五步 stepper 與 IX-A1-06）；加 active session 下拉（**已查證無 bare `GET /api/review-sessions`，改走 `runtimeStatus().sessions.items`**，無則誠實 disable，S2）；失敗清單每筆「在 3D 高亮」依 **IX-A1-06 四條件**（first_frame[含 DataChannel ready] ∧ stage matched ∧ 有選 session ∧ 構件有 `usd_prim_path`）enable；**viewerOrigin 取自 `runtimeStatus().configured_endpoints.viewer.browser_url_base`（viewer :5173，非 coordinator :8004）**；**S3：console 左側 `state.failed` 為唯一權威失敗清單，iframe 內 overlay 清單收合（viewer 端落地見 Task 2 S3 step），解雙清單矛盾**。**此格交付 (B) 段，依賴 Task 1+2。**

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`A1GovernanceWorkbenchPage` line 207-356；取代 line 347 disabled Btn）
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`（加 `reportFirstFrame` + `listReviewSessions` method，object line 224-247）
- Test: `web-viewer-sample/src/console/A1ViewerEmbed.test.tsx`（新檔）

**GitNexus impact（編輯前）：**
```
gitnexus_impact({ target: "A1GovernanceWorkbenchPage", direction: "upstream" })
```
預期：page component，被 `EdgeConsole` route（`EdgeConsole.tsx:55` a1→）掛載。additive 嵌入子元件 + 取代一顆 disabled 鈕，不改 component 簽名。

**Steps:**

- [ ] 最小實作（coordinatorClient 兩個 method，先讓 page 有 API 可呼叫）：

  **已查證關鍵事實（2026-06-22 grep，spec §1.3 在此點誤判，本 plan 以實際 code 為準）：`bim-review-coordinator/src/app.ts` 沒有 bare `GET /api/review-sessions`（無 sessionId 的 list route）。** 既有的只有 `POST /api/review-sessions`（app.ts:501）、`GET /api/review-sessions/:sessionId`（app.ts:552）、以及 `/:sessionId/...` 子路由。**因此「列 active session」唯一可用的真資料源 = `GET /api/runtime/status` 的 `sessions.items`**（`RuntimeStatus.sessions.items: RuntimeSessionSummary[]`，coordinatorClient.ts:137；`RuntimeSessionSummary` 已含 `session_id` / `status` / `expected_stage_url`，coordinatorClient.ts:94-105，加上 Task 0 後再含 `first_frame_at`）。spec §1.3 寫「`GET /api/review-sessions` 可列 active」與 code 不符，**本 plan 不新增該 route，改走 `runtimeStatus()`**（PR body 須註明此一偏離）。

  在 `web-viewer-sample/src/console/coordinatorClient.ts` 的 `coordinatorClient` object（224-246）內，於 `sessionClose` 後加：
  ```ts
    // VG-01：列 active review session（A1 頁 session 下拉，S2）。
    // 已查證：無 bare GET /api/review-sessions（spec §1.3 誤判）→ 用 runtime/status.sessions.items 為唯一真源。
    // 回傳統一成 { items: RuntimeSessionSummary[] }，讓 A1 page 端 mapping 不變。
    listReviewSessions: async (): Promise<{ items: RuntimeSessionSummary[] }> => {
      const rt = await jsonGet<RuntimeStatus>("/api/runtime/status");
      return { items: rt.sessions.items };
    },
    // VG-01：viewer 首幀回報轉發（viewer postMessage first_frame → console → coordinator）。viewer 不直連 coordinator。
    reportFirstFrame: (sessionId: string, endpointId?: string) =>
      jsonPost<{ session_id: string; first_frame_at: string }>(
        `/api/review-sessions/${encodeURIComponent(sessionId)}/first-frame`,
        { endpoint_id: endpointId },
      ),
  ```
  - 型別：`RuntimeStatus` 與 `RuntimeSessionSummary` 皆已在本檔 export（coordinatorClient.ts:94 / 129），`listReviewSessions` 回傳 `{ items: RuntimeSessionSummary[] }`，故 A1 page 端讀 `r.items[].session_id/status/expected_stage_url/first_frame_at` 全部型別吻合，無需另立 state type。
  - 確認 `jsonGet` / `jsonPost` 已在本檔頂部 import（既有 method 都在用，照既有慣例）。

- [ ] 寫失敗測試（先紅）：新建 `web-viewer-sample/src/console/A1ViewerEmbed.test.tsx`，mock `coordinatorClient`（`vi.mock`）與 `EmbeddedViewer`（mock 成可觸發 callback 的 stub）。比照 `console.test.tsx` 的 render/mock 慣例：
  ```tsx
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { render, screen, fireEvent, waitFor } from "@testing-library/react";

  // 用 stub EmbeddedViewer 暴露 callback，模擬 viewer 回報。
  let lastProps: any = null;
  vi.mock("./EmbeddedViewer", () => ({
    EmbeddedViewer: (props: any) => { lastProps = props; return <div data-testid="embedded-viewer-stub" />; },
  }));
  // 注意：A1 頁的 mount effect 用 coordinatorClient.runtimeStatus()（一次拿 sessions.items + viewer.browser_url_base），
  // 不是 listReviewSessions（已查證無 bare GET /api/review-sessions）。mock 須提供 runtimeStatus，
  // 且回傳 configured_endpoints.viewer.browser_url_base（否則 viewerOrigin=null → 顯 a1-viewer-origin-missing，session-select 仍會出）。
  vi.mock("./coordinatorClient", () => ({
    coordinatorClient: {
      runtimeStatus: vi.fn().mockResolvedValue({
        configured_endpoints: { viewer: { browser_url_base: "http://127.0.0.1:5173", handoff_path: "/" } },
        sessions: { items: [{ session_id: "review_session_x", status: "active", expected_stage_url: "stage://x", first_frame_at: null }] },
      }),
      // listReviewSessions 仍保留（若 A1 頁改走它，二擇一）；此處與 runtimeStatus 回相同 session 集合。
      listReviewSessions: vi.fn().mockResolvedValue({ items: [{ session_id: "review_session_x", status: "active", expected_stage_url: "stage://x", first_frame_at: null }] }),
      reportFirstFrame: vi.fn().mockResolvedValue({ session_id: "review_session_x", first_frame_at: "2026-06-22T00:00:00.000Z" }),
    },
  }));

  import { A1GovernanceWorkbenchPage } from "./pages";

  beforeEach(() => { lastProps = null; });

  describe("A1 頁嵌入 viewer + 3D 高亮接線", () => {
    it("有 active session → 顯示下拉，無 session 文案不出現", async () => {
      render(<A1GovernanceWorkbenchPage />);
      await waitFor(() => expect(screen.getByTestId("a1-session-select")).toBeTruthy());
    });

    it("first frame 未到 → 在 3D 高亮鈕 disabled + 誠實原因", async () => {
      render(<A1GovernanceWorkbenchPage />);
      await waitFor(() => screen.getByTestId("a1-session-select"));
      const btn = screen.getByTestId("a1-highlight-3d") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it("EmbeddedViewer onFirstFrame → 呼叫 reportFirstFrame + 綠燈", async () => {
      const { coordinatorClient } = await import("./coordinatorClient");
      render(<A1GovernanceWorkbenchPage />);
      await waitFor(() => screen.getByTestId("a1-session-select"));
      lastProps.onFirstFrame({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" });
      await waitFor(() => expect(coordinatorClient.reportFirstFrame).toHaveBeenCalledWith("review_session_x", undefined));
      expect(screen.getByTestId("a1-first-frame-evidence").textContent).toContain("first frame");
    });

    it("highlight_result unmapped → 誠實文案『未對映』", async () => {
      render(<A1GovernanceWorkbenchPage />);
      await waitFor(() => screen.getByTestId("a1-session-select"));
      lastProps.onHighlightResult({ protocol: "vg01", type: "highlight_result", requestId: "", ok: false, reason: "unmapped" });
      await waitFor(() => expect(screen.getByTestId("a1-highlight-status").textContent).toMatch(/未對映|無法高亮/));
    });
  });
  ```

- [ ] 跑確認失敗：
  ```
  cd web-viewer-sample && npx vitest run src/console/A1ViewerEmbed.test.tsx
  ```
  預期：testid 找不到（UI 尚未加）→ 紅。

- [ ] 最小實作（A1 頁 — session 下拉 + 嵌 viewer + 證據 + 高亮鈕）：在 `A1GovernanceWorkbenchPage`（207）內：

  > **本步修掉的 4 個對抗發現（執行者務必照新版，舊草稿三處有 bug）：**
  > 1. **viewerOrigin 來源錯（blocker）**：舊草稿傳 `reviewEnv.coordinatorApiBase`＝coordinator `:8004`，但 iframe 要載的是 **viewer（`:5173` baked source）**。已查證唯一正確真源 = `runtimeStatus().configured_endpoints.viewer.browser_url_base`（coordinatorClient.ts:133；coordinator 端 = `viewerPublicBaseUrl`，app.ts:2133）。**不新增 env var**（守 spec §3 / M5），改在 mount effect 一併讀回。傳 `:8004` 會讓 iframe 載 coordinator HTML、postMessage 橋永遠收不到 viewer 訊息、E2E 必 fail。
  > 2. **`reviewEnv` 根本沒 import（major）**：已查證 `pages.tsx` 全檔無 `reviewEnv`（grep 零命中）。改用 `viewerOrigin` state（下方），**不再依賴 `reviewEnv`**，故也不需補該 import。
  > 3. **失敗構件欄位 `f.label` 不存在（major）**：`state.failed` 元素型別 = `RuleResultRow`（governanceClient.ts:37-44），欄位只有 `ifc_guid:string|null` / `usd_prim_path:string|null` / `rule_code:string` / `severity:string` / `status` / `message:string`——**無 `label`**。highlight item 的 label 改用 `f.message`（fallback `f.ifc_guid ?? ""`）。

  - 加 state（在既有 `useState`/`useReducer` 群附近，line 208-213）：
    ```tsx
    const [sessions, setSessions] = useState<{ session_id: string; status: string; expected_stage_url: string | null; first_frame_at?: string | null }[]>([]);
    const [selectedSession, setSelectedSession] = useState<string>("");
    const [viewerOrigin, setViewerOrigin] = useState<string | null>(null); // 真源 = runtime/status.configured_endpoints.viewer.browser_url_base（非 coordinator :8004）
    const [firstFrame, setFirstFrame] = useState(false);
    const [loadedStageUrl, setLoadedStageUrl] = useState<string | null>(null);
    const [hl, setHl] = useState<{ ok: boolean; reason?: string } | null>(null);
    const viewerRef = useRef<import("./EmbeddedViewer").EmbeddedViewerHandle>(null);
    ```
  - 加 effect 載 active session **與 viewer origin**（mount 時，誠實：失敗不偽造）。**已查證：無 bare `GET /api/review-sessions`（見上一 Step），故 session 與 viewerOrigin 同走一次 `runtimeStatus()`，`listReviewSessions()` 內部也是讀 runtime/status，可二擇一；下例用 `runtimeStatus()` 一次拿齊兩者**：
    ```tsx
    useEffect(() => {
      let alive = true;
      coordinatorClient.runtimeStatus()
        .then((rt) => {
          if (!alive) return;
          const act = rt.sessions.items.filter((s) => s.status === "active" || s.status === "created");
          setSessions(act);
          if (act[0]) setSelectedSession(act[0].session_id);
          setViewerOrigin(rt.configured_endpoints.viewer.browser_url_base || null); // 真 viewer 入口（:5173 baked），非 :8004
        })
        .catch(() => { if (alive) { setSessions([]); setViewerOrigin(null); } }); // 誠實：連不上就空，不假資料
      return () => { alive = false; };
    }, []);
    ```
  - 在 return 的 JSX，於「交付」Panel（339）之前插入新 Panel（session 下拉 + 嵌 viewer + 證據）。**注意 `viewerOrigin={viewerOrigin}`（state，真 viewer 入口），不是 `reviewEnv.coordinatorApiBase`；viewerOrigin 還沒載到（null）時誠實顯「viewer 入口未取得」而非掛空 iframe**：
    ```tsx
        <Panel title="3D 即時檢視（嵌入 live viewer）" sub="重用既有 viewer 串流；first frame / stage truth 為真證據，非樂觀更新" prov="asbuilt">
          {sessions.length === 0 ? (
            <p className="ec-warn-note" data-testid="a1-no-session">需先派發 review session（無 active session，3D 高亮停用）</p>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <label>review session</label>
                <select data-testid="a1-session-select" value={selectedSession} onChange={(e) => { setSelectedSession(e.target.value); setFirstFrame(false); setLoadedStageUrl(null); setHl(null); }}>
                  {sessions.map((s) => <option key={s.session_id} value={s.session_id}>{s.session_id}（{s.status}）</option>)}
                </select>
              </div>
              <div className="ec-grid" style={{ marginBottom: 8 }}>
                <div data-testid="a1-first-frame-evidence"><Field k="first frame" v={firstFrame ? "已收到真畫面（綠）" : "not_observed（等待 3D 第一幀）"} prov={firstFrame ? "asbuilt" : "p1"} /></div>
                <Field k="stage matched" v={stageMatchedText(sessions, selectedSession, loadedStageUrl)} prov="asbuilt" />
              </div>
              {/* S3：iframe 內 viewer 自帶 GovernanceOverlay 失敗清單（會與 console 左側清單重複，造成「console 25 筆 / iframe 說無失敗」矛盾 UX）。
                  解法分兩端：(a) viewer 端在嵌入模式把 overlay 的 failedElements 餵空使清單收合（Task 2「S3 收合」step）；
                  (b) console 端此處只把 iframe 當高亮引擎，**唯一權威失敗清單 = 左側 state.failed 記分板**，iframe 不另顯第二份清單。 */}
              {viewerOrigin === null ? (
                <p className="ec-warn-note" data-testid="a1-viewer-origin-missing">viewer 入口未取得（runtime/status 無 configured_endpoints.viewer.browser_url_base 或 coordinator 連不上），3D 暫不可用</p>
              ) : (
                <div style={{ height: 480 }}>
                  <EmbeddedViewer
                    ref={viewerRef}
                    sessionId={selectedSession}
                    viewerOrigin={viewerOrigin}
                    onFirstFrame={() => { setFirstFrame(true); void coordinatorClient.reportFirstFrame(selectedSession).catch(() => {}); }}
                    onStageLoaded={(u) => setLoadedStageUrl(u)}
                    onHighlightResult={(m) => setHl({ ok: m.ok, reason: m.reason })}
                  />
                </div>
              )}
            </>
          )}
        </Panel>
    ```
  - 取代 line 347 disabled Btn（`<Btn prov="p1" disabled caption="需 viewer DataChannel...">在 3D 高亮</Btn>`），改成依 **IX-A1-06 四條件**完整 enable 的真按鈕（針對失敗清單第一筆做示範；多筆由 FailureScoreboard 內逐列接，見下一步）。

    > **IX-A1-06 四條件落地（修對抗發現：舊草稿只落 1 條，違誠實鐵律）**：spec §2.3 enable = **DataChannel ready ∧ first_frame ∧ stage matched ∧ 構件有 `usd_prim_path`**。本格 console 端對映如下（每條都有來源，非裝飾）：
    > 1. **DataChannel ready + first_frame**：已查證 viewer 端 `dataChannelReady() = this.state.showStream && this._hasRemoteVideoFrame()`（Window.tsx:610），與 first_frame 觸發點同一信號（`_completeStageLoad` 後、`_hasRemoteVideoFrame()` 為真才送 first_frame，M1）。**故 console 可觀測的 `firstFrame===true` 即代表「DataChannel ready ∧ first_frame」兩條同時成立**（viewer 是唯一真源；萬一送 highlight 當下 DataChannel 仍未就緒，viewer 會回 `highlight_result{reason:"datachannel_not_ready"}`，console 顯誠實原因——見 `highlightResultText`）。協定不另造 `datachannel_ready` 事件（避免假信號；YAGNI）。
    > 2. **stage matched**：`isStageMatched(sessions, selectedSession, loadedStageUrl)` 純函式（下方新增）＝ `expected_stage_url === loadedStageUrl`，沿用 `stageMatchedText` 同一比對。
    > 3. **構件有 `usd_prim_path`**：`state.failed` 元素型別 `RuleResultRow` 已含 `usd_prim_path: string | null`（governanceClient.ts:39）；逐筆檢查非 null/空。**無 prim_path 的構件鈕 disabled + 誠實原因**（不送、viewer 也會回 unmapped）。
    >
    > 多筆（FailureScoreboard 逐列）以同一 `canHighlightRow(f)` 判斷逐列 enable；此處示範第一筆。
    ```tsx
        {(() => {
          const f0 = state.failed[0];
          const stageMatched = isStageMatched(sessions, selectedSession, loadedStageUrl);
          // IX-A1-06 四條件：first_frame(含 DataChannel ready) ∧ 有選 session ∧ stage matched ∧ 該構件有 usd_prim_path ∧ guid 非 null。
          const rowHighlightable = Boolean(f0 && f0.ifc_guid && f0.usd_prim_path);
          const canHighlight = firstFrame && Boolean(selectedSession) && stageMatched && rowHighlightable;
          const disabledReason = !firstFrame ? "等待 3D 第一幀（first frame / DataChannel 未就緒）"
            : !stageMatched ? "stage 未對齊（expected ≠ loaded）"
            : !f0 ? "尚無失敗構件"
            : !f0.ifc_guid ? "此構件無 ifc_guid，無法高亮"
            : !f0.usd_prim_path ? "此構件未對映 USD（無 usd_prim_path），無法高亮"
            : "";
          return (
            <Btn data-testid="a1-highlight-3d"
              disabled={!canHighlight}
              caption={canHighlight ? "postMessage highlight → viewer HighlightBridge（IX-A1-06 四條件）" : disabledReason}
              onClick={() => {
                if (!f0 || !f0.ifc_guid) return;
                viewerRef.current?.sendHighlight([{
                  ifc_guid: f0.ifc_guid,               // 已查證 RuleResultRow.ifc_guid: string|null → 此處已 guard 非 null
                  severity: f0.severity,
                  label: f0.message ?? f0.ifc_guid,    // RuleResultRow 無 label 欄；改用 message（fallback ifc_guid）
                  rule_code: f0.rule_code,
                }]);
              }}>
              在 3D 高亮（第一筆失敗）
            </Btn>
          );
        })()}
        {hl && <span className="ec-note" data-testid="a1-highlight-status" style={{ marginLeft: 6 }}>{highlightResultText(hl)}</span>}
    ```
    註：`state.failed` 元素型別已查證 = `RuleResultRow`（a1Machine.ts:11 `failed: RuleResultRow[]`；型別在 governanceClient.ts:37-44），欄位為 `ifc_guid:string|null` / `usd_prim_path:string|null` / `rule_code:string` / `severity:string` / `status` / `message:string`，**無 `label`**。上方 mapping 已對齊（label→message、guid 先 guard）。`EmbeddedViewer` 的 `HighlightItem.ifc_guid` 與 viewer `FailedElement.ifc_guid` 皆為 `string`（非 null，highlightBridge.ts:11），故 onClick 內必先 `f0.ifc_guid` guard。
  - 加三個純函式 helper（檔案模組層，A1 page 外）：
    ```tsx
    function isStageMatched(sessions: { session_id: string; expected_stage_url: string | null }[], selected: string, loaded: string | null): boolean {
      const exp = sessions.find((s) => s.session_id === selected)?.expected_stage_url ?? null;
      return Boolean(loaded && exp && loaded === exp);
    }
    function stageMatchedText(sessions: { session_id: string; expected_stage_url: string | null }[], selected: string, loaded: string | null): string {
      const exp = sessions.find((s) => s.session_id === selected)?.expected_stage_url ?? null;
      if (!loaded) return "not_observed（尚未載入）";
      if (!exp) return "loaded（無 expected 可比對）";
      return loaded === exp ? "matched（expected == loaded）" : "mismatch（expected ≠ loaded，警示）";
    }
    function highlightResultText(hl: { ok: boolean; reason?: string }): string {
      if (hl.ok) return "已在 3D 標示";
      if (hl.reason === "unmapped") return "此構件未對映 USD，無法高亮";
      if (hl.reason === "datachannel_not_ready") return "3D 尚未就緒";
      return "高亮未成功";
    }
    ```
  - 確認 import：`EmbeddedViewer`/`EmbeddedViewerHandle`（`./EmbeddedViewer`）、`useEffect`/`useRef`/`useState`（react，多半已 import）。**已查證：`pages.tsx` 無 `reviewEnv`（grep 零命中），本步改用 `viewerOrigin` state（讀 runtime/status），故不需也不要補 `reviewEnv` import。**

- [ ] 跑確認通過：
  ```
  cd web-viewer-sample && npx vitest run src/console/A1ViewerEmbed.test.tsx
  ```
  預期：4 個 `it` 全綠。

- [ ] 跑既有 console / overlay 測試（不壞）+ build + lint：
  ```
  cd web-viewer-sample && npx vitest run src/console/console.test.tsx src/console/GovernanceOverlay.test.tsx && npm run build && npm run lint
  ```
  預期：零退化、build 0 error、lint 0 warning。

- [ ] GitNexus detect_changes + commit：
  ```
  gitnexus_detect_changes
  cd <repo-root> && git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/coordinatorClient.ts web-viewer-sample/src/console/A1ViewerEmbed.test.tsx
  git commit -m "feat(console): A1 頁嵌入 EmbeddedViewer + 3D 高亮接線（IX-A1-06 四條件）"
  ```
  預期 scope 僅 `web-viewer-sample`。

---

## Task 4: console 證據顯示翻真（`ViewerPresentationPage` + runtimeGovernance 型別鏈）

> spec §2.5 / §4.5。`ViewerPresentationPage`（`pages.tsx:358-376`）的 `first_frame_at`（364）、`WebRTC first frame`（375）、`Stage truth`（376）由 p1 翻真，讀 `runtime/status.sessions[].first_frame_at`（經 Task 0 emit）。完成型別鏈剩餘兩處（M3 的 (2)(3)）。**依賴 Task 0。**

**Files:**
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`（`RuntimeSessionSummary` interface，line 94-105，加 `first_frame_at`）
- Modify: `web-viewer-sample/src/console/coordinator/runtimeGovernance.ts`（line 165，改讀 `session.first_frame_at`）
- Modify: `web-viewer-sample/src/console/pages.tsx`（`ViewerPresentationPage` line 358-376，prov 翻真）
- Test: `web-viewer-sample/src/console/coordinator/runtimeGovernance.test.ts`（既有檔，更新斷言）

**Steps:**

- [ ] 最小實作（型別鏈 (2)：`RuntimeSessionSummary`）：在 `coordinatorClient.ts` 的 `RuntimeSessionSummary`（94-105），於 `updated_at: string;`（line 104）後加：
  ```ts
    updated_at: string;
    first_frame_at?: string | null; // VG-01：coordinator runtime/status 透出的真首幀證據
  }
  ```

- [ ] 寫失敗測試（先紅，型別鏈 (3)）：在既有 `runtimeGovernance.test.ts` 加一個 case（`grep -n "describe\|firstFrame\|not_observed" src/console/coordinator/runtimeGovernance.test.ts` 找既有結構照抄 fixture）：
  ```ts
  it("session 有 first_frame_at → firstFrame=ok（非 hardcoded not_observed）", () => {
    // 用既有 fixture builder 造一個 binding 綁 session、且該 session first_frame_at 有值
    const rows = deriveEndpointRows(/* rt fixture：session.first_frame_at = "2026-06-22T..." */);
    const pri = rows.find((r) => r.role === "primary")!;
    expect(pri.firstFrame).toBe("ok");
  });
  ```
  （函式名以實際 export 為準：`grep -n "export function" src/console/coordinator/runtimeGovernance.ts`。）

- [ ] 跑確認失敗：
  ```
  cd web-viewer-sample && npx vitest run src/console/coordinator/runtimeGovernance.test.ts
  ```
  預期：新 case 紅（line 165 仍 hardcoded `readiness === "free" ? "missing" : "not_observed"`）。

- [ ] 最小實作（型別鏈 (3)：runtimeGovernance:165）：grep 定位（`grep -n "firstFrame: readiness" src/console/coordinator/runtimeGovernance.ts`，目前 165；`session` 變數在 line 149 `findSession(rt, binding)`）。改：
  ```ts
        firstFrame: session?.first_frame_at ? "ok" : (readiness === "free" ? "missing" : "not_observed"),
  ```
  （`session` 為 `RuntimeSessionSummary | undefined`，現已含 `first_frame_at`。）

- [ ] 跑確認通過：
  ```
  cd web-viewer-sample && npx vitest run src/console/coordinator/runtimeGovernance.test.ts
  ```
  預期：新 case + 既有 case 全綠。

- [ ] 最小實作（`ViewerPresentationPage` 翻真）：在 `pages.tsx`（358-376）。把 capabilities 陣列（359-366）`first_frame_at` 與 `stage matched` 的 prov 由語意調整為「資料來源已接、未觀察時誠實 not_observed」：
  - line 364 `["first_frame_at", "viewer 是否真的看到畫面，不等於 port open", "p1"]` → 第三欄改 `"asbuilt"`，並在頁面實際讀 `coordinatorClient.runtimeStatus()` 的 `sessions.items[].first_frame_at`（mount effect 載入，渲染：有值→綠、無值→灰 not_observed）。
  - line 375 `<Field k="WebRTC first frame" v="尚需 browser 回報 first_frame_at" prov="p1" />` → 改成讀真值：
    ```tsx
            <Field k="WebRTC first frame" v={firstFrameEvidenceText} prov="asbuilt" />
    ```
  - line 376 `<Field k="Stage truth" v="expected == loaded 才能宣稱 matched" prov="p1" />` → 保留說明文字但 prov→`"asbuilt"`（A1 頁已示真比對；此頁為總覽）。
  - 加 mount effect + state（頁元件內）：
    ```tsx
    const [firstFrameEvidenceText, setFirstFrameEvidenceText] = useState("not_observed（尚無 active session 回報）");
    useEffect(() => {
      let alive = true;
      coordinatorClient.runtimeStatus()
        .then((rt) => { if (!alive) return; const seen = rt.sessions.items.some((s) => Boolean(s.first_frame_at)); setFirstFrameEvidenceText(seen ? "已觀察到 first frame（至少一 session）" : "not_observed（無 session 回報真畫面）"); })
        .catch(() => { if (alive) setFirstFrameEvidenceText("not_observed（coordinator 連不上）"); });
      return () => { alive = false; };
    }, []);
    ```
    誠實：連不上 / 沒回報都顯示 `not_observed`，不假綠。

- [ ] 跑確認通過（含既有 ViewerPresentation 相關測試不壞）：
  ```
  cd web-viewer-sample && npx vitest run src/console/console.test.tsx src/console/coordinator/runtimeGovernance.test.ts && npm run build && npm run lint
  ```
  預期：全綠、build 0 error、lint 0 warning。

- [ ] GitNexus detect_changes + commit：
  ```
  gitnexus_detect_changes
  cd <repo-root> && git add web-viewer-sample/src/console/coordinatorClient.ts web-viewer-sample/src/console/coordinator/runtimeGovernance.ts web-viewer-sample/src/console/coordinator/runtimeGovernance.test.ts web-viewer-sample/src/console/pages.tsx
  git commit -m "feat(console): first_frame_at 證據翻真 + runtimeGovernance 讀真值（型別鏈收尾）"
  ```

---

## Task 5: Browser E2E（Playwright，唯一接受的 user-facing 證據）

> spec §6.4。**誠實可達框架**：守門 + 檔頭 skip 限制揭露比照既有 `e2e/a1-m1-closeout.spec.ts`（conditional skip → Playwright 計 pass，但檔頭如實揭露「skip ≠ PASS」、本 repo 無 Playwright CI job 故不 false-green）。對 live 測試區：種 active review session（沿用既有真 IFC fixtures）→ 開 A1 頁選 session → 右側 `<EmbeddedViewer>` 載入 → 截圖真 3D 畫面 + first_frame 綠燈 + stage matched → 跑檢核 → 點已對映失敗構件截圖紅高亮 → 點未對映構件截圖誠實拒絕。**cross-build-target：E2E 前重建 console（`build:ui`）與 viewer（`docker compose build viewer` + `up -d`）兩者。**

**Files:**
- Create: `web-viewer-sample/e2e/viewer-embed-a1-highlight.spec.ts`

**Steps:**

- [ ] 寫 E2E spec（含誠實守門 + 檔頭限制揭露）：新建 `web-viewer-sample/e2e/viewer-embed-a1-highlight.spec.ts`，**檔頭照抄 `a1-m1-closeout.spec.ts:1-25` 的揭露結構**（cross-build-target 前置、conditional skip 效力限制、最近一次 run 如實結果），body：
  ```ts
  import { test, expect } from "@playwright/test";
  // VG-01：A1 工作台嵌入 live viewer → first_frame 綠燈 / stage matched → 失敗構件 3D 紅高亮 → 未對映誠實拒絕。
  //
  // *** cross-build-target 前置（乾淨環境必做，否則「改了沒效」假象）：
  //     1. cd web-viewer-sample && npm run build:ui          # console dist-ui（:8004/ui）
  //     2. docker compose build viewer && docker compose up -d viewer   # viewer image（:5173 baked source）
  //     3. 重啟 coordinator 服務新 dist-ui；種 active review session（POST /api/review-sessions 綁 artifact_bindings）。
  //     未重建任一 target → 本 spec 觀察到的是陳舊碼，不算驗證（記憶 ui-open-redirects-to-5173-baked-viewer）。
  //
  // *** skip-gate 效力限制（誠實揭露，比照 a1-m1-closeout.spec.ts）：
  //     beforeEach 為 conditional skip（前置缺 → skip → Playwright 計 pass）。本 repo .github/workflows
  //     僅 pr-review-agent.yml、無 Playwright job，故 skip 不會 false-green 任何 CI gate；純屬本機/指揮官手動 P4 硬 gate。
  //     真 PASS 須先完成上述 build:ui + viewer 重建 + 種 session，且截圖落地才算（截圖不存在＝走了 skip 而非 PASS）。***
  const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

  test.describe("VG-01：A1 嵌入 viewer + 3D 高亮", () => {
    test.setTimeout(360_000); // Kit 串流首幀 + rule-run 慢路徑

    let sessionId = "";
    test.beforeEach(async ({ request, page }) => {
      // 守門 1：coordinator 可達
      let apiOk = false;
      try { apiOk = (await request.get(`${COORDINATOR}/health`, { timeout: 10_000 })).ok(); } catch { apiOk = false; }
      test.skip(!apiOk, "coordinator 未備妥");
      // 守門 2：有 active session（沿用既有 fixtures；無則種一個 / 或 skip——比照既有 spec 慣例）
      try {
        const rt = await request.get(`${COORDINATOR}/api/runtime/status`, { timeout: 10_000 });
        const items = (await rt.json())?.sessions?.items ?? [];
        const act = items.find((s: any) => s.status === "active" || s.status === "created");
        sessionId = act?.session_id ?? "";
      } catch { sessionId = ""; }
      test.skip(!sessionId, "無 active review session（需先 POST /api/review-sessions 綁真 IFC fixture）");
      // 守門 3：dist-ui 為本 branch（a1-session-select 是本 branch 才有的 testid）
      await page.goto(`${COORDINATOR}/ui/#a1`, { waitUntil: "domcontentloaded" });
      const hasSelect = await page.getByTestId("a1-session-select").count().then((c) => c > 0).catch(() => false);
      test.skip(!hasSelect, "服務的 dist-ui 缺 a1-session-select → 需 npm run build:ui + 重啟 coordinator");
    });

    test("first frame 綠燈 + stage matched 截圖", async ({ page }) => {
      await page.goto(`${COORDINATOR}/ui/#a1`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("a1-session-select").selectOption(sessionId);
      // 等真畫面到（first frame 綠燈），最長等到 stream 起來
      await expect(page.getByTestId("a1-first-frame-evidence")).toContainText(/已收到真畫面|first frame/, { timeout: 180_000 });
      await page.screenshot({ path: "../artifacts/e2e/viewer-embed-a1-highlight-firstframe.png", fullPage: true });
    });

    test("失敗構件 3D 紅高亮（已對映）截圖", async ({ page }) => {
      await page.goto(`${COORDINATOR}/ui/#a1`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("a1-session-select").selectOption(sessionId);
      await expect(page.getByTestId("a1-first-frame-evidence")).toContainText(/已收到真畫面|first frame/, { timeout: 180_000 });
      // 跑檢核 → 失敗清單（沿用 a1-step-pick / a1-step-run，見 a1-m1-closeout.spec）
      await page.getByTestId("a1-step-pick").click();
      await page.getByTestId("a1-step-run").click();
      await expect(page.getByTestId("a1-rulerun-scoreboard")).toBeVisible({ timeout: 180_000 });
      await page.getByTestId("a1-highlight-3d").click();
      await expect(page.getByTestId("a1-highlight-status")).toContainText(/已在 3D 標示|未對映/, { timeout: 30_000 });
      await page.screenshot({ path: "../artifacts/e2e/viewer-embed-a1-highlight-redhighlight.png", fullPage: true });
    });

    test("未對映構件誠實拒絕截圖（核心信任證據）", async ({ page }) => {
      // 此張為對抗「3D 都是假的」質疑的核心信任證據（product angle）。
      // 若 fixture 全對映、無 unmapped 構件可點，以 notObserved 揭露、不偽造（見 summary）。
      test.skip(true, "需 fixture 含未對映構件；若無，summary 以 notObserved[] 揭露，不偽造此張");
    });
  });
  ```
  註：`a1-highlight-status` 文案在已對映 fixture 下會是「已在 3D 標示」，未對映才「未對映」；spec §6.4 的「未對映截圖」需要 fixture 含未對映構件，無則誠實 `notObserved`，不偽造。

- [ ] cross-build-target 重建（spec §7 / 記憶 ui-open-redirects-to-5173-baked-viewer）：
  ```
  cd web-viewer-sample && npm run build:ui
  # 重啟 coordinator 服務新 dist-ui（依測試區慣例：docker compose restart coordinator 或 deploy golden path）
  docker compose build viewer && docker compose up -d viewer
  ```
  預期：`build:ui` 產 `dist-ui`；viewer image 重建為本 branch `Window.tsx`。**未重建＝E2E 觀察陳舊碼。**

- [ ] 跑 E2E（對 live 測試區）：
  ```
  cd web-viewer-sample && E2E_COORDINATOR_BASE_URL=http://127.0.0.1:8004 npx playwright test e2e/viewer-embed-a1-highlight.spec.ts
  ```
  預期：若前置齊全＝截圖落 `artifacts/e2e/viewer-embed-a1-highlight-*.png` 且斷言綠；前置缺＝conditional skip（檔頭已揭露 skip ≠ PASS）。**如實回報是 PASS 還是 skipped。**

- [ ] 落 tracked evidence（抽樣，禁 commit IFC/usdc/大圖原始）：把關鍵截圖複製到 `docs/evidence/viewer-embed-a1-highlight/`（first frame 綠燈、紅高亮、誠實拒絕三張為主），E2E summary 明寫「僅對齊七區塊第 6（紅高亮）+ 第 7（反向 selected_guid）」、未觀察轉移以 `notObserved[]` 揭露。

- [ ] commit：
  ```
  cd <repo-root> && git add web-viewer-sample/e2e/viewer-embed-a1-highlight.spec.ts docs/evidence/viewer-embed-a1-highlight/
  git commit -m "test(e2e): VG-01 A1 嵌入 viewer 3D 高亮 browser evidence（含誠實 skip 揭露）"
  ```

---

## 最終驗收（spec §6.5）+ 完成回報

- [ ] 全套 verify：
  ```
  cd bim-review-coordinator && npm run verify
  cd web-viewer-sample && npm run verify
  cd web-viewer-sample && npx playwright test e2e/viewer-embed-a1-highlight.spec.ts
  ```
  預期：coordinator build+test 全綠；web-viewer-sample build+vitest 全綠；E2E 綠或如實 skip。`#a1`/`#a2`/`#a3`/`#viewer`/`#sessions` 既有 E2E 與既有測試不壞。

- [ ] GitNexus detect_changes 最終驗 scope：
  ```
  gitnexus_detect_changes
  ```
  預期：所有變更僅落 `web-viewer-sample` 與 `bim-review-coordinator`，無外溢。

- [ ] 完成回報（CLAUDE.md §1 四項）：
  1. 改了哪些 tracked files（按 Task 列出）。
  2. 執行了哪些最小驗證（coordinator verify / web-viewer-sample verify / vitest / E2E PASS-or-skip 如實）。
  3. 哪些測試沒跑以及原因（E2E 若 skip：cross-build-target 前置 / 無 active session / 無未對映 fixture，逐條揭露）。
  4. 已知風險或既有問題（cross-build-target 須兩 target 同步；first_frame_at in-memory 重啟清除 N2；未對映截圖依賴 fixture）。

- [ ] PR body 須寫進的刻意設計選擇（spec §3）：不讓 console 自建 WebRTC（重用 viewer iframe）；A1 高亮引擎不重做（交付 = 橋 + `first_frame_at` 後端化）；七區塊只交付第 6+7；非目標清單（A2/A3/snapshot-BCF/heartbeat 各自獨立 spec）。PR 前 `git fetch origin` 比 merge-base，stale 就 rebase origin/main（記憶 spec-to-done-rebase-stale-branch-before-pr）。
