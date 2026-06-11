# Conversion artifact_id sanitize（中文 model_version_id 派工修復）Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

- **Goal:** 讓含中文（非 safe 字元）的 `external_model_version_id` 不再使 coordinator 對 conversion API 的派工被 `SAFE_ID_RE` 擋成 400，並讓 `#/conv` Ifc-ready jobs 表可見 `dispatch_error` 明細。
- **Architecture:** 修在 coordinator 端（`bim-review-coordinator`）—新增純函式 `sanitizeArtifactIdPart` 在組 `ifc_artifact.artifact_id` 前先把 raw external id 過濾成 safe 形（非 safe 時加 `sha256` 前 8 碼後綴維持確定性與唯一性），純 safe id 零行為變化；前端 `web-viewer-sample` EdgeConsole 的 `ConversionSchedulingPage` 把後端已回的 `dispatch_error` 欄位顯示出來。不動 conversion authority、不放寬 `SAFE_ID_RE`。
- **Tech Stack:** TypeScript（Node 內建 `crypto`，不加依賴）；coordinator 用 vitest + supertest；前端 React + vitest（`renderToString` / `createRoot` + `act`）；Browser E2E 用 Playwright（`web-viewer-sample/e2e/`）。

---

## 背景：已查證的精確錨點（執行者零脈絡可直接照做）

以下路徑與行號皆已用 Read/Grep 在本 worktree 確認，非臆測：

- coordinator 組 artifact_id：`bim-review-coordinator/src/services/streamingConversionClient.ts` 的 `toInternalIfcReadyEvent`，目前 L112 為 `artifact_id: \`ifc_${binding.externalModelVersionId}\``。
- coordinator 既有單元測試：`bim-review-coordinator/tests/streaming-conversion-client.test.ts`（vitest，`import { toInternalIfcReadyEvent } from "../src/services/streamingConversionClient.js"`，注意 `.js` 副檔名）。
- coordinator dispatch 整合測試模式：`bim-review-coordinator/tests/external-ifc-ready.test.ts`（supertest + `createCoordinatorApp` + 用 `http.createServer` 起 stub streaming server 與 stub IFC source server）。
- conversion 端驗證規則（不動，僅供 test 鎖規則）：`bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/conversion_authority.py:10` `SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")`，L692 `_safe_id(... "ifc_artifact_id")`。
- 後端**已**回 `dispatch_error`：`bim-review-coordinator/src/app.ts:1827` `summarizeIfcReadyJob` 回 `dispatch_error: job.dispatch_error ?? null`（前端只缺型別欄位與渲染，後端不需改）。
- 前端列表型別：`web-viewer-sample/src/console/coordinatorClient.ts` 的 `IfcReadyListItem`（L98–111，目前**無** `dispatch_error` 欄位）。
- 前端列表頁：`web-viewer-sample/src/console/pages.tsx` 的 `ConversionSchedulingPage`（L280–312），Ifc-ready jobs 表在 L303–308，路由 `#/conv`（`EdgeConsole.tsx:67` `case "conv"`）。
- 前端既有測試：`web-viewer-sample/src/console/console.test.tsx`（L369 `renderToString(<ConversionSchedulingPage />)`）與 `web-viewer-sample/src/console/IntakeSelectPage.test.tsx`（mount + `vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue(...)` 模式）。
- 既有錯誤文案樣式類別：`ec-warn-note`（pages.tsx 已大量使用）。
- E2E 慣例：`web-viewer-sample/e2e/`，coordinator base 取 `process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004"`（見 `real-ifc-storage-intake.spec.ts`）；playwright 只 auto-start viewer dev server（:5180），coordinator 需另行啟動。

驗證指令：
- coordinator：`cd bim-review-coordinator; npm run build; npm test`（單跑某檔：`npx vitest run tests/streaming-conversion-client.test.ts`）。
- 前端：`cd web-viewer-sample; npm test`（單跑某檔：`npx vitest run src/console/console.test.tsx`）。
- 前端 E2E：`cd web-viewer-sample; npm run test:e2e`（需先啟動 coordinator :8004）。

---

## Task 0: coordinator `sanitizeArtifactIdPart` 純函式（含回歸鎖 + 確定性）

純函式新增與單元測試，不碰 dispatch 路徑（Task 1 才接線）。先把規則用測試鎖死。

**Files:**
- Modify: `bim-review-coordinator/src/services/streamingConversionClient.ts`（新增 export `sanitizeArtifactIdPart`，先不改 L112）
- Modify (Test): `bim-review-coordinator/tests/streaming-conversion-client.test.ts`

### Steps

- [ ] 在測試檔 `bim-review-coordinator/tests/streaming-conversion-client.test.ts` 最上方 import 加入 `sanitizeArtifactIdPart` 與 Node `crypto`，並在檔尾新增一個 `describe`。把以下整段 append 到檔案末端（保留既有 `toInternalIfcReadyEvent` 兩個測試不動）：

```ts
import crypto from "node:crypto";
import { sanitizeArtifactIdPart } from "../src/services/streamingConversionClient.js";

const SAFE_ID_RE = /^[A-Za-z0-9_.-]+$/; // = conversion_authority.py SAFE_ID_RE，逐字鎖規則

describe("sanitizeArtifactIdPart", () => {
  it("純 safe 字元的 id 原樣回傳（向後相容，零行為變化）", () => {
    expect(sanitizeArtifactIdPart("ext_mv_identity")).toBe("ext_mv_identity");
    expect(sanitizeArtifactIdPart("271_pieple-A.1")).toBe("271_pieple-A.1");
  });

  it("含中文的 id → safe 前綴 + sha256 前 8 碼，且整體（含 ifc_ 前綴）通過 SAFE_ID_RE", () => {
    const out = sanitizeArtifactIdPart("271_pieple_管線");
    const hash8 = crypto.createHash("sha256").update("271_pieple_管線").digest("hex").slice(0, 8);
    expect(out).toBe(`271_pieple__${hash8}`);
    expect(SAFE_ID_RE.test(`ifc_${out}`)).toBe(true);
  });

  it("確定性：同一 raw 兩次呼叫輸出相同", () => {
    expect(sanitizeArtifactIdPart("271_pieple_管線")).toBe(sanitizeArtifactIdPart("271_pieple_管線"));
  });

  it("不碰撞：兩個不同中文 id 輸出不同", () => {
    expect(sanitizeArtifactIdPart("271_pieple_管線")).not.toBe(sanitizeArtifactIdPart("271_pieple_水管"));
  });

  it("全非 safe 字元 id → mv_<hash8> 退化形", () => {
    const out = sanitizeArtifactIdPart("管線水電消防");
    const hash8 = crypto.createHash("sha256").update("管線水電消防").digest("hex").slice(0, 8);
    expect(out).toBe(`mv_${hash8}`);
    expect(SAFE_ID_RE.test(`ifc_${out}`)).toBe(true);
  });
});
```

- [ ] 跑測試確認失敗（函式尚未存在）：

```bash
cd bim-review-coordinator && npx vitest run tests/streaming-conversion-client.test.ts
```

預期：失敗，訊息類似 `sanitizeArtifactIdPart is not a function` 或型別/import 解析錯誤（新 describe 全紅，既有兩測試仍綠）。

- [ ] 在 `bim-review-coordinator/src/services/streamingConversionClient.ts` 檔頭（第 1 行 `import type { ... }` 之後）加入 crypto import：

```ts
import crypto from "node:crypto";
```

- [ ] 在 `streamingConversionClient.ts` 的 `toInternalIfcReadyEvent` 函式定義（`export function toInternalIfcReadyEvent`）之前，插入純函式：

```ts
/**
 * conversion-artifact-id-sanitize（spec 2026-06-11 §4.1）：把外部 model_version_id
 * 轉成通過 conversion 端 `SAFE_ID_RE = ^[A-Za-z0-9_.-]+$` 的 artifact_id 片段。
 *
 * - 純 safe 字元 → 原樣回傳（零行為變化，既有英文 id 的 artifact_id 與現行完全相同）。
 * - 含非 safe 字元 → `${safe}_${sha256hex(raw).slice(0,8)}`（確定性 + 防碰撞）。
 * - safe 為空（全非 safe 字元）→ `mv_${sha256hex(raw).slice(0,8)}`（可讀前綴退化形）。
 *
 * 不放寬 conversion 端規則（id 進檔案路徑 / USD 命名，放寬有路徑安全風險），修在 coordinator 端。
 */
export function sanitizeArtifactIdPart(raw: string): string {
  const safe = raw.replace(/[^A-Za-z0-9_.-]/g, "");
  if (safe === raw) return raw;
  const hash8 = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 8);
  return safe.length > 0 ? `${safe}_${hash8}` : `mv_${hash8}`;
}
```

- [ ] 跑測試確認通過：

```bash
cd bim-review-coordinator && npx vitest run tests/streaming-conversion-client.test.ts
```

預期：全綠（含既有 `toInternalIfcReadyEvent` 兩測試 + 新 `sanitizeArtifactIdPart` 五測試）。

- [ ] commit：

```bash
cd bim-review-coordinator && git add src/services/streamingConversionClient.ts tests/streaming-conversion-client.test.ts && git commit -m "feat(coordinator): 新增 sanitizeArtifactIdPart 純函式（中文 id → safe artifact_id）"
```

---

## Task 1: dispatch 接線（`toInternalIfcReadyEvent` 用 sanitize 組 artifact_id）+ 整合回歸

把 sanitize 接到實際 dispatch payload，並加 supertest 整合測試：stub conversion API 以同一 `SAFE_ID_RE` 規則驗收 artifact_id，證明中文 model_version_id 的 dispatch 不再 400。

**Files:**
- Modify: `bim-review-coordinator/src/services/streamingConversionClient.ts`（改 `toInternalIfcReadyEvent` 內 artifact_id 組法）
- Modify (Test): `bim-review-coordinator/tests/streaming-conversion-client.test.ts`（補 `toInternalIfcReadyEvent` 直接斷言）
- Modify (Test): `bim-review-coordinator/tests/external-ifc-ready.test.ts`（補一個中文 model_version_id 的端到端 dispatch 案例）

### Steps

- [ ] 先在 `tests/streaming-conversion-client.test.ts` 的 `describe("toInternalIfcReadyEvent", ...)` 內 append 一個失敗測試，鎖住「payload 的 artifact_id 走 sanitize」：

```ts
  it("中文 external id → payload.ifc_artifact.artifact_id 走 sanitize 且通過 SAFE_ID_RE", () => {
    const payload = toInternalIfcReadyEvent(
      { ...EVENT, external_model_version_id: "271_pieple_管線" },
      { correlationId: "corr_cjk", externalModelVersionId: "271_pieple_管線" },
    );
    const artifact = payload.ifc_artifact as { artifact_id: string };
    expect(artifact.artifact_id).toMatch(/^ifc_[A-Za-z0-9_.-]+$/);
    expect(artifact.artifact_id).toContain("ifc_271_pieple_");
  });

  it("純英文 external id → payload.ifc_artifact.artifact_id 與舊版完全相同（回歸鎖）", () => {
    const payload = toInternalIfcReadyEvent(EVENT, {
      correlationId: "corr_identity",
      externalModelVersionId: EVENT.external_model_version_id,
    });
    const artifact = payload.ifc_artifact as { artifact_id: string };
    expect(artifact.artifact_id).toBe(`ifc_${EVENT.external_model_version_id}`);
  });
```

- [ ] 跑確認新案例失敗（中文案例會因目前 L112 直接串接而 artifact_id 含中文，`toMatch(/^ifc_[A-Za-z0-9_.-]+$/)` 失敗；純英文回歸案例此刻仍會綠）：

```bash
cd bim-review-coordinator && npx vitest run tests/streaming-conversion-client.test.ts
```

預期：「中文 external id → ...」案例紅，其餘綠。

- [ ] 在 `bim-review-coordinator/src/services/streamingConversionClient.ts` 改 `toInternalIfcReadyEvent` 內的 artifact_id 組法。把：

```ts
      artifact_id: `ifc_${binding.externalModelVersionId}`,
```

改為：

```ts
      artifact_id: `ifc_${sanitizeArtifactIdPart(binding.externalModelVersionId)}`,
```

- [ ] 跑確認通過：

```bash
cd bim-review-coordinator && npx vitest run tests/streaming-conversion-client.test.ts
```

預期：全綠（回歸鎖證明純英文 id 輸出不變、中文 id 通過 SAFE_ID_RE）。

- [ ] 加端到端 dispatch 整合測試。打開 `bim-review-coordinator/tests/external-ifc-ready.test.ts`，先讀檔尾既有測試結構（找一個已起 stub streaming server 並 POST `/api/external/ifc-ready` 的 `it(...)` 作模板，沿用其 `makeApp` / `activeStreamingServer = http.createServer(...)` / `request(active.app).post(...)` 寫法）。在檔內 append 一個新 `it`，要點：
  - 用 `http.createServer` 起一個 stub conversion server，handler 內解析 POST body 的 `ifc_artifact.artifact_id`，以 `const SAFE_ID_RE = /^[A-Za-z0-9_.-]+$/` 驗證；不過則回 `res.writeHead(400)` + `{ detail: "Invalid ifc_artifact_id" }`，通過則回 `200` + `{ conversion_job_id: "stream_conv_cjk", status: "queued", authority: "bim-streaming-server" }`。
  - `makeApp({ streamingConversionApiBase: <stub conversion url> })`（同檔既有覆寫 `streamingConversionApiBase` 的寫法）。
  - 起一個 stub IFC source server 回最小 IFC bytes（沿用同檔 `activeIfcSourceServer` 既有 helper / 寫法，讓 download 成功）。
  - POST `/api/external/ifc-ready`，payload 以 `CONTRACT.example` 為基礎，覆寫 `external_model_version_id: "271_pieple_管線"`、`source_ifc.ref` 指向 stub IFC source、`source_ifc.etag` 任意。簽章/webhook header 沿用同檔既有 helper（`WEBHOOK_SECRET`）。
  - 斷言：回應 202；poll `GET /api/external/ifc-ready/:jobId`（或 list）直到該 job `conversion_status` 不為 `dispatch_failed`（達 `dispatched`/`queued` 級），且 `dispatch_error` 為 null。

  範例骨架（**stub conversion server 區塊**為新增核心；其餘 makeApp / IFC source / POST / 簽章請逐項對齊同檔既有 helper，不要新發明）：

```ts
it("中文 external_model_version_id 的 dispatch 不再被 conversion 端 SAFE_ID_RE 擋成 400", async () => {
  const SAFE_ID_RE = /^[A-Za-z0-9_.-]+$/;
  activeStreamingServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      const artifactId = parsed?.ifc_artifact?.artifact_id ?? "";
      if (!SAFE_ID_RE.test(artifactId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: `Invalid ifc_artifact_id: ${artifactId}` }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ conversion_job_id: "stream_conv_cjk", status: "queued", authority: "bim-streaming-server" }));
    });
  });
  await new Promise<void>((r) => activeStreamingServer!.listen(0, "127.0.0.1", () => r()));
  const convPort = (activeStreamingServer!.address() as import("node:net").AddressInfo).port;

  // TODO-執行者：以下兩行用同檔既有 IFC source stub helper 與 makeApp 覆寫實作（對齊既有測試，勿新發明）：
  //   1. 起 activeIfcSourceServer（回最小 IFC bytes），取得 ifcRef。
  //   2. const appUnderTest = makeApp({ streamingConversionApiBase: `http://127.0.0.1:${convPort}` });
  // 然後 POST /api/external/ifc-ready，external_model_version_id = "271_pieple_管線"，source_ifc.ref = ifcRef。

  // 斷言（poll 至 terminal-or-dispatched）：
  // const detail = await pollIfcReadyJob(appUnderTest, jobId);
  // 斷言 dispatch 終態用 top-level `status`（summarizeIfcReadyJob 的 dispatch 生命週期欄位；沿用既有 waitForDispatchEnd(app, jobId, ["dispatched"]) helper 即 poll res.body.status），不要 assert conversion_status（dispatch 被 400 擋時未必寫入）。
  // expect(detail.dispatch_error).toBeNull();
});
```

  注意：上方 `TODO-執行者` 與骨架後半屬「對齊既有測試 helper」的填空，執行者必須先 Read 同檔既有 dispatch 測試把 IFC source stub、makeApp、簽章 header、poll 寫法逐項套回，使本案例完全可跑——不得留 TODO 進 commit。

- [ ] 跑整合測試確認通過：

```bash
cd bim-review-coordinator && npx vitest run tests/external-ifc-ready.test.ts
```

預期：新案例綠（中文 id dispatch 成功，job 非 dispatch_failed）。

- [ ] 跑 coordinator 全量 verify（build + 全測試）確認無回歸：

```bash
cd bim-review-coordinator && npm run verify
```

預期：build 成功、vitest 全綠。

- [ ] commit：

```bash
cd bim-review-coordinator && git add src/services/streamingConversionClient.ts tests/streaming-conversion-client.test.ts tests/external-ifc-ready.test.ts && git commit -m "fix(coordinator): dispatch artifact_id 走 sanitize，中文 model_version_id 不再 400 (#205)"
```

---

## Task 2: 前端型別補 `dispatch_error` 欄位

`IfcReadyListItem` 補 `dispatch_error` 欄位定義（後端 `summarizeIfcReadyJob` 已回此欄位，前端僅缺型別）。

**Files:**
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`（`IfcReadyListItem` interface）

### Steps

- [ ] 在 `web-viewer-sample/src/console/coordinatorClient.ts` 的 `IfcReadyListItem`（L98–111）內，於 `conversion_authority: string | null;` 之後加一行（後端 app.ts:1827 已回 `dispatch_error: job.dispatch_error ?? null`）：

```ts
  dispatch_error: string | null;
```

- [ ] 跑前端 build 確認型別無誤：

```bash
cd web-viewer-sample && npm run build
```

預期：build 成功（tsc 不報 `IfcReadyListItem` 相關型別錯）。

- [ ] commit：

```bash
cd web-viewer-sample && git add src/console/coordinatorClient.ts && git commit -m "feat(console): IfcReadyListItem 補 dispatch_error 欄位（對齊 coordinator summarize）"
```

---

## Task 3: `#/conv` ConversionSchedulingPage 顯示 `dispatch_error`（前端 vitest）

job 有 `dispatch_error` 時於該列附註顯示截斷後明細（完整字串走 `title`），用既有 `ec-warn-note` 樣式；無錯誤不渲染。

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`ConversionSchedulingPage` Ifc-ready jobs 表）
- Modify (Test): `web-viewer-sample/src/console/console.test.tsx`

### Steps

- [ ] 在 `web-viewer-sample/src/console/console.test.tsx` 找到既有 `ConversionSchedulingPage` 的 `renderToString` 測試（L369 附近），在其後新增一個 mount 測試（沿用 `IntakeSelectPage.test.tsx` 的 `createRoot` + `act` + `vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue(...)` 模式）。檔頭若尚未 import `act`/`createRoot`/`coordinatorClient`/`vi`/`type IfcReadyListItem`，比照 `IntakeSelectPage.test.tsx` L1–7 補上（`IfcReadyListItem` 型別必補，否則 `const items: IfcReadyListItem[]` 會 tsc 紅）。append：

```ts
describe("ConversionSchedulingPage：dispatch_error 明細可見（真實後端欄位，無 mock 假資料）", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let prevActEnv: unknown;
  const baseJob = {
    project_id: "271", download_status: "downloaded", conversion_authority: null,
    review_session_id: null, viewer_url: null, expected_stage_url: null,
    expected_mapping_url: null, created_at: "2026-06-11T00:00:00Z",
  };
  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  it("有 dispatch_error 的 job → 渲染錯誤明細節點；無 dispatch_error 的 job → 不渲染", async () => {
    const items: IfcReadyListItem[] = [
      { ...baseJob, ifc_ready_job_id: "ifcready_fail", external_model_version_id: "271_pieple_管線",
        status: "dispatch_failed", conversion_status: "dispatch_failed",
        dispatch_error: 'streaming conversion API 400: {"detail":"Invalid ifc_artifact_id: ifc_271_pieple_管線"}' },
      { ...baseJob, ifc_ready_job_id: "ifcready_ok", external_model_version_id: "ext_ok",
        status: "dispatched", conversion_status: "dispatched", dispatch_error: null },
    ];
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: items.length, items });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });

    const errNode = container.querySelector('[data-testid="conv-dispatch-error-ifcready_fail"]');
    expect(errNode).not.toBeNull();
    expect(errNode!.textContent).toContain("Invalid ifc_artifact_id");
    expect(errNode!.getAttribute("title")).toContain("streaming conversion API 400");
    // 無 dispatch_error 的 job 不得渲染錯誤節點
    expect(container.querySelector('[data-testid="conv-dispatch-error-ifcready_ok"]')).toBeNull();
  });
});
```

- [ ] 跑確認失敗（節點/testid 尚未實作）：

```bash
cd web-viewer-sample && npx vitest run src/console/console.test.tsx
```

預期：新測試紅（`conv-dispatch-error-ifcready_fail` 找不到），既有測試綠。

- [ ] 在 `web-viewer-sample/src/console/pages.tsx` 的 `ConversionSchedulingPage` Ifc-ready jobs 表（L304–307）改表頭與列渲染，加一欄「dispatch」並在有 `dispatch_error` 時渲染附註節點。把現有：

```tsx
          <table className="ec-table"><thead><tr><th>job</th><th>project</th><th>conversion</th><th>session</th><th>stage</th></tr></thead>
            <tbody>{jobs.slice(0, 20).map((j) => (
              <tr key={j.ifc_ready_job_id}><td>{j.ifc_ready_job_id}</td><td>{j.project_id}</td><td>{j.conversion_status ?? "—"}</td><td>{j.review_session_id ?? "—"}</td><td>{j.expected_stage_url ?? "—"}</td></tr>
            ))}</tbody></table>
```

改為：

```tsx
          <table className="ec-table"><thead><tr><th>job</th><th>project</th><th>conversion</th><th>dispatch</th><th>session</th><th>stage</th></tr></thead>
            <tbody>{jobs.slice(0, 20).map((j) => (
              <tr key={j.ifc_ready_job_id}>
                <td>{j.ifc_ready_job_id}</td>
                <td>{j.project_id}</td>
                <td>{j.conversion_status ?? "—"}</td>
                <td>
                  {j.dispatch_error ? (
                    <span
                      className="ec-warn-note"
                      data-testid={`conv-dispatch-error-${j.ifc_ready_job_id}`}
                      title={j.dispatch_error}
                    >
                      {j.dispatch_error.length > 80 ? `${j.dispatch_error.slice(0, 80)}…` : j.dispatch_error}
                    </span>
                  ) : "—"}
                </td>
                <td>{j.review_session_id ?? "—"}</td>
                <td>{j.expected_stage_url ?? "—"}</td>
              </tr>
            ))}</tbody></table>
```

- [ ] 跑確認通過：

```bash
cd web-viewer-sample && npx vitest run src/console/console.test.tsx
```

預期：全綠（有錯 job 渲染 `conv-dispatch-error-ifcready_fail` 含截斷文字 + 完整 `title`；無錯 job 不渲染）。

- [ ] commit：

```bash
cd web-viewer-sample && git add src/console/pages.tsx src/console/console.test.tsx && git commit -m "feat(console): #/conv Ifc-ready jobs 顯示 dispatch_error 明細 (#205)"
```

---

## Task 4: Browser E2E（Playwright）— 中文 id dispatch 不失敗 + dispatch_error 明細可見

驗 user-facing vertical slice：UI route `#/conv` → Refresh queue 按鈕 → 真 coordinator `GET /api/external/ifc-ready` → 真實 runtime ID（`ifcready_*`）→ 列表渲染狀態 + dispatch_error。先 POST 一筆中文 `external_model_version_id` 的 ifc-ready（成功路徑），再造一筆必失敗 job 驗 `dispatch_error` 明細可見。

**誠實標記前置決策（執行者開工前先定，二選一並記在 evidence summary）：**
- (A) 真 conversion API（:8010 / streaming）在隔離 stack 可起 → E2E 走真 backend，成功 job 進 `dispatched`/`queued` 級。
- (B) 真 conversion API 太重 → 起一個與 `SAFE_ID_RE` 同規則的 **stub conversion server**（Node `http`，spec §7 允許），coordinator `streamingConversionApiBase` 指向 stub。此時 evidence summary 與截圖標註頁須明標 `STUB CONVERSION API`（誠實鐵律），單元/整合層（Task 1）已用真規則鎖死。

**Files:**
- Create (Test): `web-viewer-sample/e2e/conversion-artifact-id-sanitize.spec.ts`
- Create (Evidence): `docs/evidence/conversion-artifact-id-sanitize/README.md`（記 run 方式、A/B 模式、截圖清單）

### Steps

- [ ] 建立 `web-viewer-sample/e2e/conversion-artifact-id-sanitize.spec.ts`。沿用 `real-ifc-storage-intake.spec.ts` 的 `COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004"` 慣例；POST ifc-ready 用 `request.newContext()` 對 coordinator 直打（webhook header 比照 `bim-review-coordinator/tests/external-ifc-ready.test.ts` 的 `authHeaders()`：帶靜態 `X-Webhook-Secret`（= `WEBHOOK_SECRET`，預設 "dev-webhook-secret"）+ `X-Correlation-Id` + `X-Idempotency-Key`，**非 HMAC**（該檔正常 intake 路徑無任何簽章運算）；執行者先 Read 該測試對齊 header 名）。內容：

```ts
import { test, expect, request as pwRequest } from "@playwright/test";

// conversion-artifact-id-sanitize（spec 2026-06-11）：user-facing vertical slice。
// #/conv → Refresh queue → 真 coordinator GET /api/external/ifc-ready → 真實 ifcready_* ID
// → 中文 external_model_version_id 不再 dispatch_failed；另造必失敗 job 驗 dispatch_error 明細可見。
// 截圖落 artifacts/e2e/conversion-artifact-id-sanitize-*；evidence summary 標 A(真 backend)/B(STUB)。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";
const VIEWER = process.env.E2E_VIEWER_BASE_URL || "http://127.0.0.1:5180";

test.describe("中文 model_version_id 派工修復 + dispatch_error 可見", () => {
  test.setTimeout(180_000);

  test("POST 中文 ifc-ready → #/conv 該 job 非 dispatch_failed；必失敗 job 顯 dispatch_error", async ({ page }) => {
    const api = await pwRequest.newContext();

    // 1) POST 一筆中文 external_model_version_id 的 ifc-ready（簽章 header 比照 external-ifc-ready.test.ts）。
    //    source_ifc.ref 走可控本機 HTTP 來源（比照既有 external-ifc-ready stub source fixture 模式）。
    // TODO-執行者：以 buildSignedIfcReadyPost(api, { external_model_version_id: "271_pieple_管線", ref }) 實作。
    //    回應應 202；記下回傳 ifc_ready_job_id。

    // 2) 開 #/conv，按 Refresh queue，等列表出現該 job。
    await page.goto(`${VIEWER}/ui#/conv`);
    await page.getByRole("button", { name: /Refresh queue|讀取中/ }).click();
    const table = page.locator("table.ec-table");
    await expect(table).toBeVisible({ timeout: 20_000 });

    // 3) 中文 id 的 job：conversion 欄不得停在 dispatch_failed（A 模式達 dispatched/queued；B 模式同）。
    //    用該 job 列定位（job id cell）。
    // await expect(rowOf(page, cjkJobId).locator("td").nth(2)).not.toHaveText("dispatch_failed");

    // 4) 另造一筆必失敗 job（例如 streamingConversionApiBase 不可達 / stub 回 400）→ dispatch_error 節點可見。
    //    斷言該列 [data-testid="conv-dispatch-error-<jobId>"] 可見且 title 含完整錯誤字串。
    // await expect(page.getByTestId(`conv-dispatch-error-${failJobId}`)).toBeVisible();

    await page.screenshot({ path: "../artifacts/e2e/conversion-artifact-id-sanitize-conv.png", fullPage: true });
  });
});
```

  注意：上方 `TODO-執行者` 為「對齊既有簽章/stub helper」的填空——執行者必須先 Read `bim-review-coordinator/tests/external-ifc-ready.test.ts`（`authHeaders()` 的靜態 `X-Webhook-Secret` header，非 HMAC）與既有 e2e source stub 模式，把 `buildSignedIfcReadyPost`、`rowOf`、`failJobId` 逐項實作可跑，不得留 TODO 進 commit。若採 B 模式（STUB CONVERSION），起 stub 的方式記在 evidence README，且 spec 頁截圖須標 `STUB CONVERSION API`。

- [ ] 啟動 coordinator（:8004）後跑 E2E（playwright 只 auto-start viewer :5180，coordinator 需另起；起法見 `docs/agents/sub-repo-verify-commands.md` 或 `bim-review-coordinator` `npm run dev`）：

```bash
cd web-viewer-sample && npm run test:e2e -- conversion-artifact-id-sanitize.spec.ts
```

預期：測試綠；`artifacts/e2e/conversion-artifact-id-sanitize-conv.png` 產出，截圖中 `#/conv` 列表含中文 id job（非 dispatch_failed）與必失敗 job 的 dispatch_error 明細。

- [ ] 建立 evidence README `docs/evidence/conversion-artifact-id-sanitize/README.md`，內容含：run 指令、採用 A 或 B 模式（B 模式明標 STUB CONVERSION API）、截圖檔名清單與「觀察到的真實狀態」描述（誠實鐵律：未觀察到的不寫成功）。把 E2E 截圖複製一份進此 tracked 目錄（如 `conv-list.png`）。

- [ ] 跑前端全量 verify 確認無回歸：

```bash
cd web-viewer-sample && npm run verify
```

預期：build + vitest + struct-log 全綠。

- [ ] commit：

```bash
cd web-viewer-sample && git add e2e/conversion-artifact-id-sanitize.spec.ts && git -C .. add docs/evidence/conversion-artifact-id-sanitize && git -C .. commit -m "test(e2e): 中文 model_version_id 派工 + dispatch_error 可見 browser E2E + evidence (#205)"
```

  （注意：`docs/evidence/` 在 repo 根，非 web-viewer-sample 子目錄；spec.ts 在子 repo，evidence 在根，分兩個 add 路徑。）

---

## 收尾驗證（四項回報，對齊 CLAUDE.md §1）

- [ ] 列出改了哪些 tracked files：`streamingConversionClient.ts`、`streaming-conversion-client.test.ts`、`external-ifc-ready.test.ts`、`coordinatorClient.ts`、`pages.tsx`、`console.test.tsx`、`e2e/conversion-artifact-id-sanitize.spec.ts`、`docs/evidence/conversion-artifact-id-sanitize/`。
- [ ] 執行的最小驗證：coordinator `npm run verify`、web-viewer-sample `npm run verify`、browser E2E `npm run test:e2e -- conversion-artifact-id-sanitize.spec.ts`（截圖證據）。
- [ ] 哪些沒跑與原因：若 E2E 採 B（stub conversion）模式，註明真 conversion API（:8010）未在本輪起；重派/重試端點（dispatch_failed re-dispatch）不在本輪（spec §3 非目標，留 #205 follow-up）。
- [ ] 已知風險：雙底線殘留（`271_pieple__<hash8>`）為規則簡單性取捨不影響功能；sanitize 對純 safe id 零變化故無對帳遷移；dispatch_failed job 為 in-memory，重啟即清。

PR body 註 `Fixes #205`（sanitize 部分）；重派功能於 issue 留註記或拆 follow-up（spec §6.4）。
