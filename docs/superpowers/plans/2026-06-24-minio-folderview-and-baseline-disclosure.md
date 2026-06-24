# MinIO `#minio` Folder View & `#conv` Baseline Disclosure Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 把 `#minio` 從「527 物件遞迴攤平」修正成真 MinIO 逐層資料夾導覽（S3 `Delimiter='/'`），`.ifc` 旁顯示 ledger 狀態 chip ＋ 一鍵觸發轉檔鈕；把 `#conv` 的 baseline/triggered 揭露清楚；watcher tick dedup 由 in-memory baseline 改為持久 ledger 去重（既有未轉檔自動補轉、重啟不風暴）。

**Architecture:** 後端 `bim-review-coordinator`（Express :8004）對 `/api/minio/objects` additive 加 `delimiter` 參數與 `listMinioFolder`（保留 `listMinioObjects` 舊簽名零改），新增 additive `POST /api/conversion/trigger`（server-side presigned + 獨立 `triggerManualIntake` 寫 ledger，`x-dev-token` 守門），並把 `startMinioWatcher` tick 的去重來源從 in-memory `seen` baseline 改注入持久 ledger watermark。前端 `web-viewer-sample`（React console，hash route `#/minio`、`#/conv`）改 `MinioDataPage` 為逐層 prefix 導覽、加狀態 chip 與觸發鈕，`ConversionSchedulingPage` 補 baseline 揭露文案。三方文件（prototype HTML / openspec / closed-loop design）同 PR 同步。

**Tech Stack:** TypeScript（Node 20 / Express / `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`，皆已裝），Vitest（後端 supertest + 前端 createRoot/act），React 18，Playwright（E2E）。零新 production dependency。

---

## 執行前置（所有 task 共用，務必先做）

本 plan 假設執行者對 codebase 零脈絡。動手前先確立 baseline 與導航事實：

```bash
# baseline：後端目前測試全綠（先量再改）
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/bim-review-coordinator
npm test 2>&1 | tail -20
# 預期：所有 test 檔 pass（含 minio-watcher-loop.test.ts、minio-objects-route.test.ts、conversion-records-route.test.ts）

# baseline：前端目前測試全綠
cd ../web-viewer-sample
npm test 2>&1 | tail -20
# 預期：MinioDataPage.test.tsx 8 it 全 pass、console.test.tsx 全 pass、ConversionSchedulingPage.test.tsx 全 pass
```

GitNexus 導航（改 symbol 前必跑；Task 5 的 `startMinioWatcher` 為 HIGH 風險核心）：

```txt
mcp__gitnexus__context({ name: "startMinioWatcher" })   # 看 tick / triggerIntake 的 callers 與 blast radius
mcp__gitnexus__impact({ target: "startMinioWatcher", direction: "upstream" })  # Task 5 動手前必跑、回報 risk
mcp__gitnexus__context({ name: "listMinioObjects" })    # 確認 additive listMinioFolder 不波及既有呼叫點
```

已驗證的關鍵事實（寫 plan 時逐一 Read 確認，執行者可直接信賴）：

- `listMinioObjects`（`bim-review-coordinator/src/services/minioClient.ts:28-65`）：`ListObjectsV2Command` 無 `Delimiter`、`while(token)` 全拉；role 由副檔名（`:43-47`）；`MinioObjectView`（`:18-26`）無 `url` 欄。
- `idempotencyKeyFor(bucket,key,etag)`（`minioWatcher.ts:29-32`）已 export、確定性回 `mw_<hash16>`；`deriveIntakeFromKey`（`:71-113`）已 export、≥3 段且拒空段/`.`/`..`；`triggerIntake` 是 `startMinioWatcher` 內**私有 closure**（`:290`，不可 import）。
- watcher 目前**沒有** ConversionLedger 參考：tick（`:377-410`）自打 loopback `POST /api/external/ifc-ready`（`:331`），ledger 由 intake handler `app.ts:1153` upsert。故 §3.4 需把 ledger 查詢**注入** `startMinioWatcher`。
- `ConversionLedger.get(idkey)`（`conversionLedger.ts:164-166`）回 record 或 null；持久於 `config.conversionLedgerStorePath`（`config.ts:392`，atomic swap `:81-92`）。
- auth：`isKitMutationAuthorized(request, config.devAuthToken)`（`app.ts:2580-2583`）檢 `x-dev-token`/`x-operator-token` === `config.devAuthToken`（`config.ts:367`，default `dev-token`）。kit mutation route（`app.ts:2039-2052`）為既有用法樣板。
- `/api/minio/objects` route：`app.ts:1206-1240`，已讀 `request.query.prefix`、回 `{ bucket, prefix, count, objects }`、未設定回 `count:0 + note`、失敗 502。
- frontend client：`coordinatorClient.getMinioObjects(prefix?)`（`coordinatorClient.ts:299-302`）、`getConversionRecords`（`:295-296`）；`MinioObject`（`:246-254`）、`ConversionRecord`（`:230-242`）；jsonPost/jsonPut headers 在 `:35-83`（目前無 `x-dev-token`）。
- frontend pages：`buildMinioTree`（`pages.tsx:1157-1171`）、`MinioDataPage`（`:1185-1297`，頁首誠實字樣 `:1214-1216`、empty 態 `:1232-1235`、三層樹 `:1237-1273`、DEMO 規約面板 `:1276-1287`）；`ConversionSchedulingPage`（`:704`）、watcher 面板 baseline/seen/triggered 擠一 Field（`:866`）、ledger 面板（`:893-942`，`conv-ledger-panel`）、`LEDGER_STATUS_LABEL`（`:697-698`）。
- 測試樣板：S3 stub 單元測試 `minio-objects-route.test.ts`；supertest route 測試 `conversion-records-route.test.ts`（`makeApp` 注入 `conversionLedgerStorePath`）；watcher loop 測試 `minio-watcher-loop.test.ts`（`makeWatcher` helper、`startIntakeStub`）；前端 `MinioDataPage.test.tsx`（createRoot+act+`vi.spyOn`）；E2E `e2e/minio-closed-loop.spec.ts`（spawn coordinator + S3/conv stub）。
- **web-viewer `npm run build` = `vite build`，不跑 tsc**（`package.json:15`）；型別檢查須另跑 `npx tsc --noEmit`。

每個 task 結尾的 commit 須以 GitNexus `detect_changes` 驗 scope（Task 5 為 `detect_changes({scope:"compare", base_ref:"main"})`），commit message 用繁中、結尾附本 plan footer。

---

## Task 1: 後端 `listMinioFolder`（S3 Delimiter 逐層 list，additive）

對應 spec §2.1、§2.3、AC-D2。在 `minioClient.ts` 新增資料夾語意 list 函式，回 `folders[]`（CommonPrefixes）＋當層直屬 `objects`，並對每個 `.ifc` 物件附 `idempotency_key`（給前端 chip lookup，spec §3.3 路徑 A）。`listMinioObjects` 簽名與回應**完全不動**。

**Files:**
- Modify: `bim-review-coordinator/src/services/minioClient.ts`（加 `listMinioFolder` + `MinioObjectView` 加 `idempotency_key` 欄）
- Test: `bim-review-coordinator/tests/minio-folder-route.test.ts`（Create）

**Steps:**

- [ ] 寫失敗測試（folder list 基本行為）：新建 `bim-review-coordinator/tests/minio-folder-route.test.ts`，照 `minio-objects-route.test.ts` 的 S3 stub 模式，但 stub 須回 `CommonPrefixes`。內容：

```ts
// bim-review-coordinator/tests/minio-folder-route.test.ts
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { listMinioFolder, createMinioS3Client } from "../src/services/minioClient.js";

let stub: http.Server | null = null; let stubUrl = "";
// S3 ListObjectsV2 with Delimiter='/'：回 CommonPrefixes（資料夾）+ Contents（當層直屬檔）。
// 支援分頁：第一頁 IsTruncated=true + NextContinuationToken，第二頁 false。
function startS3Stub(pages: Array<{ prefixes: string[]; keys: string[]; next?: string }>): Promise<void> {
  let call = 0;
  stub = http.createServer((_req, res) => {
    const page = pages[Math.min(call, pages.length - 1)]; call += 1;
    const cps = page.prefixes.map((p) => `<CommonPrefixes><Prefix>${p}</Prefix></CommonPrefixes>`).join("");
    const contents = page.keys.map((k) => `<Contents><Key>${k}</Key><ETag>"e1"</ETag></Contents>`).join("");
    const trunc = page.next ? `<IsTruncated>true</IsTruncated><NextContinuationToken>${page.next}</NextContinuationToken>` : "<IsTruncated>false</IsTruncated>";
    res.writeHead(200, { "content-type": "application/xml" });
    res.end(`<?xml version="1.0"?><ListBucketResult>${trunc}${cps}${contents}</ListBucketResult>`);
  });
  return new Promise((r) => stub!.listen(0, "127.0.0.1", () => {
    stubUrl = `http://127.0.0.1:${(stub!.address() as { port: number }).port}`; r();
  }));
}
afterEach(() => new Promise<void>((r) => stub ? stub.close(() => { stub = null; r(); }) : r()));

describe("listMinioFolder", () => {
  it("回 folders=CommonPrefixes、objects=當層直屬檔，folders 不含被 roll-up 的子物件", async () => {
    await startS3Stub([{ prefixes: ["洲際好宅/", "東勢區許良宇紀念圖書館/"], keys: ["annotations/a.json"] }]);
    const client = createMinioS3Client({ endpoint: stubUrl, accessKey: "x", secretKey: "y" });
    const res = await listMinioFolder(client, "bim-control", "", "/");
    expect(res.folders).toEqual(["洲際好宅/", "東勢區許良宇紀念圖書館/"]);
    expect(res.objects).toHaveLength(1);
    expect(res.objects[0].key).toBe("annotations/a.json");
    expect(res.objects[0].role).toBe("other");
  });

  it("超 1000 子前綴/物件不截斷：IsTruncated=true → 帶 continuation 取次頁，兩頁 folders 合併", async () => {
    await startS3Stub([
      { prefixes: ["A/"], keys: [], next: "tok2" },
      { prefixes: ["B/"], keys: [] },
    ]);
    const client = createMinioS3Client({ endpoint: stubUrl, accessKey: "x", secretKey: "y" });
    const res = await listMinioFolder(client, "bim-control", "", "/");
    expect(res.folders).toEqual(["A/", "B/"]);
  });

  it(".ifc 物件附 idempotency_key（給前端 chip lookup）＋ 葉層三段 badge", async () => {
    await startS3Stub([{ prefixes: [], keys: ["東勢區許良宇紀念圖書館/root/main/000001/model.ifc"] }]);
    const client = createMinioS3Client({ endpoint: stubUrl, accessKey: "x", secretKey: "y" });
    const res = await listMinioFolder(client, "bim-control", "東勢區許良宇紀念圖書館/root/main/000001/", "/");
    const ifc = res.objects.find((o) => o.key.endsWith(".ifc"));
    expect(ifc?.role).toBe("source_ifc");
    expect(ifc?.idempotency_key).toMatch(/^mw_[0-9a-f]{16}$/);
    expect(ifc?.category).toBe("main");
    expect(ifc?.version).toBe("000001");
  });
});
```

- [ ] 跑測試確認失敗（`listMinioFolder` 尚不存在 → import error）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/bim-review-coordinator
npx vitest run tests/minio-folder-route.test.ts 2>&1 | tail -20
# 預期：FAIL，"listMinioFolder" is not exported by "src/services/minioClient.ts" 或 TypeError
```

- [ ] 最小實作：在 `bim-review-coordinator/src/services/minioClient.ts` 的 `MinioObjectView`（`:18-26`）interface 末尾加 `idempotency_key: string;` 欄，並把現有 `listMinioObjects` 內 `out.push({...})` 補上 `idempotency_key: idempotencyKeyFor(bucket, key, obj.ETag ?? "")`。更新 import 行 `:5` 為 `import { deriveIntakeFromKey, idempotencyKeyFor } from "./minioWatcher.js";`。`ListObjectsV2Command` 的 import 行 `:4` 已含。然後在檔末新增：

```ts
export interface MinioFolderListing {
  bucket: string;
  prefix: string;
  folders: string[];          // CommonPrefixes（資料夾節點）
  objects: MinioObjectView[]; // 當層直屬檔（被 roll-up 的子物件不在此）
  count: number;              // objects.length（誠實：非遞迴總數）
}

/**
 * 資料夾語意 list（spec §2.1）：帶 Delimiter='/' → CommonPrefixes 為資料夾、Contents 為當層直屬檔。
 * 單層仍處理 IsTruncated（while-loop 全拉，超 1000 子前綴/物件不截斷，AC-D2）。
 * 對每個 .ifc 物件附 idempotency_key 供前端 chip 對 ledger lookup（spec §3.3 路徑 A）。
 * 永不回 presigned URL（MinioObjectView 無 url 欄）。
 */
export async function listMinioFolder(
  client: S3Client,
  bucket: string,
  prefix: string,
  delimiter: string,
): Promise<MinioFolderListing> {
  const folders: string[] = [];
  const objects: MinioObjectView[] = [];
  let token: string | undefined;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        Delimiter: delimiter || undefined,
        ContinuationToken: token,
      }),
    );
    for (const cp of resp.CommonPrefixes ?? []) {
      if (cp.Prefix) folders.push(cp.Prefix);
    }
    for (const obj of resp.Contents ?? []) {
      if (!obj.Key) continue;
      const key = obj.Key;
      const role: MinioObjectRole = key.endsWith(".ifc")
        ? "source_ifc"
        : key.endsWith(".usdc")
          ? "parsed_usdc"
          : "other";
      const probeSuffix = key.endsWith(".usdc") ? "/model.usdc" : "/model.ifc";
      const d = deriveIntakeFromKey({ key, prefix, keySuffix: probeSuffix });
      objects.push({
        key,
        etag: (obj.ETag ?? "").replace(/^"+|"+$/g, ""),
        role,
        idempotency_key: idempotencyKeyFor(bucket, key, obj.ETag ?? ""),
        project_id: d.ok ? d.projectId : null,
        project_display_name: d.ok ? d.projectDisplayName : null,
        category: d.ok ? d.category : null,
        version: d.ok ? d.externalModelVersionId : null,
      });
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return { bucket, prefix, folders, objects, count: objects.length };
}
```

- [ ] 跑測試確認通過 ＋ 既有 minio-objects 測試零退化：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/bim-review-coordinator
npx vitest run tests/minio-folder-route.test.ts tests/minio-objects-route.test.ts 2>&1 | tail -20
# 預期：兩檔全 PASS（listMinioObjects 舊測試因只多 idempotency_key 欄、未斷言該欄，零退化）
```

- [ ] commit：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
git add bim-review-coordinator/src/services/minioClient.ts bim-review-coordinator/tests/minio-folder-route.test.ts
git commit -m "$(cat <<'EOF'
plan: 後端 listMinioFolder（S3 Delimiter 逐層 list，additive）

MinioObjectView 加 idempotency_key；listMinioObjects 簽名零改。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `/api/minio/objects` route 加 `delimiter` 參數（additive，回 folders[]）

對應 spec §2.1、§4.1、AC-D2。route 在收到 `?delimiter=/` 時改走 `listMinioFolder` 回 `{ bucket, prefix, folders, objects, count }`；不帶 `delimiter` 時走舊 `listMinioObjects` 維持 byte-identical 回應（既有測試零改）。

**Files:**
- Modify: `bim-review-coordinator/src/app.ts`（`/api/minio/objects` handler，`:1206-1240`）
- Test: `bim-review-coordinator/tests/minio-objects-delimiter-route.test.ts`（Create）

**Steps:**

- [ ] 寫失敗測試（supertest，照 `conversion-records-route.test.ts` 的 `makeApp` 模式 + S3 stub）。新建 `bim-review-coordinator/tests/minio-objects-delimiter-route.test.ts`：

```ts
// bim-review-coordinator/tests/minio-objects-delimiter-route.test.ts
import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import http from "node:http";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null; let root: string | null = null;
let s3Stub: http.Server | null = null; let s3Url = "";
function startS3Stub(): Promise<void> {
  s3Stub = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/xml" });
    res.end(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated><CommonPrefixes><Prefix>洲際好宅/</Prefix></CommonPrefixes><Contents><Key>annotations/a.json</Key><ETag>"e"</ETag></Contents></ListBucketResult>`);
  });
  return new Promise((r) => s3Stub!.listen(0, "127.0.0.1", () => {
    s3Url = `http://127.0.0.1:${(s3Stub!.address() as { port: number }).port}`; r();
  }));
}
function makeApp() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "minio-delim-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
    corsOrigins: ["http://127.0.0.1:5173"], conversionPollEnabled: false,
    minioWatchEndpoint: s3Url, minioWatchBucket: "bim-control",
    minioWatchAccessKey: "ak", minioWatchSecretKey: "sk",
  });
  return active;
}
afterEach(async () => {
  if (active) { await active.dispose(); active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r())); active = null; }
  if (root) { fs.rmSync(root, { recursive: true, force: true }); root = null; }
  if (s3Stub) await new Promise<void>((r) => s3Stub!.close(() => { s3Stub = null; r(); }));
});

describe("GET /api/minio/objects?delimiter=/", () => {
  it("帶 delimiter → 回 folders[]（CommonPrefixes）+ 當層 objects，不含 url", async () => {
    await startS3Stub();
    const res = await request(makeApp().app).get("/api/minio/objects?delimiter=/");
    expect(res.status).toBe(200);
    expect(res.body.folders).toEqual(["洲際好宅/"]);
    expect(res.body.objects).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain("X-Amz-Signature");
  });

  it("未設定 MinIO → 帶 delimiter 仍誠實回 count=0 + note（不 500）", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "minio-delim-unset-"));
    active = createCoordinatorApp({
      sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
      corsOrigins: ["http://127.0.0.1:5173"], conversionPollEnabled: false,
    });
    const res = await request(active.app).get("/api/minio/objects?delimiter=/");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.note).toBeTruthy();
  });
});
```

- [ ] 跑測試確認失敗（route 尚未讀 delimiter、`folders` 為 undefined）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/bim-review-coordinator
npx vitest run tests/minio-objects-delimiter-route.test.ts 2>&1 | tail -15
# 預期：FAIL（res.body.folders 為 undefined，第一個 it 的 toEqual 失敗）
```

- [ ] 最小實作：在 `bim-review-coordinator/src/app.ts` 把 `listMinioFolder` 加入既有 minioClient import（檔頭找 `from "./services/minioClient.js"` 的 import 行，補上 `listMinioFolder`）。然後在 `/api/minio/objects` handler（`:1217-1232` 區段）改為讀 `delimiter` 並分流（`rawPrefix` 行之後插入）：

```ts
    const rawPrefix =
      typeof request.query.prefix === "string" ? request.query.prefix : config.minioWatchPrefix;
    const rawDelimiter =
      typeof request.query.delimiter === "string" ? request.query.delimiter : "";
    let client: ReturnType<typeof createMinioS3Client> | null = null;
    try {
      client = createMinioS3Client({
        endpoint: config.minioWatchEndpoint,
        accessKey: config.minioWatchAccessKey,
        secretKey: config.minioWatchSecretKey,
      });
      if (rawDelimiter) {
        // 資料夾語意逐層導覽（spec §2.1）：回 folders[]（CommonPrefixes）+ 當層直屬 objects。
        const folder = await listMinioFolder(client, config.minioWatchBucket, rawPrefix, rawDelimiter);
        response.json(folder);
        return;
      }
      const objects = await listMinioObjects(
        client,
        config.minioWatchBucket,
        rawPrefix,
        config.minioWatchKeySuffix,
      );
      response.json({ bucket: config.minioWatchBucket, prefix: rawPrefix, count: objects.length, objects });
    } catch (err) {
      response
        .status(502)
        .json({ error: "minio_list_failed", detail: err instanceof Error ? err.message : String(err) });
    } finally {
      client?.destroy();
    }
```

注意：未設定 MinIO 的 early-return（`:1207-1216`）已在 handler 開頭，帶不帶 delimiter 都回 `count:0 + note`，第二個 it 自然通過、不需改該段。

- [ ] 跑測試確認通過 ＋ 既有 route 測試零退化：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/bim-review-coordinator
npx vitest run tests/minio-objects-delimiter-route.test.ts tests/minio-objects-route.test.ts tests/conversion-records-route.test.ts 2>&1 | tail -15
# 預期：全 PASS（舊 /api/minio/objects 無 delimiter 路徑回應不變）
```

- [ ] commit：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
git add bim-review-coordinator/src/app.ts bim-review-coordinator/tests/minio-objects-delimiter-route.test.ts
git commit -m "$(cat <<'EOF'
plan: /api/minio/objects 加 delimiter 參數（additive 回 folders[]）

不帶 delimiter 維持舊回應 byte-identical；既有測試零改。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 後端 `triggerManualIntake` + `POST /api/conversion/trigger`（一鍵觸發，x-dev-token 守門）

對應 spec §3.3、§4.1、AC-trigger、AC6。新增獨立函式 `triggerManualIntake`（重用 `deriveIntakeFromKey`/`idempotencyKeyFor`/`createMinioS3Client`/`getSignedUrl`，**非 import** `triggerIntake` 私有 closure）＋ additive route，server-side 生 presigned、寫 ledger、回 `{status, idempotency_key}`；`x-dev-token` 守門（拒無 auth 401/403）。

**Files:**
- Create: `bim-review-coordinator/src/services/manualIntake.ts`
- Modify: `bim-review-coordinator/src/app.ts`（新增 `POST /api/conversion/trigger` route，插在 `/api/conversion/records`（`:1201`）之後、`/api/minio/objects` 之前）
- Test: `bim-review-coordinator/tests/conversion-trigger-route.test.ts`（Create）

**Steps:**

- [ ] 寫失敗測試（supertest，含 auth 拒絕 / key 防穿越 / presigned 不外洩 / 回 idempotency_key / 寫 ledger）。新建 `bim-review-coordinator/tests/conversion-trigger-route.test.ts`：

```ts
// bim-review-coordinator/tests/conversion-trigger-route.test.ts
import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import http from "node:http";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null; let root: string | null = null;
let s3Stub: http.Server | null = null; let s3Url = "";
let intakeReceived: Array<{ headers: http.IncomingHttpHeaders; body: Record<string, unknown> }> = [];
// S3 stub：ListObjectsV2 回含 model.ifc；presign GET 不真打（presigner 只簽 URL）。
function startS3Stub(keys: string[]): Promise<void> {
  s3Stub = http.createServer((_req, res) => {
    const contents = keys.map((k) => `<Contents><Key>${k}</Key><ETag>"e1"</ETag></Contents>`).join("");
    res.writeHead(200, { "content-type": "application/xml" });
    res.end(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`);
  });
  return new Promise((r) => s3Stub!.listen(0, "127.0.0.1", () => {
    s3Url = `http://127.0.0.1:${(s3Stub!.address() as { port: number }).port}`; r();
  }));
}
function makeApp() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "conv-trigger-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
    corsOrigins: ["http://127.0.0.1:5173"], conversionPollEnabled: false,
    devAuthToken: "test-dev-token",
    minioWatchEndpoint: s3Url, minioWatchBucket: "bim-control",
    minioWatchAccessKey: "ak", minioWatchSecretKey: "sk",
  });
  return active;
}
afterEach(async () => {
  if (active) { await active.dispose(); active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r())); active = null; }
  if (root) { fs.rmSync(root, { recursive: true, force: true }); root = null; }
  if (s3Stub) await new Promise<void>((r) => s3Stub!.close(() => { s3Stub = null; r(); }));
  intakeReceived = [];
});

describe("POST /api/conversion/trigger", () => {
  it("無 x-dev-token → 401/403（拒匿名寫入）", async () => {
    await startS3Stub(["東勢區許良宇紀念圖書館/root/main/000001/model.ifc"]);
    const res = await request(makeApp().app).post("/api/conversion/trigger")
      .send({ key: "東勢區許良宇紀念圖書館/root/main/000001/model.ifc" });
    expect([401, 403]).toContain(res.status);
  });

  it("key 含 .. → 400（防路徑穿越，deriveIntakeFromKey 拒）", async () => {
    await startS3Stub(["a/b/c/model.ifc"]);
    const res = await request(makeApp().app).post("/api/conversion/trigger")
      .set("x-dev-token", "test-dev-token")
      .send({ key: "../../etc/model.ifc" });
    expect(res.status).toBe(400);
  });

  it("合法 key + 有 token → 回 { status, idempotency_key }，不外洩 presigned URL", async () => {
    await startS3Stub(["東勢區許良宇紀念圖書館/root/main/000001/model.ifc"]);
    const res = await request(makeApp().app).post("/api/conversion/trigger")
      .set("x-dev-token", "test-dev-token")
      .send({ key: "東勢區許良宇紀念圖書館/root/main/000001/model.ifc" });
    expect(res.status).toBe(200);
    expect(res.body.idempotency_key).toMatch(/^mw_[0-9a-f]{16}$/);
    expect(res.body.status).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain("X-Amz-Signature");
  });

  it("觸發後 ledger 有對應紀錄（GET /api/conversion/records 可見同 idempotency_key）", async () => {
    await startS3Stub(["東勢區許良宇紀念圖書館/root/main/000001/model.ifc"]);
    const app = makeApp().app;
    const trig = await request(app).post("/api/conversion/trigger")
      .set("x-dev-token", "test-dev-token")
      .send({ key: "東勢區許良宇紀念圖書館/root/main/000001/model.ifc" });
    const recs = await request(app).get("/api/conversion/records");
    expect(recs.body.items.some((r: { idempotency_key: string }) => r.idempotency_key === trig.body.idempotency_key)).toBe(true);
  });
});
```

- [ ] 跑測試確認失敗（route 404）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/bim-review-coordinator
npx vitest run tests/conversion-trigger-route.test.ts 2>&1 | tail -15
# 預期：FAIL（POST /api/conversion/trigger → 404，所有 it 失敗）
```

- [ ] 最小實作（服務函式）：新建 `bim-review-coordinator/src/services/manualIntake.ts`。直呼 `conversionLedger.upsert` 寫帳（spec §3.3「直呼 conversionLedger.upsert」的等效路徑，避免再走 loopback intake / IP allowlist），presigned URL 只用於回給 converter（Phase 1 ledger object_key 可 null，不外洩 URL）：

```ts
// bim-review-coordinator/src/services/manualIntake.ts
// 一鍵手動觸發（spec §3.3）：重用 watcher 的 exported 純零件，但不 import triggerIntake
//（它是 startMinioWatcher 內私有 closure）。server-side 生 presigned、寫持久 ledger。
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createMinioS3Client } from "./minioClient.js";
import { deriveIntakeFromKey, idempotencyKeyFor } from "./minioWatcher.js";
import type { ConversionLedger } from "./conversionLedger.js";

export interface ManualIntakeConfig {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  keySuffix: string; // 規約：/model.ifc
}

export type ManualIntakeResult =
  | { ok: true; idempotency_key: string; status: string }
  | { ok: false; reason: string };

/**
 * 對 bucket 下 */model.ifc 觸發轉檔意圖：驗 key 規約（≥3 段、拒空段/. / ..）→ 算 idempotency_key
 * → server-side 生 presigned GET（不外洩給呼叫端）→ upsert 持久 ledger（status=detected）。
 * 冪等：同 key 同 etag → 同 idempotency_key → upsert 命中既有不重建。
 */
export async function triggerManualIntake(
  key: string,
  etag: string,
  cfg: ManualIntakeConfig,
  ledger: ConversionLedger,
  now: string,
): Promise<ManualIntakeResult> {
  const derived = deriveIntakeFromKey({ key, prefix: "", keySuffix: cfg.keySuffix });
  if (!derived.ok) return { ok: false, reason: derived.reason };
  const client = createMinioS3Client({ endpoint: cfg.endpoint, accessKey: cfg.accessKey, secretKey: cfg.secretKey });
  try {
    // presigned 僅供 converter 取檔；本函式不回傳此 URL（誠實鐵律：不外洩簽章）。
    await getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), { expiresIn: 3600 });
  } catch (err) {
    return { ok: false, reason: `presign failed: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    client.destroy();
  }
  const idkey = idempotencyKeyFor(cfg.bucket, key, etag);
  const rec = ledger.upsert(
    {
      idempotency_key: idkey,
      correlation_id: null,
      project_id: derived.projectId,
      project_display_name: derived.projectDisplayName,
      category: derived.category,
      external_model_version_id: derived.externalModelVersionId,
      conversion_job_id: null,
      status: "detected",
      object_key: key,
      bucket: cfg.bucket,
    },
    now,
  );
  return { ok: true, idempotency_key: rec.idempotency_key, status: rec.status };
}
```

- [ ] 最小實作（route）：在 `bim-review-coordinator/src/app.ts` 檔頭加 `import { triggerManualIntake } from "./services/manualIntake.js";`，並在 `/api/conversion/records`（`:1197-1201`）之後插入新 route。先以 S3 list 取該 key 的 etag（重用既有 `createMinioS3Client` + `listMinioObjects`，找出該 key 的 etag）：

```ts
  // minio-folderview：一鍵手動觸發轉檔（spec §3.3）。寫入動作 → x-dev-token 守門（拒匿名）。
  // server-side 生 presigned（不外洩）+ 寫持久 ledger；回 { status, idempotency_key }。
  app.post("/api/conversion/trigger", async (request, response) => {
    if (!isKitMutationAuthorized(request, config.devAuthToken)) {
      response.status(403).json({ detail: "conversion trigger requires operator/dev auth (x-dev-token)" });
      return;
    }
    if (!config.minioWatchEndpoint || !config.minioWatchBucket) {
      response.status(422).json({ detail: "MinIO not configured" });
      return;
    }
    const key = (request.body as { key?: unknown })?.key;
    if (typeof key !== "string" || !key) {
      response.status(400).json({ detail: "Body must include string 'key'." });
      return;
    }
    // 先驗 key 規約（≥3 段、拒空段/. / ..），不合法不去打 S3。
    const derived = deriveIntakeFromKey({ key, prefix: "", keySuffix: config.minioWatchKeySuffix });
    if (!derived.ok) {
      response.status(400).json({ detail: `invalid key: ${derived.reason}` });
      return;
    }
    let client: ReturnType<typeof createMinioS3Client> | null = null;
    try {
      client = createMinioS3Client({
        endpoint: config.minioWatchEndpoint,
        accessKey: config.minioWatchAccessKey,
        secretKey: config.minioWatchSecretKey,
      });
      // 取該 key 的 etag（idempotency_key 需 etag；list 當層找該 key）。
      const objs = await listMinioObjects(client, config.minioWatchBucket, "", config.minioWatchKeySuffix);
      const match = objs.find((o) => o.key === key);
      if (!match) {
        response.status(404).json({ detail: "object not found in bucket" });
        return;
      }
      const result = await triggerManualIntake(
        key,
        match.etag,
        {
          endpoint: config.minioWatchEndpoint,
          bucket: config.minioWatchBucket,
          accessKey: config.minioWatchAccessKey,
          secretKey: config.minioWatchSecretKey,
          keySuffix: config.minioWatchKeySuffix,
        },
        conversionLedger,
        new Date().toISOString(),
      );
      if (!result.ok) {
        response.status(502).json({ detail: result.reason });
        return;
      }
      structLog.withTraceId(result.idempotency_key).audit("conversion-control", "conversion.trigger", {
        action: "conversion.trigger", actor: resolveActor(request), target: key, reason: parseReason(request),
      }, "info");
      response.json({ status: result.status, idempotency_key: result.idempotency_key });
    } catch (err) {
      response.status(502).json({ detail: err instanceof Error ? err.message : String(err) });
    } finally {
      client?.destroy();
    }
  });
```

注意：`resolveActor` / `parseReason` 已存在（`app.ts` 內，prioritize/retry route 用）；`isKitMutationAuthorized` 已存在（`:2580`）；`listMinioObjects` / `createMinioS3Client` 已在 minioClient import。

- [ ] 跑測試確認通過：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/bim-review-coordinator
npx vitest run tests/conversion-trigger-route.test.ts 2>&1 | tail -15
# 預期：4 it 全 PASS（401/403、400 穿越、200 回 idempotency_key、ledger 可見）
```

- [ ] commit：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
git add bim-review-coordinator/src/services/manualIntake.ts bim-review-coordinator/src/app.ts bim-review-coordinator/tests/conversion-trigger-route.test.ts
git commit -m "$(cat <<'EOF'
plan: triggerManualIntake + POST /api/conversion/trigger（一鍵觸發）

x-dev-token 守門、server-side presigned 不外洩、直呼 ledger.upsert、冪等。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 後端共享狀態映射 helper — ledger 紀錄 → chip 狀態（純函式）

對應 spec §2.5 第 6 點、§3.3 第 1 點、AC-chip。抽一個純函式 `ledgerStatusForObject(idempotencyKey, records)`，把「bucket .ifc 物件」對應到 chip 狀態（`ready`/`detected`/`queued`/`converting`/`failed`/`未轉`），供前端共用語意（前端薄包此邏輯）。此 task 純函式、無 I/O，先在後端建可測單元，前端 Task 7 import 同義常數。

**Files:**
- Create: `bim-review-coordinator/src/services/ledgerChipStatus.ts`
- Test: `bim-review-coordinator/tests/ledger-chip-status.test.ts`（Create）

**Steps:**

- [ ] 寫失敗測試。新建 `bim-review-coordinator/tests/ledger-chip-status.test.ts`：

```ts
// bim-review-coordinator/tests/ledger-chip-status.test.ts
import { describe, it, expect } from "vitest";
import { ledgerChipStatus } from "../src/services/ledgerChipStatus.js";

const rec = (idk: string, status: string) => ({ idempotency_key: idk, status });

describe("ledgerChipStatus", () => {
  it("有 ready 紀錄 → 'ready'", () => {
    expect(ledgerChipStatus("mw_aaaa0000bbbb0001", [rec("mw_aaaa0000bbbb0001", "ready")] as never)).toBe("ready");
  });
  it("有 queued 紀錄 → 'queued'", () => {
    expect(ledgerChipStatus("mw_x", [rec("mw_x", "queued")] as never)).toBe("queued");
  });
  it("無紀錄 → 'untracked'（前端顯『未轉（含 baseline）』）", () => {
    expect(ledgerChipStatus("mw_none", [] as never)).toBe("untracked");
  });
});
```

- [ ] 跑確認失敗：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/bim-review-coordinator
npx vitest run tests/ledger-chip-status.test.ts 2>&1 | tail -12
# 預期：FAIL（ledgerChipStatus 不存在）
```

- [ ] 最小實作：新建 `bim-review-coordinator/src/services/ledgerChipStatus.ts`：

```ts
// bim-review-coordinator/src/services/ledgerChipStatus.ts
// chip 狀態映射（spec §2.5 第 6 點 / AC-chip）：把 bucket .ifc 物件對應到 ledger 衍生狀態。
// 無紀錄回 'untracked'（前端顯「未轉（含 baseline 既有檔）」，不臆測）。純函式、無 I/O。
import type { ConversionLedgerStatus } from "./conversionLedger.js";

export type ChipStatus = ConversionLedgerStatus | "untracked";

export function ledgerChipStatus(
  idempotencyKey: string,
  records: ReadonlyArray<{ idempotency_key: string; status: ConversionLedgerStatus }>,
): ChipStatus {
  const hit = records.find((r) => r.idempotency_key === idempotencyKey);
  return hit ? hit.status : "untracked";
}
```

- [ ] 跑確認通過：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/bim-review-coordinator
npx vitest run tests/ledger-chip-status.test.ts 2>&1 | tail -12
# 預期：3 it PASS
```

- [ ] commit：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
git add bim-review-coordinator/src/services/ledgerChipStatus.ts bim-review-coordinator/tests/ledger-chip-status.test.ts
git commit -m "$(cat <<'EOF'
plan: ledgerChipStatus 純函式（ledger 紀錄 → chip 狀態映射）

無紀錄回 untracked，供前端 chip 共用語意。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: watcher tick dedup 改持久 ledger 去重（§3.4 全自動 auto-enroll）— HIGH 風險

對應 spec §3.4、AC7、AC-autoenroll、§6（先量再改）。把 `startMinioWatcher` tick 的去重從 in-memory `isFirstRound` baseline 改為注入的持久 ledger watermark：對每個 `*/model.ifc` 算 `idkey`，查注入的 `isLedgered(idkey)` — 無紀錄→觸發、有→skip。in-memory `seen` 留作單輪快取。**此 task 動 watcher tick 核心、非零 blast radius，動手前必跑 GitNexus impact。**

**Files:**
- Modify: `bim-review-coordinator/src/services/minioWatcher.ts`（`MinioWatcherOptions` 加 `isLedgered?`、tick `:377-410` 改 dedup、移除 `isFirstRound` baseline 特例）
- Modify: `bim-review-coordinator/src/app.ts`（`startMinioWatcher({...})` 呼叫處 `:400-412` 注入 `isLedgered: (idkey) => conversionLedger.get(idkey) !== null`）
- Test: `bim-review-coordinator/tests/minio-watcher-loop.test.ts`（Modify：改「首輪 baseline 不觸發」斷言、加「既有無紀錄→自動觸發」「有紀錄→不觸發」）

**Steps:**

- [ ] 動手前跑 GitNexus impact，回報 blast radius（規範要求 HIGH/CRITICAL 先回報）：

```txt
mcp__gitnexus__impact({ target: "startMinioWatcher", direction: "upstream" })
# 回報：direct callers（app.ts startMinioWatcherIfEnabled）、affected processes、risk level
```

- [ ] 改既有失敗斷言（先讓測試表達新行為）：在 `bim-review-coordinator/tests/minio-watcher-loop.test.ts`，把 `makeWatcher` helper（`:146-166`）加一個可注入的 `isLedgered`（預設「全無紀錄」＝既有未轉都觸發）。在 helper 的 `startMinioWatcher({...})` 物件內、`structLog` 之後加一行：

```ts
    isLedgered: extra.isLedgered ?? (() => false),
```

並把 helper 型別 `extra: Partial<Parameters<typeof startMinioWatcher>[0]>` 保持不變（`isLedgered` 進 options 後自動納入）。

- [ ] 改「首輪 baseline 不觸發」測試（`:197-212`）為新語意「首輪即觸發既有無紀錄物件」：

```ts
  it("首輪：ledger 無紀錄的既有物件即觸發（auto-enroll，§3.4）", async () => {
    const state = { objs: [{ key: "899/main/xxx/model.ifc", etag: "e1" }, { key: "900/main/yyy/model.ifc", etag: "e2" }] };
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s3Base = await startS3Stub(state);
    watcher = makeWatcher(s3Base, selfBase, state); // isLedgered 預設 () => false → 全無紀錄
    await waitFor(() => watcher!.getStatus().triggered_total === 2, 5000);
    expect(received.length).toBe(2);
  });

  it("ledger 已有紀錄的物件 → 不觸發（持久 watermark 命中，重啟不風暴）", async () => {
    const state = { objs: [{ key: "899/main/xxx/model.ifc", etag: "e1" }] };
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s3Base = await startS3Stub(state);
    // 模擬「ledger 已有此 idkey」：isLedgered 對所有輸入回 true。
    watcher = makeWatcher(s3Base, selfBase, state, { isLedgered: () => true });
    await waitFor(() => (watcher!.getStatus().poll_count as number) >= 2, 5000);
    await new Promise((r) => setTimeout(r, 200));
    expect(received.length).toBe(0);
    expect(watcher!.getStatus().triggered_total).toBe(0);
  });
```

同時更新「第二輪新增物件 → 觸發」（`:214-240`）等仍依賴 baseline 語意的測試：把首輪後「新增物件才觸發」的前提改為「首輪即觸發 baseline，新增物件也觸發」——對 `:214` 測試，把首輪物件改為 `isLedgered` 命中（傳 `{ isLedgered: (k) => k.includes("xxx") }`），讓 `899/main/xxx` 視為已落帳、僅新增的 `988/main/zzz` 觸發，斷言維持 `received.length === 1`、payload 不變。對「同物件後續輪不再觸發」（`:242-254`）同樣調整。

- [ ] 跑測試確認失敗（watcher 尚未支援 `isLedgered`，仍走 baseline → 新斷言失敗）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/bim-review-coordinator
npx vitest run tests/minio-watcher-loop.test.ts 2>&1 | tail -25
# 預期：新增/改寫的 auto-enroll 斷言 FAIL（首輪 triggered_total 仍 0）
```

- [ ] 最小實作（watcher）：在 `bim-review-coordinator/src/services/minioWatcher.ts`：
  1. `MinioWatcherOptions`（`:125-146`）加欄位：`isLedgered: (idempotencyKey: string) => boolean;`（在 `structLog` 之前）。
  2. tick（`:377-410`）改 dedup：移除 `isFirstRound`（`:250` 宣告、`:384-387`/`:387` 區段），改為對每個 object 算 `idkey` 查 `opts.isLedgered`：

```ts
  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const objects = (await listAllKeys()).filter((o) => o.key.endsWith(opts.keySuffix));
      status.last_poll_at = new Date().toISOString();
      status.poll_count += 1;
      status.last_error = null;
      for (const o of objects) {
        const prev = seen.get(o.key);
        if (prev === o.etag) continue; // 單輪/跨輪 in-memory 快取：同 key 同 etag 不重查 ledger
        // §3.4：持久 ledger 去重水印。無紀錄→觸發（並由 intake 落帳）；有紀錄→skip（重啟命中不風暴）。
        const idkey = idempotencyKeyFor(opts.bucket, o.key, o.etag);
        if (opts.isLedgered(idkey)) { seen.set(o.key, o.etag); continue; }
        const outcome = await triggerIntake(o.key, o.etag);
        if (outcome !== "fail_transient") seen.set(o.key, o.etag);
      }
      status.seen_count = seen.size;
      // baseline_count 語意調整：改記「首輪 list 到的規約檔總數」供觀測（非「不觸發的基準」）。
      if (status.baseline_count === null) status.baseline_count = objects.length;
    } catch (err) {
      status.last_error = err instanceof Error ? err.message : String(err);
      opts.structLog.anomaly("minioWatch", "minio watch tick failed", {
        anomaly_kind: "retry", reason: status.last_error, bucket: opts.bucket,
      });
    } finally {
      if (!stopped) timer = setTimeout(runTick, opts.intervalSeconds * 1000);
    }
  }
```

  並刪除 `let isFirstRound = true;`（`:250`）。注意 `idempotencyKeyFor` 已在同檔（`:29`），無需 import。

- [ ] 最小實作（app 注入）：在 `bim-review-coordinator/src/app.ts` 的 `startMinioWatcher({...})` 呼叫（`:400-412`），在 `structLog,` 之前加：

```ts
      // §3.4：watcher tick 去重以持久 ledger 為水印（既有未轉自動補轉、重啟命中不風暴）。
      isLedgered: (idkey: string) => conversionLedger.get(idkey) !== null,
```

注意 `conversionLedger`（`:486`）在此 closure scope 內可見。

- [ ] 跑測試確認通過 ＋ 既有 watcher 測試零退化（除刻意改寫者）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/bim-review-coordinator
npx vitest run tests/minio-watcher-loop.test.ts tests/minio-watch-intake-integration.test.ts tests/minio-watch-status-route.test.ts 2>&1 | tail -25
# 預期：全 PASS（含改寫的 auto-enroll、未改的 SSRF/timeout/dispose/分頁 等）
```

- [ ] commit 前跑 GitNexus detect_changes 驗 scope 限於 watcher tick dedup、未波及 intake/dispatch 下游：

```txt
mcp__gitnexus__detect_changes({ scope: "compare", base_ref: "main" })
# 確認 affected symbols ⊂ { startMinioWatcher, tick, /api/minio route closure }，無 intake/dispatch
```

- [ ] commit：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
git add bim-review-coordinator/src/services/minioWatcher.ts bim-review-coordinator/src/app.ts bim-review-coordinator/tests/minio-watcher-loop.test.ts
git commit -m "$(cat <<'EOF'
plan: watcher tick dedup 改持久 ledger 去重（§3.4 全自動 auto-enroll）

移除 isFirstRound baseline 特例；注入 isLedgered watermark；既有未轉自動補轉、重啟不風暴。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 前端 client — `getMinioFolder` + `conversionTrigger`（帶 x-dev-token）

對應 spec §2.1、§3.3、AC-trigger。`coordinatorClient` 加 `getMinioFolder(prefix)`（打 `?delimiter=/`）回 `{ folders, objects, prefix, bucket, count }`、`conversionTrigger(key, reason?)`（POST 帶 `x-dev-token`）；`MinioObject` 加 `idempotency_key` 欄。

**Files:**
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`（加 `MinioFolderListing` 型別、`getMinioFolder`、`conversionTrigger`、`MinioObject.idempotency_key`、jsonPost 支援 dev-token header）
- Test: `web-viewer-sample/src/console/coordinatorClient.test.ts`（Modify：加 getMinioFolder/conversionTrigger 斷言）

**Steps:**

- [ ] 寫失敗測試：在 `web-viewer-sample/src/console/coordinatorClient.test.ts` 末尾（最後 `});` 之前）加（照該檔既有 `vi.spyOn(global, "fetch")` 模式）：

```ts
  it("getMinioFolder 打 ?delimiter=/ 並回 folders/objects", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ bucket: "bim-control", prefix: "洲際好宅/", folders: ["root/"], objects: [], count: 0 }), { status: 200 }),
    );
    const res = await coordinatorClient.getMinioFolder("洲際好宅/");
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("delimiter=%2F"), expect.anything());
    expect(res.folders).toEqual(["root/"]);
    fetchSpy.mockRestore();
  });

  it("conversionTrigger POST 帶 x-dev-token header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "detected", idempotency_key: "mw_aaaa0000bbbb0001" }), { status: 200 }),
    );
    const res = await coordinatorClient.conversionTrigger("a/b/c/model.ifc", "manual");
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["x-dev-token"]).toBeTruthy();
    expect(res.idempotency_key).toBe("mw_aaaa0000bbbb0001");
    fetchSpy.mockRestore();
  });
```

- [ ] 跑確認失敗：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/web-viewer-sample
npx vitest run src/console/coordinatorClient.test.ts 2>&1 | tail -15
# 預期：FAIL（getMinioFolder / conversionTrigger 不存在）
```

- [ ] 最小實作：在 `web-viewer-sample/src/console/coordinatorClient.ts`：
  1. `MinioObject`（`:246-254`）interface 加 `idempotency_key: string;`。
  2. 加 dev-token 取值與帶 header 的 POST helper（`COORD_BASE` 宣告後）：

```ts
// 一鍵觸發等寫入動作需 operator/dev token（對齊後端 isKitMutationAuthorized）。
// 從 Vite env 讀；未設時用後端 default "dev-token"（dev/demo 一致，非機密）。
const DEV_TOKEN: string = env?.VITE_DEV_AUTH_TOKEN ?? "dev-token";

async function jsonPostAuthed<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${COORD_BASE}${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "x-dev-token": DEV_TOKEN },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`coordinator ${path} -> ${res.status} ${await errorDetail(res)}`);
  return res.json() as Promise<T>;
}
```

  3. 加 `MinioFolderListing` 型別（在 `MinioObject` 之後）與兩個 client 方法（在 `coordinatorClient` 物件內、`getMinioObjects` 之後）：

```ts
export interface MinioFolderListing {
  bucket: string | null;
  prefix: string;
  folders: string[];
  objects: MinioObject[];
  count: number;
  note?: string;
}
```

```ts
  // 資料夾語意逐層導覽（spec §2.1）：打 ?delimiter=/，回 folders[]（CommonPrefixes）+ 當層 objects。
  getMinioFolder: (prefix = "") =>
    jsonGet<MinioFolderListing>(
      `/api/minio/objects?delimiter=${encodeURIComponent("/")}${prefix ? `&prefix=${encodeURIComponent(prefix)}` : ""}`,
    ),
  // 一鍵觸發轉檔（spec §3.3）：POST { key } 帶 x-dev-token；回 { status, idempotency_key }。
  conversionTrigger: (key: string, reason?: string) =>
    jsonPostAuthed<{ status: string; idempotency_key: string }>("/api/conversion/trigger", { key, reason }),
```

- [ ] 跑確認通過 ＋ 既有 client 測試零退化：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/web-viewer-sample
npx vitest run src/console/coordinatorClient.test.ts 2>&1 | tail -15
# 預期：全 PASS
```

- [ ] commit：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
git add web-viewer-sample/src/console/coordinatorClient.ts web-viewer-sample/src/console/coordinatorClient.test.ts
git commit -m "$(cat <<'EOF'
plan: 前端 client getMinioFolder + conversionTrigger（帶 x-dev-token）

MinioObject 加 idempotency_key；getMinioFolder 打 ?delimiter=/。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 前端 `MinioDataPage` 改逐層資料夾導覽 + 狀態 chip + 觸發鈕

對應 spec §2.5、§3.3、AC1/AC2/AC3/AC-D2/AC-badge/AC-honesty/AC-chip/AC-trigger。把 `MinioDataPage` 從 `buildMinioTree` 攤平樹改為 `useState(currentPrefix)` 逐層導覽（點資料夾換 prefix 重打 `getMinioFolder`）；`.ifc` 旁顯示 ledger chip（讀 `getConversionRecords`）＋「觸發轉檔」鈕（intent→confirm→`conversionTrigger`，成功 patch chip）。`buildMinioTree` 退役。

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`MinioDataPage` `:1185-1297`、刪 `buildMinioTree` `:1157-1171`、empty 態文案 `:1232-1235`、頁首字樣 `:1214-1216` 改「逐層」）
- Modify: `web-viewer-sample/src/console/MinioDataPage.test.tsx`（重寫斷言：folders 逐層 + chip + 觸發鈕；「不呼叫 getConversionRecords」→ 改為「會呼叫」）

**Steps:**

- [ ] 重寫前端測試斷言（先表達新行為）。把 `web-viewer-sample/src/console/MinioDataPage.test.tsx` 整檔改為以 `getMinioFolder` 為主、含 chip 與觸發鈕、含「會呼叫 getConversionRecords」：

```tsx
// MinioDataPage：逐層資料夾導覽（spec §2.5）+ ledger chip + 一鍵觸發。
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MinioDataPage } from "./pages";
import { coordinatorClient, type MinioObject } from "./coordinatorClient";

const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
const ifcObj: MinioObject = {
  key: "東勢區許良宇紀念圖書館/root/main/000001/model.ifc",
  etag: "abc", role: "source_ifc", idempotency_key: "mw_aaaa0000bbbb0001",
  project_id: "mv_1a2b3c4d", project_display_name: "東勢區許良宇紀念圖書館", category: "main", version: "000001",
};

describe("MinioDataPage — 逐層資料夾導覽 + chip + 觸發", () => {
  let container: HTMLDivElement; let prevActEnv: unknown;
  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div"); document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container); vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  it("頂層顯示 folders（資料夾節點），不再用 buildMinioTree 攤平", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "", folders: ["洲際好宅/", "東勢區許良宇紀念圖書館/"], objects: [], count: 0,
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("洲際好宅");
    expect(container.textContent).toContain("東勢區許良宇紀念圖書館");
  });

  it("葉層 .ifc：顯示來源 IFC role + 三段 badge + ledger chip + 觸發鈕", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "東勢區許良宇紀念圖書館/root/main/000001/", folders: [], objects: [ifcObj], count: 1,
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({
      count: 1, items: [{ idempotency_key: "mw_aaaa0000bbbb0001", project_id: "p", project_display_name: "x", category: "main", external_model_version_id: "000001", conversion_job_id: null, status: "queued", usdc_key: null, coverage_report: null, detected_at: "2026-06-24T00:00:00Z", updated_at: "2026-06-24T00:00:00Z" }],
    });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("來源 IFC");
    expect(container.textContent).toContain("main");           // 三段 badge
    expect(container.querySelector('[data-testid="minio-chip-mw_aaaa0000bbbb0001"]')).toBeTruthy(); // chip
    expect(container.querySelector('[data-testid="minio-trigger-mw_aaaa0000bbbb0001"]')).toBeTruthy(); // 觸發鈕
  });

  it("無 ledger 紀錄的 .ifc → chip 顯『未轉』、觸發鈕在", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "東勢區許良宇紀念圖書館/root/main/000001/", folders: [], objects: [ifcObj], count: 1,
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toMatch(/未轉/);
  });

  it("MinIO 未設定（count=0 + note）→ empty 態 (a)：顯『MinIO 未設定』文案", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: null, prefix: "", folders: [], objects: [], count: 0, note: "MinIO watch 未設定（未取得）",
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toMatch(/未設定|未取得/);
  });

  it("已設定但當前 prefix 空（folders=[] objects=[] 無 note）→ empty 態 (b)：顯『此層無物件』非『未設定』", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "洲際好宅/empty/", folders: [], objects: [], count: 0,
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toMatch(/此層|無物件|空/);
    expect(container.textContent).not.toMatch(/MinIO watch 未設定/);
  });

  it("getMinioFolder reject → 顯誠實錯誤 + 重試鈕，不假裝有資料", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockRejectedValue(new Error("coordinator /api/minio/objects -> 502 Bad Gateway"));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("/api/minio/objects");
  });

  it("頁首保留『唯讀 intake 來源視圖，非 metadata 權威』誠實字樣", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({ bucket: "bim-control", prefix: "", folders: [], objects: [], count: 0 });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toMatch(/唯讀.*intake.*來源|唯讀.*來源視圖/);
  });

  it("會呼叫 getConversionRecords（chip 需 ledger，§2.5 第 6 點）", async () => {
    const spy = vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({ bucket: "bim-control", prefix: "", folders: [], objects: [], count: 0 });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(spy).toHaveBeenCalled();
  });
});
```

- [ ] 跑確認失敗：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/web-viewer-sample
npx vitest run src/console/MinioDataPage.test.tsx 2>&1 | tail -25
# 預期：多數 FAIL（getMinioFolder 未被用、無 chip/trigger testid）
```

- [ ] 最小實作：在 `web-viewer-sample/src/console/pages.tsx` 改寫 `MinioDataPage`（`:1185-1297`）。刪除 `buildMinioTree`（`:1157-1171`）與 `MinioTree` type alias（`:1155`）。新 `MinioDataPage` 邏輯：

```tsx
import { ledgerChipStatus } from "../../../bim-review-coordinator/src/services/ledgerChipStatus";
// 註：若 monorepo 路徑不可跨 import，改在前端內聯同義函式（3 行：find by idempotency_key，無則 'untracked'）。
const CHIP_LABEL: Record<string, string> = {
  detected: t("已偵測", "detected"), queued: t("排隊", "queued"), converting: t("轉檔中", "converting"),
  ready: t("完成", "ready"), failed: t("失敗", "failed"), untracked: t("未轉（含 baseline 既有檔）", "not converted (incl. baseline)"),
};

export function MinioDataPage() {
  const [folder, setFolder] = useState<import("./coordinatorClient").MinioFolderListing | null>(null);
  const [records, setRecords] = useState<import("./coordinatorClient").ConversionRecord[]>([]);
  const [prefix, setPrefix] = useState("");                       // 當前層 prefix（spec §2.5：點資料夾換 prefix）
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [chipOverride, setChipOverride] = useState<Record<string, string>>({}); // 觸發成功後 patch chip（零額外 round-trip）
  const [pendingKey, setPendingKey] = useState<string | null>(null);            // intent→confirm
  const [triggerErr, setTriggerErr] = useState<string | null>(null);

  const load = useCallback(async (p: string) => {
    setLoading(true); setErr(null);
    try {
      const res = await coordinatorClient.getMinioFolder(p);
      setFolder(res);
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  }, []);
  const loadRecords = useCallback(async () => {
    try { const r = await coordinatorClient.getConversionRecords(50); setRecords(r.items); } catch { /* chip 缺資料時誠實顯未轉 */ }
  }, []);
  useEffect(() => { void load(prefix); }, [load, prefix]);
  useEffect(() => { void loadRecords(); }, [loadRecords]);

  const enterFolder = (f: string) => { setPrefix(f); };          // CommonPrefix 為絕對 prefix
  const goUp = () => {
    if (!prefix) return;
    const trimmed = prefix.replace(/\/$/, "");
    const idx = trimmed.lastIndexOf("/");
    setPrefix(idx >= 0 ? trimmed.slice(0, idx + 1) : "");
  };
  const sortedFolders = folder ? [...folder.folders].sort((a, b) => a.localeCompare(b, "zh-TW")) : [];

  const confirmTrigger = async () => {
    if (!pendingKey) return;
    setTriggerErr(null);
    try {
      const res = await coordinatorClient.conversionTrigger(pendingKey, "manual trigger from #minio");
      setChipOverride((p) => ({ ...p, [res.idempotency_key]: res.status })); // patch chip 為 detected/queued
      setPendingKey(null);
    } catch (e) { setTriggerErr(String(e)); }                    // 失敗顯 inline error、chip 不變
  };
  // ...JSX：頁首誠實字樣改「逐層資料夾導覽」；
  //  loading / err(+重試鈕 data-testid="minio-tree-retry") / empty 兩態（note 有→未設定；無→此層無物件）/ populated；
  //  populated：上一層鈕（prefix 非空時）+ sortedFolders 各一個資料夾鈕(onClick=enterFolder)
  //   + folder.objects 各一列（role label + 三段 badge(project_display_name/category/version 有才顯) +
  //     若 role===source_ifc：chip(data-testid={`minio-chip-${obj.idempotency_key}`}, 文字=CHIP_LABEL[chipOverride[idk] ?? ledgerChipStatus(idk, records)])
  //       + 觸發鈕(data-testid={`minio-trigger-${obj.idempotency_key}`}, onClick=()=>setPendingKey(obj.key)，
  //         僅當 chip 狀態 ∈ {untracked, failed} 時 enable))
  //  pendingKey 非 null → IntentDialog(confirm=confirmTrigger, triggerErr 顯 inline)；
  //  保留底部「Bucket layout（規約說明 — 示意，非實況）」DEMO panel（:1276-1287，標 DEMO 不變）。
}
```

實作 JSX 時：(a) 頁首 `:1215` 文案把「呈現 bucket 三層結構（專案 → 種類 → 版本）」改為「逐層資料夾導覽（像 MinIO 網頁），point-and-list」；(b) empty 態分兩種（`folder?.note` 有→顯 note/「MinIO 未設定」；無 note 且 `folders=[] objects=[]`→「此層無物件」）；(c) 資料夾節點用 `<Btn onClick={() => enterFolder(f)}>{f}</Btn>` 明示可點；(d) chip 用既有 `ec-prov` class（沿用 `roleClass` 配色慣例）。

- [ ] 跑確認通過：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/web-viewer-sample
npx vitest run src/console/MinioDataPage.test.tsx 2>&1 | tail -20
# 預期：8 it 全 PASS
```

- [ ] 跑型別檢查（vite build 不跑 tsc，務必另跑）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/web-viewer-sample
npx tsc --noEmit 2>&1 | tail -20
# 預期：無 error（若跨 monorepo import ledgerChipStatus 報錯，改用內聯 3 行同義函式並重跑）
```

- [ ] commit：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/MinioDataPage.test.tsx
git commit -m "$(cat <<'EOF'
plan: MinioDataPage 改逐層資料夾導覽 + 狀態 chip + 觸發鈕

buildMinioTree 退役；folders 逐層（localeCompare zh-TW）；.ifc chip 讀 ledger、觸發鈕 intent→confirm。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 前端 `ConversionSchedulingPage` baseline 揭露 + 一鍵觸發列

對應 spec §3.2、AC5、AC6。把擠在單一 Field（`pages.tsx:866`）的 baseline/seen/triggered/skipped 拆成獨立 Field + 解釋文案（`baseline_count` 標「首輪基準、by-design 不自動轉檔已被 §3.4 取代→改標『首輪 list 到的規約檔數』」；明示一致性基準＝可解析 IFC 數非物件總數）；ledger 列對「未轉/failed」加觸發鈕。

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`ConversionSchedulingPage` watcher 面板 `:858-887`、ledger 面板 `:893-942`）
- Modify: `web-viewer-sample/src/console/ConversionSchedulingPage.test.tsx`（加 baseline 拆分 + 觸發鈕斷言）

**Steps:**

- [ ] 寫失敗測試：在 `web-viewer-sample/src/console/ConversionSchedulingPage.test.tsx` 加（照該檔既有 mock 模式 mock `minioWatchStatus` / `getConversionRecords`）：

```tsx
  it("watcher 面板把 baseline / triggered 拆成獨立 Field + 一致性基準文案（可解析 IFC 數非物件總數）", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({
      enabled: true, bucket: "bim-control", prefix: "", interval_seconds: 60,
      last_poll_at: "2026-06-24T00:00:00Z", poll_count: 23, last_error: null,
      baseline_count: 3, seen_count: 3, triggered_total: 0, skipped_malformed_total: 0, last_triggered: [],
    } as never);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    // baseline 與 triggered 各自有獨立可辨識文字（非擠一行）。
    expect(container.querySelector('[data-testid="conv-baseline-count"]')?.textContent).toContain("3");
    expect(container.querySelector('[data-testid="conv-triggered-total"]')?.textContent).toContain("0");
    // 一致性基準文案：明示「可解析 IFC」非「物件總數」。
    expect(container.textContent).toMatch(/可解析 IFC|非物件總數/);
  });

  it("ledger 列對未轉/failed 紀錄顯一鍵觸發鈕（object_key 存在時）", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: true, bucket: "bim-control", prefix: "", interval_seconds: 60, last_poll_at: null, poll_count: 0, last_error: null, baseline_count: 0, seen_count: 0, triggered_total: 0, skipped_malformed_total: 0, last_triggered: [] } as never);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({
      count: 1, items: [{ idempotency_key: "mw_f", project_id: "p", project_display_name: "x", category: "main", external_model_version_id: "v1", conversion_job_id: null, status: "failed", usdc_key: null, coverage_report: null, detected_at: "2026-06-24T00:00:00Z", updated_at: "2026-06-24T00:00:00Z" }],
    });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="conv-ledger-retry-mw_f"]')).toBeTruthy();
  });
```

注意：第二個 it 的觸發鈕需 `object_key`，故 `ConversionRecord` 前端型別（`coordinatorClient.ts:230-242`）須補 `object_key: string | null;` 欄（後端 record 本就有，前端原省略）；fixture 補 `object_key: "x/main/v1/model.ifc"`。把該欄加進 fixture 與型別。

- [ ] 跑確認失敗：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/web-viewer-sample
npx vitest run src/console/ConversionSchedulingPage.test.tsx 2>&1 | tail -20
# 預期：新增兩 it FAIL（無 conv-baseline-count testid、無一致性文案、無 retry 鈕）
```

- [ ] 最小實作：
  1. `coordinatorClient.ts` `ConversionRecord`（`:230-242`）加 `object_key: string | null;`。
  2. `pages.tsx` watcher 面板把 `:866` 那一個合併 Field 拆成獨立 Field（保留其餘 Field 不動）：

```tsx
              <Field k={t("baseline（首輪 list 到的規約檔數）", "baseline (convention files seen on first poll)")}
                v={<span data-testid="conv-baseline-count">{String(mw.baseline_count ?? "—")}</span>}
                prov="asbuilt" />
              <Field k={t("自 baseline 後真正新觸發數", "newly triggered since baseline")}
                v={<span data-testid="conv-triggered-total">{String(mw.triggered_total ?? 0)}</span>}
                prov="asbuilt" />
              <Field k={t("seen / 跳過(malformed)", "seen / skipped (malformed)")}
                v={`${mw.seen_count ?? 0} / ${mw.skipped_malformed_total ?? 0}`} prov="asbuilt" />
              <p className="ec-note">{t("一致性基準＝可解析 IFC 數（*/model.ifc），非 bucket 物件總數；§3.4 後既有未轉檔由 watcher 自動補轉。", "Consistency basis = parsable IFC count (*/model.ifc), not total bucket objects; after §3.4 the watcher auto-enrolls previously unconverted files.")}</p>
```

  3. ledger 面板（`:914-937` 的 `records.map`）對 `r.status === "failed"` 或 `untracked`（此頁 records 都有紀錄，故僅 `failed`）且 `r.object_key` 存在時，在列末加觸發鈕 + intent→confirm（重用既有 `IntentDialog` / `pendingAction` 機制，或新增本地 `pendingTriggerKey` state 走 `coordinatorClient.conversionTrigger`）：

```tsx
                    <td>
                      {r.status === "failed" && r.object_key && (
                        <Btn data-testid={`conv-ledger-retry-${r.idempotency_key}`}
                          onClick={() => setPendingTriggerKey(r.object_key)}>
                          {t("重新觸發", "Re-trigger")}
                        </Btn>
                      )}
                    </td>
```

  並在 `ConversionSchedulingPage` 加 `const [pendingTriggerKey, setPendingTriggerKey] = useState<string | null>(null);` 與成功後 `void loadRecords()` 重抓（證據型更新）。

- [ ] 跑確認通過 ＋ 既有 ConversionSchedulingPage 測試零退化：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/web-viewer-sample
npx vitest run src/console/ConversionSchedulingPage.test.tsx 2>&1 | tail -20
# 預期：全 PASS
```

- [ ] commit：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/coordinatorClient.ts web-viewer-sample/src/console/ConversionSchedulingPage.test.tsx
git commit -m "$(cat <<'EOF'
plan: ConversionSchedulingPage baseline 揭露拆分 + ledger failed 列一鍵觸發

baseline/triggered/seen 各獨立 Field + 一致性基準文案（可解析 IFC 數非物件總數）。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: 修 `console.test.tsx` 綁三層樹語意的舊斷言

對應 spec §6。`console.test.tsx` 多處（`:394`、`:452`、`:538-573` 等）以 `renderToString(<MinioDataPage />)` 斷言「三層樹（專案→種類→版本）」「松風庵」攤平節點，與 Task 7 逐層導覽不相容（首幀 prefix="" 只回 folders，不會有葉層三段節點）。改為斷言「頁首誠實字樣 + loading/folders 殼」，不再斷言攤平三層。

**Files:**
- Modify: `web-viewer-sample/src/console/console.test.tsx`（`:394`、`:452`、`:536-607`、`:800-840` 等 MinioDataPage 相關 it）

**Steps:**

- [ ] 先跑現狀確認哪些 it 因 Task 7 而 fail：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/web-viewer-sample
npx vitest run src/console/console.test.tsx 2>&1 | tail -30
# 預期：MinioDataPage 三層樹相關 it FAIL（SSR 首幀無攤平節點 / 無 buildMinioTree）
```

- [ ] 改斷言：把 `console.test.tsx` 中所有 `MinioDataPage` 的「三層樹」斷言改為與逐層導覽相容的斷言。具體：
  - SSR 首幀測試（`:394` 等 `renderToString(<MinioDataPage />)`）：改斷言頁首誠實字樣 `expect(minio).toMatch(/唯讀.*來源視圖|逐層/)`，刪「松風庵 / 三層」斷言。
  - client-render populated 測試（`:538-573`）：把 `getMinioObjects` mock 改為 `getMinioFolder` mock 回 `{ folders: ["松風庵/"], objects: [], ... }`，斷言 `container.textContent` 含資料夾名「松風庵」（非三段節點）；同時 mock `getConversionRecords` 回空（避免 chip effect 報錯）。
  - error 態（`:575`）、empty 態（`:594`）、重試（`:801`）：把 spy 目標由 `getMinioObjects` 改 `getMinioFolder`，斷言文字改逐層相容版（error 仍含 `/api/minio/objects`；empty 顯「此層無物件」或「未設定」；重試成功顯資料夾名）。

  逐一改寫對應 it（保持 describe 結構，只換 mock 目標與斷言文字）。

- [ ] 跑確認通過：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/web-viewer-sample
npx vitest run src/console/console.test.tsx 2>&1 | tail -20
# 預期：全 PASS
```

- [ ] 跑前端全測試 + 型別檢查（整批回歸）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/web-viewer-sample
npm test 2>&1 | tail -20
npx tsc --noEmit 2>&1 | tail -10
# 預期：全 PASS、tsc 無 error
```

- [ ] commit：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
git add web-viewer-sample/src/console/console.test.tsx
git commit -m "$(cat <<'EOF'
plan: 修 console.test.tsx 綁三層樹的舊斷言 → 逐層導覽相容

MinioDataPage 相關 it 改 mock getMinioFolder、斷言資料夾名與誠實字樣。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: 後端整體驗證（npm run verify）

對應 spec §6。後端全測試 + build 回歸，確認 Task 1-5 無交叉退化。

**Files:**
- （無原始碼變更；僅執行驗證，必要時修前面 task 遺漏的退化）

**Steps:**

- [ ] 跑後端 verify（= build + test 全套）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/bim-review-coordinator
npm run verify 2>&1 | tail -30
# 預期：tsc build 無 error；vitest 全 PASS（含 minio-folder/minio-objects-delimiter/conversion-trigger/ledger-chip-status/minio-watcher-loop 等新與改）
```

- [ ] 若有退化：依失敗 it 回對應 task 修正（最小 diff），重跑 `npm run verify` 至全綠。無退化則跳過。

- [ ] commit（僅當有修正；否則略過此 task 的 commit）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
git add -A bim-review-coordinator
git commit -m "$(cat <<'EOF'
plan: 後端整體驗證退化修正（npm run verify 全綠）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Browser E2E（Playwright，隔離 stack，真 coordinator API）

對應 spec §5（誠實鐵律 user-facing 須 browser E2E）、AC8、AC-autoenroll、AC-trigger。改寫 `e2e/minio-closed-loop.spec.ts` 驗 vertical slice：`#/minio` route → 逐層資料夾導覽 → 真 `/api/minio/objects?delimiter=/` → `.ifc` chip → 觸發鈕 → loading/success/failure；`#/conv` baseline/triggered 區分；auto-enroll（既有未轉自動補轉）；維持「無假 ready」不變量。

**Files:**
- Modify: `web-viewer-sample/e2e/minio-closed-loop.spec.ts`（既有 spawn-coordinator + S3/conv stub 框架沿用；改前端斷言為逐層 + chip + 觸發；改 S3 stub 支援 Delimiter 回 CommonPrefixes；驗 auto-enroll）

**Steps:**

- [ ] 改 S3 stub 支援 Delimiter（`e2e/minio-closed-loop.spec.ts` 的 `startS3Stub`，`:56-68`）：偵測 `req.url` 含 `delimiter` 時回含 `CommonPrefixes` 的 XML（依當前 `prefix` query roll-up），否則維持現有遞迴 XML（供 watcher tick 用）。沿用既有 `listObjectsXml` 並加 `listFolderXml(prefix)` 變體。

- [ ] 改 `beforeAll` 的 baseline 注入語意（`:127-129`）：§3.4 後 watcher 無 baseline 特例（既有即觸發），故起始 S3 state 直接放真實多層 fixture（`東勢區許良宇紀念圖書館/root/main/000001/model.ifc` + `洲際好宅/root/main/<uuid>/geometries_chunks/chunk_0.json`）；驗 auto-enroll＝既有檔下一輪自動 triggered（不需再「步驟 2 注入新物件」）。

- [ ] 改測試主體（`:205-277`）斷言：
  - `#/minio`：`await page.goto(.../ui#/minio)`；斷言頂層資料夾鈕「東勢區許良宇紀念圖書館」「洲際好宅」可見（`getByText(..).first()`）；點「洲際好宅」資料夾 → 逐層到 `geometries_chunks/` 顯示為單一資料夾節點、chunk 不攤開（`await expect(page.getByText("chunk_0.json")).toHaveCount(0)`）；點到含 `model.ifc` 的版本層 → 顯「來源 IFC」+ 三段 badge + chip + 觸發鈕（`data-testid="minio-trigger-*"`）。
  - 觸發鈕 vertical slice：點觸發鈕 → IntentDialog confirm → 真打 `POST /api/conversion/trigger`（帶 x-dev-token，coordinator devAuthToken default `dev-token`）→ chip patch 為 `已偵測/排隊`（success）；驗 runtime ID（`mw_<hash16>` chip testid）。
  - `#/conv`：`conv-baseline-count` / `conv-triggered-total` 各自可見；auto-enroll 後 `conv-ledger-panel` 出現 `000001` 紀錄、不含「完成」（無假 ready，沿用 `:266` not.toContainText("完成")）。
  - 截圖落 `../artifacts/e2e/minio-folderview-*.png`（`#minio` 逐層展開 + geometries_chunks 摺疊 + `#conv` baseline/triggered）。

- [ ] 跑 E2E（需先 build dist-ui；本 repo 無自動 Playwright CI gate，conditional-skip 設計已在 `:122-126`）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/web-viewer-sample
npm run build:ui 2>&1 | tail -5
npx playwright test e2e/minio-closed-loop.spec.ts 2>&1 | tail -30
# 預期：PASS（截圖產出 artifacts/e2e/minio-folderview-*.png）；若 dist-ui/index.html 缺則 test.skip（非 false-green）
```

- [ ] 確認截圖證據存在（user-facing evidence）：

```bash
ls -la C:/Repos/active/iot/AI-BIM-governance/artifacts/e2e/ | grep minio-folderview
# 預期：minio-folderview-minio.png / minio-folderview-conv.png 存在
```

- [ ] commit：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
git add web-viewer-sample/e2e/minio-closed-loop.spec.ts
git commit -m "$(cat <<'EOF'
plan: E2E 改逐層資料夾導覽 + chip + 觸發 + auto-enroll 驗收

S3 stub 支援 Delimiter；驗 geometries_chunks 摺疊不攤開、無假 ready。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: 文件三方同步（prototype HTML / openspec / closed-loop design）

對應 spec §8、AC-doc-align。把已建功能還掛 NOT BUILT 是說謊（誠實鐵律要求移除）。同 PR 同步三方文件，避免再度背離。

**Files:**
- Modify: `docs/plans/ai-bim-governance-prototype.html`（`:534` 移除「真 MinIO 瀏覽」NOT BUILT；`:1107-1165` MinioPage 整段改 raw-folder 逐層、移除浮水印/local_fs 兩層樹渲染）
- Modify: `openspec/specs/minio-fileserver-source/spec.md`（`:54-67` `#/minio` requirement 以新 change supersede 為「真 MinIO raw-folder 逐層」；`:6-8` / `:69-95` A1/A2 binding SHALL 不動）
- Modify: `docs/superpowers/specs/2026-06-23-minio-conversion-closed-loop-observability-design.md`（`:84-88` 整段重寫為 raw-folder 逐層 + 葉層 badge；`:25, 42` 非目標「不新增手動觸發 UI」以新 change supersede）
- Modify: `openspec/specs/minio-watch-auto-intake/spec.md`（`:18-22` 「首輪 baseline 不觸發」以新 change supersede 為「ledger 無紀錄才觸發」）+ `docs/superpowers/specs/2026-06-12-minio-watch-auto-intake-design.md`（`:28, 53-54, 101` 註記 §3.4）
- Create: `openspec/changes/<新 change id>/`（承載 supersede delta；id 取 `minio-folderview-and-baseline-disclosure`）

**Steps:**

- [ ] 建新 openspec change 目錄承載 supersede delta（避免直接改 canonical spec 的 SHALL；照 repo openspec 慣例）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
mkdir -p openspec/changes/minio-folderview-and-baseline-disclosure/specs/minio-fileserver-source
mkdir -p openspec/changes/minio-folderview-and-baseline-disclosure/specs/minio-watch-auto-intake
# 在各 spec.md 寫 delta：MODIFIED Requirement「#/minio SHALL 真 MinIO raw-folder 逐層 list」、
#   MODIFIED「watcher SHALL 對 ledger 無紀錄之 */model.ifc 觸發（取代首輪 baseline 不觸發）」。
```

- [ ] 改 prototype HTML（`docs/plans/ai-bim-governance-prototype.html`）：
  - `:534` 從 NOT BUILT 清單移除「真 MinIO 瀏覽」。
  - `:1118` header「真 S3/MinIO 三層結構瀏覽待接 — 不是真 MinIO」、`:1122-1125` 浮水印「真 S3/MinIO 三層待接」、`:1126-1144` local_fs 兩層樹渲染 → 改寫成 raw-folder 逐層導覽說明（point-and-list）。
  - `:1147-1157` prov=demo 規約面板改標純語意參照；`:1158-1162` deps 改 coordinator `/api/minio/objects` + 真 MinIO，移除把 `/api/files/tree` 當 `#minio` 來源的 dep。

- [ ] 改 closed-loop design（`docs/superpowers/specs/2026-06-23-minio-conversion-closed-loop-observability-design.md`）：
  - `:84-88` 整段重寫：主樹 = raw-folder 逐層（S3 Delimiter，**無三層語意骨架**）；三層語意降為葉層 badge。**不得只改 `:86` 留 `:85`「三層（專案→類別→版本）」舊語意**（否則自相矛盾）。
  - `:25, 42` 非目標「不新增手動插隊/優先序佇列 UI」加註：本案使用者拍板新增「一鍵觸發轉檔」鈕 + `POST /api/conversion/trigger`（明示是「手動 intake 觸發」非「佇列插隊」），以新 change supersede。

- [ ] 改 auto-intake spec/design 註記 §3.4（`openspec/specs/minio-watch-auto-intake/spec.md:18-22` 指向新 change supersede；`docs/superpowers/specs/2026-06-12-minio-watch-auto-intake-design.md:28,53-54,101` 加註「§3.4 改持久 ledger 去重、重啟不風暴靠持久 ledger 非新建 watermark」）。

- [ ] 驗證文件無 stale 交叉引用（無自動 link checker，人工 grep 確認 NOT BUILT 字樣已移除）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
grep -n "真 S3/MinIO 三層待接\|NOT BUILT.*MinIO\|MinIO.*NOT BUILT" docs/plans/ai-bim-governance-prototype.html
# 預期：無命中（浮水印已移除）
```

- [ ] commit：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
git add docs/plans/ai-bim-governance-prototype.html openspec/ docs/superpowers/specs/2026-06-23-minio-conversion-closed-loop-observability-design.md docs/superpowers/specs/2026-06-12-minio-watch-auto-intake-design.md
git commit -m "$(cat <<'EOF'
plan: 文件三方同步 — 移除真 MinIO 瀏覽 NOT BUILT 浮水印 + supersede

prototype/openspec/closed-loop design 對齊 raw-folder 逐層 + 一鍵觸發 + ledger 去重；A1/A2 binding SHALL 不動。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 收尾驗證（plan 全執行後）

```bash
# 後端全綠
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/bim-review-coordinator && npm run verify 2>&1 | tail -10
# 前端全綠 + 型別
cd ../web-viewer-sample && npm test 2>&1 | tail -10 && npx tsc --noEmit 2>&1 | tail -5
# E2E 證據存在（user-facing）
ls C:/Repos/active/iot/AI-BIM-governance/artifacts/e2e/ | grep minio-folderview
```

完成回報（superpowers:verification-before-completion）須含：改了哪些 tracked files、執行了哪些驗證、哪些測試沒跑與原因（如 Playwright 因 dist-ui 未 build 而 skip）、已知風險（Task 5 watcher tick dedup 為 HIGH 風險，GitNexus impact/detect_changes 結果附上）。

## 已知 gate / blocker（執行者須留意，非 plan 缺陷）

- **OQ4 archive gate（spec §7-B、§8.5）：** `openspec/changes/minio-watch-key-structure/` 仍 active（未 archive），`openspec/specs/minio-watch-auto-intake/spec.md:14` 仍寫舊「兩層 `{projectId}/{modelId}`」。不阻擋主樹（raw-folder 不依賴三段），但**阻擋葉層 badge（AC-badge）驗收正確性**。維護者動作：進實作前 archive 該 change，或明訂 ≥3 段 delta 為 live 權威。Task 12 的 supersede delta 應與此 archive 協調，避免兩個 change 對同一 spec 矛盾。
- **跨 monorepo import（Task 7）：** plan 預設前端可 import 後端 `ledgerChipStatus`；若 web-viewer tsconfig 不允許跨 package 路徑，fallback＝在前端內聯 3 行同義函式（find by `idempotency_key`，無則 `'untracked'`），不阻擋實作。
