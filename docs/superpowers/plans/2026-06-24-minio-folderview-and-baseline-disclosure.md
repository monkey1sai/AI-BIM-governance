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

對應 spec §2.1、§2.3、§2.5 第 5 點、AC-D2、AC-badge。在 `minioClient.ts` 新增資料夾語意 list 函式，回 `folders[]`（每筆 `{ prefix, has_source_ifc }`，CommonPrefixes + 「該前綴遞迴下是否含 .ifc」供前端『含 source IFC』badge）＋當層直屬 `objects`，並對每個 `.ifc` 物件附 `idempotency_key`（給前端 chip lookup，spec §3.3 路徑 A）。`listMinioObjects` 簽名與回應**完全不動**。

**Files:**
- Modify: `bim-review-coordinator/src/services/minioClient.ts`（加 `listMinioFolder` + `MinioFolderNode`/`MinioFolderListing` 型別 + `prefixHasSourceIfc` helper + `MinioObjectView` 加 `idempotency_key` 欄）
- Test: `bim-review-coordinator/tests/minio-folder-route.test.ts`（Create）

> **本 task 拆成 1a → 1b → 1c 三個可各自 commit 的小步（task-decomposition 修正；原單一 task 同時做型別+`listMinioFolder`+`prefixHasSourceIfc`+`MinioObjectView` 改欄＋4 個 it，估 15-20 分鐘超上限）。** 下方「Steps」一次給出完整測試與實作程式碼，但**執行順序**依三小步漸進、每步各跑各 commit：
>
> - **1a＝`MinioObjectView` 加 `idempotency_key` 欄 + `listMinioObjects` push 補該欄（測試零改）。** 只動既有 `listMinioObjects`：在 `MinioObjectView`（`:18-26`）interface 末尾加 `idempotency_key: string;`、更新 import 行 `:5` 為 `import { deriveIntakeFromKey, idempotencyKeyFor } from "./minioWatcher.js";`、把現有 `out.push({...})` 補 `idempotency_key: idempotencyKeyFor(bucket, key, obj.ETag ?? "")`。跑 `npx vitest run tests/minio-objects-route.test.ts` 應**零退化**（舊測試未斷言該欄）。commit message：`plan: 1a MinioObjectView 加 idempotency_key（listMinioObjects 補欄、測試零改）`。
> - **1b＝`listMinioFolder` 基本 Delimiter list（`folders` + 當層 `objects`，先不做 has_source_ifc probe）。** 先寫 1b 對應的兩個 it（下方測試的第 1、3、4 個 it——「回 folders/objects」「分頁合併」「.ifc 附 idempotency_key + 三段 badge」），實作 `listMinioFolder` 主體（while-loop 分頁 + CommonPrefixes 收集 + objects 衍生欄），**但此步 `folders` 暫回 `{ prefix, has_source_ifc: false }`**（probe 尚未接）。對應的「has_source_ifc」斷言（第 2 個 it）此步**先 `it.skip`** 或預期 FAIL，待 1c。commit message：`plan: 1b listMinioFolder 基本 Delimiter list（folders + 當層 objects）`。
> - **1c＝`prefixHasSourceIfc` probe + folder `has_source_ifc` 回真值。** 加 `prefixHasSourceIfc` helper、把 `listMinioFolder` 末段對每個 CommonPrefix 呼 `prefixHasSourceIfc` 填真 `has_source_ifc`、解開 1b skip 的第 2 個 it。跑整檔 4 個 it 全 PASS。commit message：`plan: 1c prefixHasSourceIfc probe + folder has_source_ifc（spec §2.5 第 5 點）`。
>
> **`folders` 型別最終版鎖定（cross-task 修正）：** 1a/1b/1c 完成後，`MinioFolderListing.folders` 型別**最終為 `Array<{ prefix: string; has_source_ifc: boolean }>`（物件陣列），此即最終版**——Task 2 route 透傳、Task 6 前端型別、Task 7 前端 `sortedFolders` 一律直接以此物件陣列接力，**無需回頭修改已 commit 的 Task 1**。Task 7 blockquote 的「7a 前置：folders 帶 has_source_ifc」僅是提醒「Task 1 已就緒、7a 直接用」，**不是要求回補 Task 1**。下方測試的 `res.folders.map((f) => f.prefix)` 已對物件陣列做 map（與最終型別一致），驗證此鎖定。

**Steps:**

- [ ] 寫失敗測試（folder list 基本行為，**1b/1c 共用一份**；執行時依上方 1a→1b→1c 漸進，has_source_ifc 斷言留待 1c）：新建 `bim-review-coordinator/tests/minio-folder-route.test.ts`，照 `minio-objects-route.test.ts` 的 S3 stub 模式，但 stub 須回 `CommonPrefixes`。內容：

```ts
// bim-review-coordinator/tests/minio-folder-route.test.ts
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { listMinioFolder, createMinioS3Client } from "../src/services/minioClient.js";

let stub: http.Server | null = null; let stubUrl = "";
// S3 ListObjectsV2 with Delimiter='/'：回 CommonPrefixes（資料夾）+ Contents（當層直屬檔）。
// 支援分頁：第一頁 IsTruncated=true + NextContinuationToken，第二頁 false。
// 重要：本 stub 依「呼叫順序」回 pages（call N → pages[N]），超出則重複最後一頁。
//   listMinioFolder 會先做頂層 Delimiter list（call 1），再對每個 CommonPrefix 依序 probe has_source_ifc
//   （call 2,3,...）。故 pages 順序＝[頂層 list, probe folder#1, probe folder#2, ...]，須與 prefixSet 順序對齊。
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
  it("回 folders=CommonPrefixes（{prefix,has_source_ifc}）、objects=當層直屬檔，folders 不含被 roll-up 的子物件", async () => {
    await startS3Stub([{ prefixes: ["洲際好宅/", "東勢區許良宇紀念圖書館/"], keys: ["annotations/a.json"] }]);
    const client = createMinioS3Client({ endpoint: stubUrl, accessKey: "x", secretKey: "y" });
    const res = await listMinioFolder(client, "bim-control", "", "/");
    expect(res.folders.map((f) => f.prefix)).toEqual(["洲際好宅/", "東勢區許良宇紀念圖書館/"]);
    expect(res.objects).toHaveLength(1);
    expect(res.objects[0].key).toBe("annotations/a.json");
    expect(res.objects[0].role).toBe("other");
  });

  it("資料夾 has_source_ifc：對每個 CommonPrefix 再 probe 一次，子層有 .ifc → true、無 → false（spec §2.5 第 5 點）", async () => {
    // 第一頁＝頂層 list（2 個 folder，無直屬檔）；後兩頁＝對各 folder 的 probe list（has_source_ifc）。
    // stub 依呼叫順序回頁：probe「proj-with-ifc/」回含 model.ifc、probe「proj-empty/」回無 .ifc。
    await startS3Stub([
      { prefixes: ["proj-with-ifc/", "proj-empty/"], keys: [] }, // 頂層 Delimiter list
      { prefixes: [], keys: ["proj-with-ifc/root/main/000001/model.ifc"] }, // probe proj-with-ifc/
      { prefixes: [], keys: ["proj-empty/annotations/a.json"] },             // probe proj-empty/
    ]);
    const client = createMinioS3Client({ endpoint: stubUrl, accessKey: "x", secretKey: "y" });
    const res = await listMinioFolder(client, "bim-control", "", "/");
    const byPrefix = Object.fromEntries(res.folders.map((f) => [f.prefix, f.has_source_ifc]));
    expect(byPrefix["proj-with-ifc/"]).toBe(true);
    expect(byPrefix["proj-empty/"]).toBe(false);
  });

  it("超 1000 子前綴/物件不截斷：IsTruncated=true → 帶 continuation 取次頁，兩頁 folders 合併", async () => {
    await startS3Stub([
      { prefixes: ["A/"], keys: [], next: "tok2" },
      { prefixes: ["B/"], keys: [] },
      // 後續為 A/、B/ 的 has_source_ifc probe（回無 .ifc 即可，本測試只驗合併）。
      { prefixes: [], keys: [] },
      { prefixes: [], keys: [] },
    ]);
    const client = createMinioS3Client({ endpoint: stubUrl, accessKey: "x", secretKey: "y" });
    const res = await listMinioFolder(client, "bim-control", "", "/");
    expect(res.folders.map((f) => f.prefix)).toEqual(["A/", "B/"]);
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
export interface MinioFolderNode {
  prefix: string;          // CommonPrefix（資料夾節點絕對 prefix）
  has_source_ifc: boolean; // 該 prefix（遞迴）下是否有 .ifc 葉物件（spec §2.5 第 5 點 badge）
}

export interface MinioFolderListing {
  bucket: string;
  prefix: string;
  folders: MinioFolderNode[]; // CommonPrefixes（資料夾節點 + has_source_ifc）
  objects: MinioObjectView[]; // 當層直屬檔（被 roll-up 的子物件不在此）
  count: number;              // objects.length（誠實：非遞迴總數）
}

/**
 * 該 prefix（遞迴，不帶 Delimiter）下是否含 .ifc 葉物件（spec §2.5 第 5 點 folder badge）。
 * CommonPrefix 只回 prefix 字串、不含內容，故須對該 prefix 各發一次 list 才能誠實判定（不臆測）。
 * MaxKeys 不設上限但一旦命中 .ifc 即可早停（while-loop 找到就回 true）。
 */
async function prefixHasSourceIfc(client: S3Client, bucket: string, prefix: string): Promise<boolean> {
  let token: string | undefined;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    if ((resp.Contents ?? []).some((o) => o.Key?.endsWith(".ifc"))) return true;
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return false;
}

/**
 * 資料夾語意 list（spec §2.1）：帶 Delimiter='/' → CommonPrefixes 為資料夾、Contents 為當層直屬檔。
 * 單層仍處理 IsTruncated（while-loop 全拉，超 1000 子前綴/物件不截斷，AC-D2）。
 * 對每個 .ifc 物件附 idempotency_key 供前端 chip 對 ledger lookup（spec §3.3 路徑 A）。
 * 對每個 CommonPrefix 再 probe 一次取 has_source_ifc（spec §2.5 第 5 點 folder badge）。
 * 永不回 presigned URL（MinioObjectView 無 url 欄）。
 */
export async function listMinioFolder(
  client: S3Client,
  bucket: string,
  prefix: string,
  delimiter: string,
): Promise<MinioFolderListing> {
  const prefixSet: string[] = [];
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
      if (cp.Prefix) prefixSet.push(cp.Prefix);
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
  // 對每個 CommonPrefix probe has_source_ifc（spec §2.5 第 5 點）。序列執行確保測試 stub 依呼叫順序回頁可預測。
  const folders: MinioFolderNode[] = [];
  for (const p of prefixSet) {
    folders.push({ prefix: p, has_source_ifc: await prefixHasSourceIfc(client, bucket, p) });
  }
  return { bucket, prefix, folders, objects, count: objects.length };
}
```

> **效能誠實註記（spec §2.4）：** `has_source_ifc` 對每個 CommonPrefix 各發一次遞迴 list（命中 .ifc 即早停），頂層 7 個 folder＝最多 7 次額外 round-trip。這是 spec §2.5 第 5 點 folder badge 的等效成本、**僅對 folder badge 付出**；不誇大為效能優化。若維護者評估成本不可接受，唯一可接受替代＝把 badge 標 `NOT BUILT`（不可臆測），但 spec 已升為硬 AC，預設做出來。

- [ ] 跑測試確認通過 ＋ 既有 minio-objects 測試零退化：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/bim-review-coordinator
npx vitest run tests/minio-folder-route.test.ts tests/minio-objects-route.test.ts 2>&1 | tail -20
# 預期：兩檔全 PASS（listMinioObjects 舊測試因只多 idempotency_key 欄、未斷言該欄，零退化）
```

- [ ] commit（依 1a/1b/1c **分三次** commit；下方為 1c 最終 commit 範例，1a/1b 用上方 blockquote 給的 commit message，各自 `git add` 同兩個檔即可）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
git add bim-review-coordinator/src/services/minioClient.ts bim-review-coordinator/tests/minio-folder-route.test.ts
git commit -m "$(cat <<'EOF'
plan: 1c prefixHasSourceIfc probe + folder has_source_ifc（spec §2.5 第 5 點）

listMinioFolder 對每個 CommonPrefix probe；folders 型別最終為 {prefix,has_source_ifc}。

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
  // 第一次呼叫＝頂層 Delimiter list（回 CommonPrefix「洲際好宅/」+ 當層 annotations/a.json）；
  // 後續呼叫＝listMinioFolder 對「洲際好宅/」的 has_source_ifc probe（回含 model.ifc → true）。
  let call = 0;
  s3Stub = http.createServer((_req, res) => {
    call += 1;
    res.writeHead(200, { "content-type": "application/xml" });
    if (call === 1) {
      res.end(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated><CommonPrefixes><Prefix>洲際好宅/</Prefix></CommonPrefixes><Contents><Key>annotations/a.json</Key><ETag>"e"</ETag></Contents></ListBucketResult>`);
      return;
    }
    res.end(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>洲際好宅/root/main/000001/model.ifc</Key><ETag>"e"</ETag></Contents></ListBucketResult>`);
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
  it("帶 delimiter → 回 folders[]（{prefix,has_source_ifc}）+ 當層 objects，不含 url", async () => {
    await startS3Stub();
    const res = await request(makeApp().app).get("/api/minio/objects?delimiter=/");
    expect(res.status).toBe(200);
    expect(res.body.folders.map((f: { prefix: string }) => f.prefix)).toEqual(["洲際好宅/"]);
    expect(res.body.folders[0].has_source_ifc).toBe(true); // probe 命中 model.ifc
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

> **本 task 拆成 3a → 3b 兩個可各自 commit 的小步（task-decomposition 修正；原單一 task 同時新建 `manualIntake.ts`（~55 行）+ route（~65 行）+ 整份 supertest 測試（4 it），估 15-20 分鐘超上限）。** 下方「Steps」一次給出完整測試與實作，但**執行順序**依兩小步漸進、各跑各 commit：
>
> - **3a＝`manualIntake.ts` 服務函式 + 純函式單元測試。** 只新建 `bim-review-coordinator/src/services/manualIntake.ts`（`triggerManualIntake`/`ManualIntakeConfig`/`ManualIntakeResult`，內容見下方「最小實作（服務函式）」），並寫一支**輕量單元測試** `bim-review-coordinator/tests/manual-intake.test.ts` 直接呼 `triggerManualIntake`（用 S3 stub + 真 `ConversionLedger`（注入 temp `conversionLedgerStorePath`）驗：合法 key → `{ ok:true, idempotency_key }` 且 ledger 落帳；key 含 `..` → `{ ok:false }`；presign 失敗 → `{ ok:false }`）。**不碰 route、不碰 app.ts。** commit message：`plan: 3a triggerManualIntake 服務函式 + 純函式單元測試`。
>   - 3a 單元測試骨架（照 `ledger-chip-status.test.ts` 輕量風格 + `minio-folder-route.test.ts` 的 S3 stub）：
>
> ```ts
> // bim-review-coordinator/tests/manual-intake.test.ts
> import { describe, it, expect, afterEach } from "vitest";
> import http from "node:http";
> import fs from "node:fs"; import os from "node:os"; import path from "node:path";
> import { triggerManualIntake } from "../src/services/manualIntake.js";
> import { ConversionLedger } from "../src/services/conversionLedger.js";
> import { idempotencyKeyFor } from "../src/services/minioWatcher.js";
>
> let stub: http.Server | null = null; let stubUrl = ""; let root: string | null = null;
> function startS3Stub(keys: string[]): Promise<void> {
>   stub = http.createServer((_req, res) => {
>     const contents = keys.map((k) => `<Contents><Key>${k}</Key><ETag>"e1"</ETag></Contents>`).join("");
>     res.writeHead(200, { "content-type": "application/xml" });
>     res.end(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`);
>   });
>   return new Promise((r) => stub!.listen(0, "127.0.0.1", () => {
>     stubUrl = `http://127.0.0.1:${(stub!.address() as { port: number }).port}`; r();
>   }));
> }
> afterEach(async () => {
>   if (stub) await new Promise<void>((r) => stub!.close(() => { stub = null; r(); }));
>   if (root) { fs.rmSync(root, { recursive: true, force: true }); root = null; }
> });
> const cfg = () => ({ endpoint: stubUrl, bucket: "bim-control", accessKey: "ak", secretKey: "sk", keySuffix: "/model.ifc" });
> function makeLedger() {
>   root = fs.mkdtempSync(path.join(os.tmpdir(), "manual-intake-"));
>   // ConversionLedger 是 constructor-based（spec §6.1 已驗證；無 createConversionLedger 工廠）。
>   return new ConversionLedger(path.join(root, "ledger.json"));
> }
>
> describe("triggerManualIntake", () => {
>   it("合法 key → ok:true + ledger 落帳（idempotency_key 由非空 etag 衍生）", async () => {
>     await startS3Stub(["東勢區許良宇紀念圖書館/root/main/000001/model.ifc"]);
>     const ledger = makeLedger();
>     const r = await triggerManualIntake("東勢區許良宇紀念圖書館/root/main/000001/model.ifc", '"e1"', cfg(), ledger, "2026-06-24T00:00:00Z");
>     expect(r.ok).toBe(true);
>     if (r.ok) {
>       expect(r.idempotency_key).toBe(idempotencyKeyFor("bim-control", "東勢區許良宇紀念圖書館/root/main/000001/model.ifc", '"e1"'));
>       expect(ledger.get(r.idempotency_key)).not.toBeNull();
>     }
>   });
>   it("key 含 .. → ok:false（deriveIntakeFromKey 拒）", async () => {
>     await startS3Stub(["a/b/c/model.ifc"]);
>     const r = await triggerManualIntake("../../etc/model.ifc", '"e1"', cfg(), makeLedger(), "2026-06-24T00:00:00Z");
>     expect(r.ok).toBe(false);
>   });
> });
> ```
>
> - **3b＝route + supertest 測試。** 在 `app.ts` 新增 `POST /api/conversion/trigger` route（內容見下方「最小實作（route）」），並寫整份 `conversion-trigger-route.test.ts`（下方 4 個 supertest it：401/403、400 穿越、200 回 idempotency_key、ledger 可見）。commit message：`plan: 3b POST /api/conversion/trigger route + supertest（x-dev-token 守門）`。

**Steps:**

- [ ] 寫失敗測試（supertest，含 auth 拒絕 / key 防穿越 / presigned 不外洩 / 回 idempotency_key / 寫 ledger）。**此為 3b 的測試**（3a 的輕量單元測試見上方 blockquote）。新建 `bim-review-coordinator/tests/conversion-trigger-route.test.ts`：

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

  it("合法 key + 有 token → 回 { status, idempotency_key }（由非空 etag 衍生），不外洩 presigned URL", async () => {
    const key = "東勢區許良宇紀念圖書館/root/main/000001/model.ifc";
    await startS3Stub([key]);
    // 後端對該 key list 取 etag（stub 回 "e1"）→ idempotency_key 應 === idempotencyKeyFor(bucket,key,'"e1"')。
    // 驗 idempotency_key 不是 mw_hash('')（空 etag 的退化值），確保 etag 真的被帶入。
    const { idempotencyKeyFor } = await import("../src/services/minioWatcher.js");
    const expected = idempotencyKeyFor("bim-control", key, '"e1"');
    const emptyEtagKey = idempotencyKeyFor("bim-control", key, "");
    const res = await request(makeApp().app).post("/api/conversion/trigger")
      .set("x-dev-token", "test-dev-token").send({ key });
    expect(res.status).toBe(200);
    expect(res.body.idempotency_key).toMatch(/^mw_[0-9a-f]{16}$/);
    expect(res.body.idempotency_key).toBe(expected);          // etag 確實參與 hash
    expect(res.body.idempotency_key).not.toBe(emptyEtagKey);  // 非空 etag 退化值
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
      // 取該 key 的 etag（idempotency_key 需 etag）。用 Prefix=key 精準 list（避免 527 物件全量掃；
      // buildability：大 bucket 下全量 list 取單一 etag 效率極差、與 listMinioFolder 精準 prefix 語意衝突）。
      // Prefix=key 回該 key（及恰好以其為前綴者），再 find 取完全相等的 key。
      const objs = await listMinioObjects(client, config.minioWatchBucket, key, config.minioWatchKeySuffix);
      const match = objs.find((o) => o.key === key);
      if (!match || !match.etag) {
        response.status(404).json({ detail: "object not found in bucket (or missing etag)" });
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

注意：`resolveActor` / `parseReason` 已存在（`app.ts` 內，prioritize/retry route 用）；`isKitMutationAuthorized` 已存在（`:2580`）；`listMinioObjects` / `createMinioS3Client` 已在 minioClient import。**`listMinioObjects(client, bucket, key, suffix)` 以 `key` 當 prefix 時，回傳物件的 `project_id`/`category`/`version` 衍生欄會因 relative path 為空而為 null——但 route 只取 `match.etag`，這些衍生欄不參與，正確性不受影響；真正的三段解析在前面的 `deriveIntakeFromKey({ key, prefix: "" })` 與 `triggerManualIntake` 內各做一次（吃完整 key）。**

- [ ] 跑測試確認通過：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/bim-review-coordinator
npx vitest run tests/conversion-trigger-route.test.ts 2>&1 | tail -15
# 預期：4 it 全 PASS（401/403、400 穿越、200 回 idempotency_key、ledger 可見）
```

- [ ] commit（依 3a/3b **分兩次** commit）：

```bash
# 3a（服務函式 + 單元測試）
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
git add bim-review-coordinator/src/services/manualIntake.ts bim-review-coordinator/tests/manual-intake.test.ts
git commit -m "$(cat <<'EOF'
plan: 3a triggerManualIntake 服務函式 + 純函式單元測試

重用 deriveIntakeFromKey/idempotencyKeyFor/getSignedUrl，直呼 ledger.upsert、冪等；非 import triggerIntake 私有 closure。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
# 3b（route + supertest）
git add bim-review-coordinator/src/app.ts bim-review-coordinator/tests/conversion-trigger-route.test.ts
git commit -m "$(cat <<'EOF'
plan: 3b POST /api/conversion/trigger route + supertest（x-dev-token 守門）

server-side presigned 不外洩；拒匿名 401/403；key 防穿越 400；回 {status, idempotency_key}。

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

> **本「改既有失敗斷言」拆成 5a → 5b → 5c 三個小步（task-decomposition 修正）。** 原本一步同時改三個相互依賴的 it（首輪語意 + 第二輪新增 + 後續輪不再觸發）無法個別驗證。依序做、每步只改 1~2 個 it、各跑一次確認 FAIL 後才進實作：
>
> **`isLedgered` 的正確型別契約（buildability 修正，務必照此寫測試）：** `isLedgered` 收到的參數是 **`idempotencyKeyFor(bucket,key,etag)` 算出的 `mw_<hash16>`**，**不是 key 字串**。因此 `isLedgered: (k) => k.includes("xxx")` 是**錯的**（idkey 是 hash、永不含 "xxx" → 恆 false、既存物件仍被觸發、`received.length===1` 失敗）。要表達「某物件已落帳」必須**計算該物件的真實 idkey** 再比對：`import { idempotencyKeyFor } from "../src/services/minioWatcher.js";` 後用 `{ isLedgered: (idk) => idk === idempotencyKeyFor("bim-control", "899/main/xxx/model.ifc", "e1") }`（bucket 名須與 `makeWatcher` 注入的 `bucket` 一致——已查證 helper 用 `bucket: "bim-control"`，`minio-watcher-loop.test.ts:154`）。「全部已落帳」用 `() => true`、「全部未落帳」用 `() => false`。

- [ ] **5a — helper 加可注入 `isLedgered`（預設全未落帳）：** 在 `bim-review-coordinator/tests/minio-watcher-loop.test.ts`，`makeWatcher` helper（`:146-166`）的 `startMinioWatcher({...})` 物件內、`structLog` 之後加一行：

```ts
    isLedgered: extra.isLedgered ?? (() => false),
```

helper 型別 `extra: Partial<Parameters<typeof startMinioWatcher>[0]>` 保持不變（`isLedgered` 進 options 後自動納入）。並在檔頭 import：`import { idempotencyKeyFor } from "../src/services/minioWatcher.js";`（後續 it 計算真實 idkey 用）。此步只改 helper，不單獨跑（隨 5b 一起 FAIL）。

- [ ] **5b — 改「首輪 baseline 不觸發」為「首輪即觸發無紀錄物件」+ 加「已落帳不觸發」（改/加 2 個 it）：** 把原 `:197-212` 的 it 改為下列兩個：

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

跑確認 FAIL（watcher 尚未支援 `isLedgered`、仍走 baseline → 首輪 `triggered_total` 仍 0）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/bim-review-coordinator
npx vitest run tests/minio-watcher-loop.test.ts -t "首輪|已有紀錄" 2>&1 | tail -20
# 預期：兩個新 it FAIL
```

- [ ] **5c — 改仍依賴 baseline 語意的後續輪 it（`:214-240` 第二輪新增、`:242-254` 後續輪不再觸發）：** 用**真實 idkey** 表達「首輪物件已落帳、僅新增物件觸發」：

```ts
  // 「第二輪新增物件 → 觸發」改寫：首輪物件以真實 idkey 標為已落帳（不觸發），新增的才觸發。
  it("既有已落帳、僅新增無紀錄物件觸發（§3.4 取代原 baseline delta 語意）", async () => {
    const state = { objs: [{ key: "899/main/xxx/model.ifc", etag: "e1" }] };
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s3Base = await startS3Stub(state);
    // 首輪物件 899/main/xxx 的真實 idkey 命中 → 視為已落帳；其餘（新增）未落帳。
    const ledgeredIdk = idempotencyKeyFor("bim-control", "899/main/xxx/model.ifc", "e1");
    watcher = makeWatcher(s3Base, selfBase, state, { isLedgered: (idk) => idk === ledgeredIdk });
    await waitFor(() => (watcher!.getStatus().poll_count as number) >= 1, 5000);
    state.objs.push({ key: "988/main/zzz/model.ifc", etag: "e3" }); // 新增無紀錄
    await waitFor(() => watcher!.getStatus().triggered_total === 1, 5000);
    expect(received.length).toBe(1);
    expect(received[0].body.external_model_version_id).toBe("zzz"); // 只觸發新增者（payload 不變）
  });
```

對「同物件後續輪不再觸發」（`:242-254`）：原語意（同 key 同 etag 後續輪 `prev===etag` continue）**不依賴 baseline，照舊可保留**；僅須確認其 `makeWatcher` 不傳 `isLedgered`（走預設全未落帳），首輪觸發後 `seen` 命中、後續輪不再觸發——若該 it 原本斷言「首輪不觸發、第二輪才觸發」才需改成「首輪即觸發、後續輪不再觸發」。**執行者先 Read 該 it 確認它斷言什麼再決定改不改**（若它只驗 `prev===etag` 去重、與 baseline 無關則零改）。

跑確認 FAIL：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/bim-review-coordinator
npx vitest run tests/minio-watcher-loop.test.ts -t "僅新增無紀錄" 2>&1 | tail -20
# 預期：新 it FAIL（watcher 尚未支援 isLedgered）
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
      new Response(JSON.stringify({ bucket: "bim-control", prefix: "洲際好宅/", folders: [{ prefix: "root/", has_source_ifc: false }], objects: [], count: 0 }), { status: 200 }),
    );
    const res = await coordinatorClient.getMinioFolder("洲際好宅/");
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("delimiter=%2F"), expect.anything());
    expect(res.folders.map((f) => f.prefix)).toEqual(["root/"]);
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
export interface MinioFolderNode {
  prefix: string;
  has_source_ifc: boolean; // spec §2.5 第 5 點 folder badge（後端 probe 計算，前端不臆測）
}

export interface MinioFolderListing {
  bucket: string | null;
  prefix: string;
  folders: MinioFolderNode[];
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

> **本 task 拆成 7-pre → 7a → 7b → 7c 四個可獨立驗證的小步（task-decomposition blocker 修正；原 7a 把「先寫全測試」與「改寫全部 state/effect/JSX」塞同一步、估 20-30 分鐘超上限）。** 整個 `MinioDataPage` 重寫過大、無法在單一 2-5 分鐘步驟完成且中間態不可驗證。執行者**依序**做 7-pre → 7a → 7b → 7c，**每步各跑對應 `it`、各自 commit**（共四個 commit），確保任何步失敗都可獨立 revert：
>
> - **7-pre＝只寫測試檔（不動 `pages.tsx`，全 FAIL，可整步 revert）。** 把下方「重寫前端測試斷言」的整份 `MinioDataPage.test.tsx`（9 個 it 全部，含 7a/7b/7c 對應）一次寫入，**此時 `pages.tsx` 尚未改** → 跑整檔應**多數/全 FAIL**（getMinioFolder 未被用、無 chip/trigger testid）。這是 TDD 的 RED：測試先行、可獨立 revert（純 test 檔、不影響 runtime）。commit message：`plan: 7-pre MinioDataPage 測試先行（9 it 全 RED，pages.tsx 未動）`。
> - **7a＝逐層資料夾殼 JSX**（loading / error / empty 兩態 / 上一層鈕 / `sortedFolders` 資料夾鈕 / `folder.objects` 列含 role label + 三段 badge；**含『含 source IFC』資料夾 badge**）。**不含 chip、不含觸發鈕**（下方 JSX 骨架的 `[7b/7c HERE]` 段先用 `{false && (...)}` 包住或註解）。對應 test `it`：「[7a] 頂層顯示 folders…」「[7a] getMinioFolder reject → 顯誠實錯誤…」「[7a] MinIO 未設定…empty 態 (a)」「[7a] 已設定但當前 prefix 空…empty 態 (b)」「[7a] 頁首保留…誠實字樣」「[7a] 資料夾（遞迴）含 .ifc → 顯『含 source IFC』badge」。跑 `-t "7a"` 應全 PASS、其餘仍 FAIL。
> - **7b＝ledger chip 整合**（解開 JSX 骨架的 chip 行 `minio-chip-${idk}`；`getConversionRecords` 讀取 + 內聯 `ledgerChipStatus` 已在最小實作的 hooks 區）。對應 test `it`：「[7b][7c] 葉層 .ifc：…ledger chip…」「[7b][7c] 無 ledger 紀錄的 .ifc → chip 顯『未轉』…」「[7b] 會呼叫 getConversionRecords…」。
> - **7c＝觸發鈕 intent→confirm**（解開 JSX 骨架的觸發鈕行 `minio-trigger-${idk}` + 底部 `IntentDialog`；`pendingKey`/`confirmTrigger`/`triggerErr` 已在 hooks 區）。對應 test `it`：「[7b][7c] 葉層 .ifc：…觸發鈕…」（斷言 `minio-trigger-*` testid 存在）。
>
> 7-pre 一次寫全測試（RED）；7a/7b/7c 各解開 JSX 骨架對應段，每步重跑該步 `it` 由 FAIL 轉 PASS、其餘步 `it` 仍 FAIL 屬正常。四步全做完後整檔應全 PASS。

> **spec-alignment 補強（§2.5 point 5 / §8 line 211：『含 source IFC』資料夾 badge）：** spec §2.5 第 5 點為**獨立硬 AC（AC-badge 之外另立）**——「資料夾（遞迴）直屬有 `.ifc` 葉物件 → 標一枚輕量 badge『含 source IFC』；不在資料夾層宣稱『已轉/可轉』」。本 task 必須涵蓋。**判定資料來源（誠實限制）：** Delimiter list 的 `CommonPrefixes` **只回 prefix 字串、不含其下是否有 `.ifc`**，前端**不可臆測**。實作方式＝後端在 `listMinioFolder` 回應的每個 folder 附 `has_source_ifc: boolean`（對該 prefix 以 `Prefix=<folder>` 不帶 Delimiter 各發一次 list、`some(k => k.endsWith(".ifc"))`；此為 §2.3「要顯示子樹資訊須再發 list」的等效成本，**僅對 folder badge 這一項付出**）。**注意：此 badge 的 `folders` 物件陣列型別（`Array<{ prefix: string; has_source_ifc: boolean }>`）已在 Task 1（1a/1b/1c 完成後鎖定為最終版）、Task 2 route 透傳、Task 6 前端 `MinioFolderListing.folders` 就緒——`has_source_ifc` 由後端 probe 計算。** 執行者照本 plan 順序做完 Task 1/2/6 後，7a **直接消費**此型別、**無需回頭修改任何已 commit 的 Task**（見下方「7a 前置：folders 帶 has_source_ifc」明確聲明不回補）。若維護者評估「對每個 folder 再發一次 list」成本不可接受，**唯一可接受的替代**是把此 badge 標為 `NOT BUILT`（誠實鐵律：不可臆測），但 spec 已升為硬 AC，預設**做出來**。
>
> **7a 前置：folders 帶 has_source_ifc（Task 1/2/6 已就緒、7a 直接用、不回補）**
> - **重要（cross-task 修正）：Task 1/2/6 的程式碼片段與測試 fixture 原本就已是物件陣列 `Array<{ prefix: string; has_source_ifc: boolean }>`（最終型別，Task 1 已鎖定並聲明「無需回頭修改」）。本段 NOT 要求回去改任何已 commit 的 Task 1/2/6**——它們做完即是物件陣列；7a 只是「接力使用」此型別，不存在「回補」動作。若執行者照本 plan 順序做完 Task 1（1a/1b/1c）、Task 2、Task 6，`folders` 已是物件陣列、`has_source_ifc` 已由後端 probe 填好，7a 直接消費即可。
> - 佐證型別已對齊：Task 1 測試第 99 行 `res.folders.map((f) => f.prefix)`、Task 2 測試 `res.body.folders.map((f: { prefix: string }) => f.prefix)`、Task 6 fixture `folders: [{ prefix: "root/", has_source_ifc: false }]` 全為物件陣列形式——三處一致、無字串陣列殘留。
> - 本階段前端 `sortedFolders`（最小實作已給）對 `f.prefix` 做 `localeCompare('zh-TW')`，資料夾鈕內容 `f.prefix` + 條件 badge（`f.has_source_ifc && <span data-testid={`minio-folder-badge-${f.prefix}`} className="ec-prov artifact">{t("含 source IFC", "has source IFC")}</span>`）。

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`MinioDataPage` `:1185-1297`、刪 `buildMinioTree` `:1157-1171`、empty 態文案 `:1232-1235`、頁首字樣 `:1214-1216` 改「逐層」；資料夾鈕加『含 source IFC』badge）
- Modify: `web-viewer-sample/src/console/MinioDataPage.test.tsx`（重寫斷言：folders 逐層 + 資料夾『含 source IFC』badge + chip + 觸發鈕；「不呼叫 getConversionRecords」→ 改為「會呼叫」）

**Steps:**

- [ ] 重寫前端測試斷言（先表達新行為，三階段共用一份）。把 `web-viewer-sample/src/console/MinioDataPage.test.tsx` 整檔改為以 `getMinioFolder` 為主、含資料夾 badge、chip 與觸發鈕、含「會呼叫 getConversionRecords」（注意：`folders` fixture 為物件陣列 `[{ prefix, has_source_ifc }]`）：

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

  it("[7a] 頂層顯示 folders（資料夾節點），不再用 buildMinioTree 攤平", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "",
      folders: [{ prefix: "洲際好宅/", has_source_ifc: false }, { prefix: "東勢區許良宇紀念圖書館/", has_source_ifc: true }],
      objects: [], count: 0,
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("洲際好宅");
    expect(container.textContent).toContain("東勢區許良宇紀念圖書館");
  });

  it("[7a] 資料夾（遞迴）含 .ifc → 顯『含 source IFC』badge；不含則不顯（spec §2.5 第 5 點，獨立 AC）", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "",
      folders: [{ prefix: "東勢區許良宇紀念圖書館/", has_source_ifc: true }, { prefix: "annotations/", has_source_ifc: false }],
      objects: [], count: 0,
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    // 含 .ifc 的資料夾旁有 badge；不含的資料夾旁無 badge（用 testid 精準定位避免誤判）。
    expect(container.querySelector('[data-testid="minio-folder-badge-東勢區許良宇紀念圖書館/"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="minio-folder-badge-annotations/"]')).toBeNull();
    expect(container.textContent).toContain("含 source IFC");
  });

  it("[7b][7c] 葉層 .ifc：顯示來源 IFC role + 三段 badge + ledger chip + 觸發鈕", async () => {
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

  it("[7b][7c] 無 ledger 紀錄的 .ifc → chip 顯『未轉』、觸發鈕在", async () => {
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

  it("[7a] MinIO 未設定（count=0 + note）→ empty 態 (a)：顯『MinIO 未設定』文案", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: null, prefix: "", folders: [], objects: [], count: 0, note: "MinIO watch 未設定（未取得）",
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toMatch(/未設定|未取得/);
  });

  it("[7a] 已設定但當前 prefix 空（folders=[] objects=[] 無 note）→ empty 態 (b)：顯『此層無物件』非『未設定』", async () => {
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

  it("[7a] getMinioFolder reject → 顯誠實錯誤 + 重試鈕，不假裝有資料", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockRejectedValue(new Error("coordinator /api/minio/objects -> 502 Bad Gateway"));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("/api/minio/objects");
  });

  it("[7a] 頁首保留『唯讀 intake 來源視圖，非 metadata 權威』誠實字樣", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({ bucket: "bim-control", prefix: "", folders: [], objects: [], count: 0 });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toMatch(/唯讀.*intake.*來源|唯讀.*來源視圖/);
  });

  it("[7b] 會呼叫 getConversionRecords（chip 需 ledger，§2.5 第 6 點）", async () => {
    const spy = vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({ bucket: "bim-control", prefix: "", folders: [], objects: [], count: 0 });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(spy).toHaveBeenCalled();
  });
});
```

- [ ] **7-pre 跑確認失敗（RED；pages.tsx 尚未動）：**

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/web-viewer-sample
npx vitest run src/console/MinioDataPage.test.tsx 2>&1 | tail -25
# 預期：多數/全 FAIL（getMinioFolder 未被用、無 chip/trigger testid）
```

- [ ] **7-pre commit（只有 test 檔，全 RED，可獨立 revert）：**

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
git add web-viewer-sample/src/console/MinioDataPage.test.tsx
git commit -m "$(cat <<'EOF'
plan: 7-pre MinioDataPage 測試先行（9 it 全 RED，pages.tsx 未動）

逐層資料夾 + chip + 觸發 + 四態斷言；TDD RED，下一步 7a 起分階段轉 GREEN。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] 最小實作（7a 起）：在 `web-viewer-sample/src/console/pages.tsx` 改寫 `MinioDataPage`（`:1185-1297`）。刪除 `buildMinioTree`（`:1157-1171`）與 `MinioTree` type alias（`:1155`）。新 `MinioDataPage` 邏輯（hooks 區一次放齊，JSX 骨架 7a 先註解 `[7b/7c HERE]` 段、7b/7c 漸進解開）：

> **跨 monorepo import 已知會失敗（buildability，務必照下面寫）：** `web-viewer-sample/tsconfig.json` 的 `include` 只含 `["src", "src/assets"]`、`moduleResolution: "bundler"`，跨 package 路徑 import `../../../bim-review-coordinator/src/services/ledgerChipStatus` 在 `tsc --noEmit` **必報 TS2307/TS6059**。**最小實作直接用下方內聯的 `ledgerChipStatus` 同義函式（與 Task 4 後端純函式邏輯逐字相同），不要走跨 package import。** Task 4 的後端函式僅供後端單元測試與後端共用，前端**刻意複製 3 行**（避免跨 tsconfig project boundary）。

```tsx
// ledger chip 狀態映射（與後端 ledgerChipStatus.ts 同義；前端內聯避免跨 monorepo tsconfig boundary）。
// records 來自 getConversionRecords()；無紀錄 → 'untracked'（顯「未轉（含 baseline）」），不臆測。
function ledgerChipStatus(
  idempotencyKey: string,
  records: ReadonlyArray<{ idempotency_key: string; status: string }>,
): string {
  const hit = records.find((r) => r.idempotency_key === idempotencyKey);
  return hit ? hit.status : "untracked";
}

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
  const [triggerBusy, setTriggerBusy] = useState(false);                         // confirm 進行中（IntentDialog busy）

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
  // folders 為 Array<{ prefix; has_source_ifc }>（7a 前置已把型別由 string[] 改物件陣列）。
  const sortedFolders = folder ? [...folder.folders].sort((a, b) => a.prefix.localeCompare(b.prefix, "zh-TW")) : [];

  // IntentDialog onConfirm 帶使用者填的 reason（uncontrolled textarea）；dialog 本身不關、不顯錯誤，
  // 由本 caller 負責：成功才 setPendingKey(null) 關 dialog，失敗 setTriggerErr 經 actionErr 顯示、解除 busy（與既有
  // ConversionSchedulingPage 用法、spec §6.1 IntentDialog 契約一致）。
  const confirmTrigger = async (reason: string) => {
    if (!pendingKey) return;
    setTriggerErr(null); setTriggerBusy(true);
    try {
      const res = await coordinatorClient.conversionTrigger(pendingKey, reason || "manual trigger from #minio");
      setChipOverride((p) => ({ ...p, [res.idempotency_key]: res.status })); // patch chip 為 detected/queued
      setPendingKey(null);                                       // 成功才關 dialog
    } catch (e) { setTriggerErr(String(e)); }                    // 失敗顯 inline error（actionErr）、chip 不變、dialog 不關
    finally { setTriggerBusy(false); }
  };
  // ===== JSX 骨架（可直接複製）=====
  // 三階段共用同一份 return。執行者依 7a→7b→7c 漸進填：
  //   7a＝先放到「[7b/7c HERE]」標記之前的整份殼（頁首/loading/err/empty 兩態/populated/資料夾鈕+badge/role+三段 badge）；
  //       在 source_ifc 物件列「[7b/7c HERE]」處先「不放」chip 與觸發鈕（留空），跑 [7a] it 應全 PASS。
  //   7b＝在「[7b/7c HERE]」處補上 chip <span data-testid={`minio-chip-${idk}`}>。
  //   7c＝在 chip 後再補觸發鈕 <Btn data-testid={`minio-trigger-${idk}`}> 與底部 IntentDialog。
  // 為避免「分階段時 JSX 半成品編譯不過」，下方骨架已把三段都放齊；執行者 7a 階段可暫時把 chip/trigger 兩行註解掉、
  // 7b 解註解 chip、7c 解註解 trigger（或直接三段一次放齊、靠各階段 it 驗證遞進），二擇一皆可。
  const showFolderEmpty = !!folder && folder.folders.length === 0 && folder.objects.length === 0;
  return (
    <div>
      <PageHead
        crumb={t("M · MinIO 資料", "M · MinIO data")}
        title={t("MinIO 資料", "MinIO data")}
        sub={t(
          "真 MinIO bim-control bucket 唯讀逐層資料夾導覽（像 MinIO 網頁，point-and-list，S3 Delimiter）。唯讀 intake 來源視圖，非 metadata 權威——權威在 bim-control·MySQL。",
          "Read-only level-by-level folder browsing of the real MinIO bim-control bucket (point-and-list like the MinIO web UI, S3 Delimiter). Read-only intake source view, not the metadata authority — that lives in bim-control·MySQL.",
        )}
      />
      {/* 麵包屑：目前層 prefix（空＝bucket 根）＋ 上一層鈕（prefix 非空才顯） */}
      <div className="ec-row" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
        {prefix ? (
          <Btn data-testid="minio-go-up" onClick={goUp}>{t("⬑ 上一層", "⬑ Up")}</Btn>
        ) : null}
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-4)" }}>
          {prefix || "/"}
        </span>
      </div>

      {loading ? (
        <p className="ec-note">{t("載入中…（GET /api/minio/objects）", "Loading… (GET /api/minio/objects)")}</p>
      ) : err ? (
        // error 態：誠實顯原因 + 可重試（不假裝有資料）。
        <div className="ec-error">
          <p>{t("讀取 MinIO 失敗：", "Failed to read MinIO: ")}{err}</p>
          <Btn data-testid="minio-tree-retry" onClick={() => void load(prefix)}>{t("重試", "Retry")}</Btn>
        </div>
      ) : folder?.note ? (
        // empty 態 (a)：MinIO 未設定（後端回 note，200）。
        <p className="ec-note">{t("MinIO 未設定（", "MinIO not configured (")}{folder.note}{")"}</p>
      ) : showFolderEmpty ? (
        // empty 態 (b)：已設定但當前 prefix 無物件——不可誤用「未設定」文案。
        <p className="ec-note">{t("此層無物件（資料夾為空）。", "This level has no objects (empty folder).")}</p>
      ) : (
        // populated：資料夾鈕（含 source IFC badge）＋ 當層直屬物件列。
        <div>
          {sortedFolders.length > 0 ? (
            <div className="ec-folder-list">
              {sortedFolders.map((f) => (
                <div key={f.prefix} className="ec-row" style={{ gap: 6, alignItems: "center" }}>
                  <Btn onClick={() => enterFolder(f.prefix)}>{f.prefix}</Btn>
                  {f.has_source_ifc ? (
                    <span data-testid={`minio-folder-badge-${f.prefix}`} className="ec-prov artifact">
                      {t("含 source IFC", "has source IFC")}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {folder && folder.objects.length > 0 ? (
            <ul className="ec-obj-list">
              {folder.objects.map((obj) => {
                const idk = obj.idempotency_key;
                const st = chipOverride[idk] ?? ledgerChipStatus(idk, records);
                return (
                  <li key={obj.key} className="ec-row" style={{ gap: 6, alignItems: "center" }}>
                    {/* role label（與 intake 三段脫鉤，純副檔名） */}
                    <span className={`ec-prov ${obj.role === "source_ifc" ? "asbuilt" : obj.role === "parsed_usdc" ? "artifact" : ""}`}>
                      {obj.role === "source_ifc"
                        ? t("來源 IFC", "source IFC")
                        : obj.role === "parsed_usdc"
                          ? t("已轉 USDC", "parsed USDC")
                          : t("其他", "other")}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{obj.key}</span>
                    {/* 三段語意 badge：有才顯（≥3 段才有，malformed 不掛） */}
                    {obj.project_display_name ? <span className="ec-prov">{obj.project_display_name}</span> : null}
                    {obj.category ? <span className="ec-prov">{obj.category}</span> : null}
                    {obj.version ? <span className="ec-prov">{obj.version}</span> : null}
                    {/* [7b/7c HERE] 僅 source_ifc 物件掛 chip（7b）＋ 觸發鈕（7c） */}
                    {obj.role === "source_ifc" ? (
                      <>
                        {/* 7b：ledger 衍生狀態 chip */}
                        <span data-testid={`minio-chip-${idk}`} className="ec-prov">
                          {CHIP_LABEL[st] ?? st}
                        </span>
                        {/* 7c：一鍵觸發鈕（僅未轉/failed 可按；ready/進行中 disabled） */}
                        <Btn
                          data-testid={`minio-trigger-${idk}`}
                          disabled={!["untracked", "failed"].includes(st)}
                          onClick={() => { setTriggerErr(null); setPendingKey(obj.key); }}
                        >
                          {t("觸發轉檔", "Trigger")}
                        </Btn>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      )}

      {/* 7c：intent→confirm 對話框。IntentDialog 真實 props（spec §6.1 / IntentDialog.tsx:9-21）＝
          open / title / cost / onConfirm(reason) / onCancel / busy / actionErr——無 body / confirmLabel；
          確認文字由元件內建、reason 來自元件內 uncontrolled textarea。物件 key 與失敗提示分別走 cost / actionErr。 */}
      <IntentDialog
        open={!!pendingKey}
        title={t("確認觸發轉檔", "Confirm trigger conversion")}
        cost={t("對此物件觸發轉檔 intake：", "Trigger conversion intake for this object: ") + (pendingKey ?? "")}
        busy={triggerBusy}
        actionErr={triggerErr}
        onConfirm={(reason) => void confirmTrigger(reason)}
        onCancel={() => { setPendingKey(null); setTriggerErr(null); }}
      />

      {/* [7a] 保留底部「Bucket layout（規約說明 — 示意，非實況）」DEMO panel（沿用 :1276-1287，標 DEMO 不變）。 */}
      <SectionTitle hint={t("規約說明 — 示意，非實況", "convention reference — illustrative, not live")}>
        {t("Bucket layout（DEMO DATA）", "Bucket layout (DEMO DATA)")}
      </SectionTitle>
      {/* ↑ 把原 :1276-1287 DEMO panel 內容原樣保留於此（內容不動，僅確認 prov=demo / DEMO 標示仍在）。 */}
    </div>
  );
}
```

> **JSX 骨架說明（執行者照做要點）：**
> - 上方 `return(...)` 是**可直接複製貼上的完整骨架**，已含 7a（殼＋資料夾鈕＋`has_source_ifc` badge＋role＋三段 badge＋四態）、7b（`minio-chip-${idk}`）、7c（`minio-trigger-${idk}`＋`IntentDialog`）。分階段 commit 時，7a 可先把 `<>...chip...trigger...</>` 那段用 `{false && (...)}` 包住或註解掉，7b 解開 chip、7c 解開 trigger；或一次放齊靠各階段 `it` 驗證遞進（兩種皆可，見前面拆階段說明）。
> - `IntentDialog` / `PageHead` / `SectionTitle` / `Btn` / `t` 皆為 `pages.tsx` 既有元件/helper（沿用既有 import，勿新造）。`IntentDialog` 的真實簽名已對齊（`IntentDialog.tsx:9-21` / spec §6.1）＝`open: boolean` / `title: string` / `cost: string` / `onConfirm: (reason: string) => void | Promise<void>` / `onCancel: () => void` / `busy?: boolean` / `actionErr?: string | null`——**無 `body` / `confirmLabel`**；確認鈕文字由元件內建、`reason` 來自元件內 uncontrolled textarea、dialog 不自動關（成功才由 caller `setPendingKey(null)`）、錯誤由 caller 經 `actionErr` 傳入顯示。上方骨架已照此寫，**executor 直接複製即可、無需再對齊**。
> - chip 顏色沿用既有 `ec-prov` class（與 `roleClass` 配色慣例一致）；資料夾 badge 用 `ec-prov artifact`。
> - 頁首 sub 文案已把舊「呈現 bucket 三層結構（專案 → 種類 → 版本）」改為「逐層資料夾導覽（像 MinIO 網頁，point-and-list）」並保留「唯讀 intake 來源視圖，非 metadata 權威」誠實字樣（對應 [7a]「頁首保留誠實字樣」it）。
> - empty 態嚴格分兩種：`folder?.note` 有 → (a)「MinIO 未設定」；無 note 且 `folders=[] && objects=[]`（`showFolderEmpty`）→ (b)「此層無物件」，**不可混用**（對應 AC-honesty 與 [7a] 兩個 empty it）。

- [ ] 7a 跑確認（資料夾殼 + badge + 四態 PASS；chip/trigger 相關 it 仍 FAIL 屬正常）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/web-viewer-sample
npx vitest run src/console/MinioDataPage.test.tsx -t "7a" 2>&1 | tail -20
# 預期：所有 [7a] it PASS
```

- [ ] 7a commit（資料夾殼 + 含 source IFC badge）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/MinioDataPage.test.tsx
git commit -m "$(cat <<'EOF'
plan: MinioDataPage 7a 逐層資料夾殼 + 含 source IFC badge（無 chip/trigger）

buildMinioTree 退役；folders 逐層（localeCompare zh-TW）+ 上一層鈕 + 四態 + 資料夾『含 source IFC』badge。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] 7b 跑確認（chip 整合 PASS；trigger it 仍 FAIL 屬正常）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/web-viewer-sample
npx vitest run src/console/MinioDataPage.test.tsx -t "7b" 2>&1 | tail -20
# 預期：所有 [7b] it PASS
```

- [ ] 7b commit（ledger chip 整合）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/MinioDataPage.test.tsx
git commit -m "$(cat <<'EOF'
plan: MinioDataPage 7b .ifc 列掛 ledger chip（讀 getConversionRecords + 內聯 ledgerChipStatus）

無紀錄顯『未轉（含 baseline）』，不臆測。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] 7c 跑確認 + 全檔回歸（觸發鈕 intent→confirm；整檔全 PASS）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/web-viewer-sample
npx vitest run src/console/MinioDataPage.test.tsx 2>&1 | tail -20
# 預期：整檔 9 it 全 PASS（7a 6 個 + 7b 含 chip + 7c 觸發鈕；標籤交集 it 兩階段共用）
```

- [ ] 跑型別檢查（vite build 不跑 tsc，務必另跑）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/web-viewer-sample
npx tsc --noEmit 2>&1 | tail -20
# 預期：無 error（已用內聯 ledgerChipStatus，無跨 monorepo import；若仍見 TS2307 ledgerChipStatus，表示誤加了跨 package import，刪掉改用內聯函式）
```

- [ ] 7c commit（觸發鈕 intent→confirm + tsc 綠；本 task 第三個也是最後一個 commit）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/MinioDataPage.test.tsx
git commit -m "$(cat <<'EOF'
plan: MinioDataPage 7c .ifc 觸發鈕 intent→confirm + patch chip

conversionTrigger 帶 x-dev-token；成功 patch chip 為 detected/queued、失敗 inline error 不變 chip。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 前端 `ConversionSchedulingPage` baseline 揭露 + 一鍵觸發列

對應 spec §3.2、AC5、AC6（含 AC6(a) 說明文案 + AC6(b) 一鍵鈕）。把擠在單一 Field（`pages.tsx:866`）的 baseline/seen/triggered/skipped 拆成獨立 Field + 解釋文案（`baseline_count` 標「首輪基準、by-design 不自動轉檔已被 §3.4 取代→改標『首輪 list 到的規約檔數』」；明示一致性基準＝可解析 IFC 數非物件總數）；ledger 列對「未轉/failed」加觸發鈕。

> **AC6(a) vs AC6(b) 界線（spec-alignment 修正，兩者不重複實作）：** spec AC6 拆兩半——**(a) 保留說明文案**列兩條 spec 認可補救：(i) **重新上傳改 etag** → watcher 下一輪自動觸發、(ii) **手動 webhook `POST /api/external/ifc-ready`**（**僅文字說明、不實作 UI 觸發**）；**(b) 實際可點擊入口＝一鍵觸發鈕**（走 `POST /api/conversion/trigger`，**非** `/api/external/ifc-ready`）。本 task 必須**同時**做出 (a) 的說明文案與 (b) 的鈕，且不可把 (a) 的 webhook 路徑做成按鈕（會與 (b) 重複、違反 spec 界線）。下方測試含一個專驗 (a) 文案存在的 it。

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

  it("AC6(a)：保留兩條 spec 認可補救說明文案（重新上傳改 etag / 手動 webhook ifc-ready，僅文字不做成鈕）", async () => {
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
    // (i) 重新上傳改 etag 的說明；(ii) 手動 webhook POST /api/external/ifc-ready 的說明（純文字）。
    expect(container.textContent).toMatch(/重新上傳|改.*etag/);
    expect(container.textContent).toContain("/api/external/ifc-ready");
    // 誠實界線：webhook 補救僅文字、不得是可點擊觸發鈕（避免與 AC6(b) /api/conversion/trigger 重複）。
    expect(container.querySelector('[data-testid="conv-webhook-ifc-ready-trigger"]')).toBeNull();
  });

  it("ledger 列對未轉/failed 紀錄顯一鍵觸發鈕（object_key 存在時）", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: true, bucket: "bim-control", prefix: "", interval_seconds: 60, last_poll_at: null, poll_count: 0, last_error: null, baseline_count: 0, seen_count: 0, triggered_total: 0, skipped_malformed_total: 0, last_triggered: [] } as never);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({
      // object_key 必填且非 null——觸發鈕的顯示條件為 r.status === "failed" && r.object_key，缺它則鈕永不顯示（測試會偽 PASS）。
      count: 1, items: [{ idempotency_key: "mw_f", project_id: "p", project_display_name: "x", category: "main", external_model_version_id: "v1", conversion_job_id: null, status: "failed", object_key: "x/main/v1/model.ifc", usdc_key: null, coverage_report: null, detected_at: "2026-06-24T00:00:00Z", updated_at: "2026-06-24T00:00:00Z" }],
    });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="conv-ledger-retry-mw_f"]')).toBeTruthy();
  });

  it("ledger 列對 failed 但 object_key 為 null 的紀錄 → 不顯觸發鈕（無法重建 presigned，誠實不給假入口）", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: true, bucket: "bim-control", prefix: "", interval_seconds: 60, last_poll_at: null, poll_count: 0, last_error: null, baseline_count: 0, seen_count: 0, triggered_total: 0, skipped_malformed_total: 0, last_triggered: [] } as never);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({
      count: 1, items: [{ idempotency_key: "mw_n", project_id: "p", project_display_name: "x", category: "main", external_model_version_id: "v1", conversion_job_id: null, status: "failed", object_key: null, usdc_key: null, coverage_report: null, detected_at: "2026-06-24T00:00:00Z", updated_at: "2026-06-24T00:00:00Z" }],
    });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="conv-ledger-retry-mw_n"]')).toBeNull();
  });
```

注意：「ledger 列…顯一鍵觸發鈕」這個 it 的觸發鈕需 `object_key`，故 `ConversionRecord` 前端型別（`coordinatorClient.ts:230-242`）須補 `object_key: string | null;` 欄（後端 record 本就有，前端原省略）。**上方 `mw_f` failed fixture 已含 `object_key: "x/main/v1/model.ifc"`（非 null），對應觸發鈕顯示條件 `r.status === "failed" && r.object_key`；第二個 it 用 `object_key: null` 驗「無 object_key 不顯鈕」的反向情境（誠實：Phase 1 ledger object_key 可能為 null，此時無法重建 presigned，不給假入口）。** 把 `object_key` 加進前端型別。

- [ ] 跑確認失敗：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec/web-viewer-sample
npx vitest run src/console/ConversionSchedulingPage.test.tsx 2>&1 | tail -20
# 預期：新增三 it FAIL（無 conv-baseline-count testid / 無一致性文案 / 無 AC6(a) 補救文案 / 無 retry 鈕）
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

  4. **AC6(a) 說明文案（純文字，不做成鈕）：** 在 watcher 面板（或 baseline 區附近）加一段 `ec-note` 列兩條 spec 認可補救（與 AC6(b) 一鍵鈕並存、不重複）：

```tsx
              <p className="ec-note">
                {t("既有 baseline 檔的兩條補救：", "Two remediations for existing baseline files: ")}
                {t("(i) 重新上傳改變 etag → watcher 下一輪自動觸發；", "(i) re-upload to change the etag → the watcher auto-triggers on the next poll; ")}
                {t("(ii) 手動 webhook 直打 ", "(ii) manual webhook to ")}<code>POST /api/external/ifc-ready</code>
                {t("（帶 webhook secret + presigned GET URL，僅此說明、不提供 UI 觸發）。 §3.4 後既有未轉檔多半已由 watcher 自動補轉；下方『重新觸發』鈕用於 retry failed。", " (with webhook secret + presigned GET URL; description only, no UI trigger). After §3.4 most existing unconverted files are auto-enrolled by the watcher; the 'Re-trigger' button below is for retrying failed jobs.")}
              </p>
```

  注意：此段是**純文字**，**不可**把 `/api/external/ifc-ready` 包成可點擊鈕（那會與 AC6(b) 的 `/api/conversion/trigger` 重複、違反 spec 界線；測試 `conv-webhook-ifc-ready-trigger` testid 必須查無）。

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

- [ ] 改斷言：`console.test.tsx` 有 6 個受影響的 `MinioDataPage` `it`，逐一給 before/after（**只換 mock 目標與斷言文字，保持 describe 結構**；executor 用下方 old/new 片段精準替換）。注意：所有 client-render（`createRoot`）的 `it` 都要**加一行 `vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });`**，否則 7b 的 chip effect 會打真 fetch 報錯。

  **(1) SSR 首幀（`:394-398`，`KitGpuFleetPage` 那個 it 結尾的 MinioDataPage 片段）：**
  ```ts
  // OLD
    const minio = renderToString(<MinioDataPage />);
    expect(minio).toContain("MinIO 資料");
    expect(minio).toContain("bim-control");
    expect(minio).toContain("model.usdc");
  // NEW（SSR 首幀＝loading 殼，無 ledger/folder 結果；只斷言誠實字樣 + 逐層用語，刪 bim-control/model.usdc 三層斷言）
    const minio = renderToString(<MinioDataPage />);
    expect(minio).toContain("MinIO 資料");
    expect(minio).toMatch(/唯讀.*來源視圖|逐層/);
  ```

  **(2) SSR 首幀 loading 態（`:451-462`，「接真 MinIO list proxy」it）：** 此 it 斷言 loading 文案 + DEMO panel 規約示意。逐層後 loading 文案仍在、底部 DEMO panel（`bim-control` 規約示意 / `model.usdc` / 「示範資料」）**保留不變**（Task 7 7a 保留該 DEMO panel）。**唯一要改**：刪掉對「三層」語意的隱含依賴——本 it 實際只斷言 `載入` / `/api/minio/objects` / `bim-control` / `示範資料` / `model.usdc`，這些都來自 loading 文案與底部 DEMO panel，**逐層後仍成立、可零改**。executor 先跑此 it，若 PASS 就不動；若因頁首文案改字而 FAIL，只調整 `expect(html).toContain("/api/minio/objects")` 之外的字樣。

  **(3) client-render populated（`:538-571`）：** mock 由 `getMinioObjects` 改 `getMinioFolder`，斷言由「三段節點」改「資料夾名」。
  ```ts
  // OLD
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({
      bucket: "bim-control", count: 1,
      objects: [{ key: "松風庵/root/main/000001/model.ifc", etag: "abc", role: "source_ifc",
        project_id: "mv_1a2b3c4d", project_display_name: "松風庵", category: "main", version: "000001" }],
    });
    // ...
    expect(html).toContain("松風庵"); expect(html).toContain("main"); expect(html).toContain("000001");
    expect(html).toContain("來源 IFC"); expect(html).toContain("bucket=bim-control");
    expect(html).not.toContain("載入中…（GET /api/minio/objects）");
  // NEW（首幀 prefix="" → 回 folders；斷言資料夾名「松風庵」，非三段葉節點）
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "",
      folders: [{ prefix: "松風庵/", has_source_ifc: true }], objects: [], count: 0,
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    // ...
    expect(html).toContain("松風庵");                 // 資料夾節點名
    expect(html).not.toContain("載入中…（GET /api/minio/objects）");
  ```
  （標題若含「三層樹」字樣也一併改為「逐層資料夾」。）

  **(4) error 態（`:575-589`）：** 只換 spy 目標，斷言文字（含 `/api/minio/objects` / `502 Bad Gateway` / `not 松風庵`）相容、保留。
  ```ts
  // OLD
    vi.spyOn(coordinatorClient, "getMinioObjects").mockRejectedValue(new Error("coordinator /api/minio/objects -> 502 Bad Gateway"));
  // NEW
    vi.spyOn(coordinatorClient, "getMinioFolder").mockRejectedValue(new Error("coordinator /api/minio/objects -> 502 Bad Gateway"));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
  ```

  **(5) empty 態（`:594-608`）：** 換 spy 目標；空態文案由「未取得 MinIO 物件（count=0）」改為逐層相容版。
  ```ts
  // OLD
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({ bucket: null, count: 0, objects: [] });
    // ...
    expect(html).toContain("未取得 MinIO 物件（count=0）");
  // NEW（bucket=null + 無 note → empty 態 (b)「此層無物件」；或補 note 測 (a)。此 it 取 (b)）
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({ bucket: "bim-control", prefix: "", folders: [], objects: [], count: 0 });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    // ...
    expect(html).toMatch(/此層|無物件|空/);
  ```
  （`not.toContain("松風庵")` / `not.toContain("載入中…")` 保留。）

  **(6) 重試（`:801-839`）：** 換 spy 目標（`mockRejectedValueOnce` + `mockResolvedValueOnce`），成功回 folders；斷言由三段改資料夾名。
  ```ts
  // OLD
    const spy = vi.spyOn(coordinatorClient, "getMinioObjects")
      .mockRejectedValueOnce(new Error("coordinator /api/minio/objects -> 502 Bad Gateway"))
      .mockResolvedValueOnce({ bucket: "bim-control", count: 1, objects: [{ key: "松風庵/root/main/000001/model.ifc", etag: "abc", role: "source_ifc", project_id: "mv_1a2b3c4d", project_display_name: "松風庵", category: "main", version: "000001" }] });
    // ...
    expect(html).toContain("松風庵"); expect(html).toContain("來源 IFC");
  // NEW
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const spy = vi.spyOn(coordinatorClient, "getMinioFolder")
      .mockRejectedValueOnce(new Error("coordinator /api/minio/objects -> 502 Bad Gateway"))
      .mockResolvedValueOnce({ bucket: "bim-control", prefix: "", folders: [{ prefix: "松風庵/", has_source_ifc: true }], objects: [], count: 0 });
    // ...
    expect(html).toContain("松風庵");                 // 重試成功 → 資料夾節點
    expect(html).not.toContain("502 Bad Gateway");
    expect(spy).toHaveBeenCalledTimes(2);
  ```
  （重試鈕 `data-testid="minio-tree-retry"` Task 7 7a 保留，故 `retry!.click()` 不變。）

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

> **E2E 改動以 before/after 片段給出（completeness 修正）。** 現有 `minio-closed-loop.spec.ts` 的 stub/beforeAll/body 都要改，散文無法照做，下面逐處給 old/new。**Delimiter 分支須依 `prefix` query 動態 roll-up**：把所有以 `prefix` 為前綴、再切一層後仍有後續 `/` 的 key 收斂成 `CommonPrefixes`，其餘（當層直屬）放 `Contents`。

- [ ] 改 S3 stub 支援 Delimiter（`startS3Stub`，`:56-68`）。在 `listObjectsXml` 之後加 `listFolderXml(prefix)`，並在 server handler 偵測 `delimiter`：

```ts
// 加在 listObjectsXml 之後：Delimiter='/' 語意——依 prefix roll-up 子前綴為 CommonPrefixes。
function listFolderXml(objs: S3Obj[], prefix: string): string {
  const folderSet = new Set<string>();
  const direct: S3Obj[] = [];
  for (const o of objs) {
    if (prefix && !o.key.startsWith(prefix)) continue;
    const rest = o.key.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash >= 0) folderSet.add(prefix + rest.slice(0, slash + 1)); // 子資料夾（roll-up）
    else direct.push(o);                                              // 當層直屬檔
  }
  const cps = [...folderSet].map((p) => `<CommonPrefixes><Prefix>${p}</Prefix></CommonPrefixes>`).join("");
  const contents = direct
    .map((o) => `<Contents><Key>${o.key}</Key><ETag>&quot;${o.etag}&quot;</ETag><Size>10</Size></Contents>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>bim-control</Name><IsTruncated>false</IsTruncated>${cps}${contents}</ListBucketResult>`;
}
```

```ts
// OLD（startS3Stub handler 的最後兩行 fallback）
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(listObjectsXml(s3State.objs));
// NEW（偵測 delimiter → 走 folder XML；解析 prefix query；否則維持遞迴 XML 供 watcher tick / has_source_ifc probe）
    const u = new URL(req.url ?? "/", "http://x");
    res.writeHead(200, { "Content-Type": "application/xml" });
    if (u.searchParams.get("delimiter")) {
      res.end(listFolderXml(s3State.objs, u.searchParams.get("prefix") ?? ""));
    } else {
      // 無 delimiter：listMinioObjects（watcher tick + trigger 取 etag + has_source_ifc probe）走遞迴攤平，
      // 但須尊重 prefix（has_source_ifc / trigger 用 Prefix=key 精準查）。
      const prefix = u.searchParams.get("prefix") ?? "";
      const subset = prefix ? s3State.objs.filter((o) => o.key.startsWith(prefix)) : s3State.objs;
      res.end(listObjectsXml(subset));
    }
```

注意：物件 GET（presigned `/bim-control/.../model.ifc`）的既有分支（`:59-62`）**保留不動**（在上面 fallback 之前）。

- [ ] 改 `beforeAll` 的 baseline 注入語意（`:127-129`）：§3.4 後 watcher 無 baseline 特例（既有即觸發），起始 state 直接放真實多層 fixture。

```ts
// OLD
    // 重置 S3 state：以一個 baseline 物件起始（watcher 首輪登記為 seen，不觸發 intake）。
    // 新物件（松風庵）於步驟 2 注入，確保 watcher 以 delta 偵測觸發 intake。
    s3State.objs = [{ key: "baseline/root/init/000000/model.ifc", etag: "base0" }];
// NEW（§3.4：既有無紀錄即自動觸發；放真實多層 fixture——一個版本層 model.ifc + 一個 chunk 海量子樹）
    s3State.objs = [
      { key: "東勢區許良宇紀念圖書館/root/main/000001/model.ifc", etag: "lib1" },
      { key: "洲際好宅/root/main/uuid-aaa/geometries_chunks/chunk_0.json", etag: "c0" },
      { key: "洲際好宅/root/main/uuid-aaa/geometries_chunks/chunk_1.json", etag: "c1" },
    ];
```

- [ ] 改測試主體（`:205-277`）。auto-enroll 後既有 model.ifc 自動 triggered，故**刪除原步驟 2「注入新物件」**（`:214-216`），其餘 poll 斷言保留。前端斷言由三層樹改逐層 + chip + 觸發。

```ts
// OLD（步驟 2，§3.4 後不需要，刪除整段）
      // 2) 注入新物件（≥3段 key，符合 watcher 規約）。baseline 已鎖，下一輪 watcher delta 偵測。
      //    松風庵/root/main/000001/model.ifc：4段，category=main（倒數二），version=000001（末段）。
      s3State.objs.push({ key: "松風庵/root/main/000001/model.ifc", etag: "shofuan1" });
// NEW：無（auto-enroll，既有檔即觸發；步驟 1 的 baseline poll 仍保留，步驟 3 的 triggered/records poll 改等 000001）
```

```ts
// OLD（步驟 4 起，#/minio 三層樹斷言 :234-247）
      await page.goto(`${coordinatorBase}/ui#/minio`);
      await expect(page.getByText("松風庵/", { exact: false }).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("來源 IFC", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("待產生", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.locator("body")).not.toContainText("已轉 USDC");
// NEW（逐層導覽：頂層資料夾鈕 → 點入洲際好宅逐層到 geometries_chunks 摺疊 → 點入圖書館版本層見 .ifc + chip + 觸發鈕）
      await page.goto(`${coordinatorBase}/ui#/minio`);
      // 頂層 7 個專案資料夾鈕（這裡注入 2 個專案；斷言兩個資料夾節點皆可見）。
      await expect(page.getByText("東勢區許良宇紀念圖書館/", { exact: false }).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("洲際好宅/", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
      // 點「洲際好宅/」逐層下行至 geometries_chunks（資料夾鈕點擊換 prefix；每層點一次）。
      await page.getByText("洲際好宅/", { exact: false }).first().click();
      await page.getByText("root/", { exact: false }).first().click();
      await page.getByText("main/", { exact: false }).first().click();
      await page.getByText("uuid-aaa/", { exact: false }).first().click();
      // geometries_chunks/ 摺成單一資料夾節點、chunk 不攤開（AC-D2）。
      await expect(page.getByText("geometries_chunks/", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("chunk_0.json", { exact: false })).toHaveCount(0);
      // 回頂層 → 進圖書館版本層見 model.ifc + 來源 IFC + chip + 觸發鈕。
      await page.goto(`${coordinatorBase}/ui#/minio`);
      await page.getByText("東勢區許良宇紀念圖書館/", { exact: false }).first().click();
      await page.getByText("root/", { exact: false }).first().click();
      await page.getByText("main/", { exact: false }).first().click();
      await page.getByText("000001/", { exact: false }).first().click();
      await expect(page.getByText("來源 IFC", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
      // chip + 觸發鈕（runtime idempotency_key=mw_<hash16>，用 data-testid 前綴定位）。
      await expect(page.locator('[data-testid^="minio-chip-mw_"]').first()).toBeVisible({ timeout: 15_000 });
      const triggerBtn = page.locator('[data-testid^="minio-trigger-mw_"]').first();
      await expect(triggerBtn).toBeVisible({ timeout: 15_000 });
      // 觸發 vertical slice：點鈕 → IntentDialog confirm → 真打 POST /api/conversion/trigger（x-dev-token=dev-token）。
      await triggerBtn.click();
      await page.getByRole("button", { name: /確認|confirm/i }).first().click();
      // 成功 → chip patch 為 已偵測/排隊（auto-enroll 可能已是 排隊；二者其一可見即可）。
      await expect(page.locator('[data-testid^="minio-chip-mw_"]').first()).toContainText(/已偵測|排隊/, { timeout: 15_000 });
      // 誠實鐵律：不得出現假 parsed USDC（stub 無 .usdc）。
      await expect(page.locator("body")).not.toContainText("已轉 USDC");
```

```ts
// OLD（步驟 5，#/conv :253-266 保留 ledger panel/啟用中斷言，補 baseline/triggered 拆分）
      await page.goto(`${coordinatorBase}/ui#/conv`);
      const ledgerPanel = page.getByTestId("conv-ledger-panel");
      await expect(ledgerPanel).toBeVisible({ timeout: 15_000 });
      await expect(ledgerPanel.getByText("000001", { exact: false })).toBeVisible({ timeout: 15_000 });
// NEW（補：baseline/triggered 各自可見 + 一致性文案；保留 ledger panel 000001 與 not「完成」）
      await page.goto(`${coordinatorBase}/ui#/conv`);
      await expect(page.locator('[data-testid="conv-baseline-count"]')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-testid="conv-triggered-total"]')).toBeVisible({ timeout: 15_000 });
      const ledgerPanel = page.getByTestId("conv-ledger-panel");
      await expect(ledgerPanel).toBeVisible({ timeout: 15_000 });
      await expect(ledgerPanel.getByText("000001", { exact: false })).toBeVisible({ timeout: 15_000 });
      await expect(ledgerPanel).not.toContainText("完成"); // 無假 ready（沿用既有不變量）
```

  - 截圖路徑由 `minio-closed-loop-*.png` 改 `minio-folderview-*.png`：把 `:249` 與 `:273` 的 `path:` 改為 `"../artifacts/e2e/minio-folderview-minio.png"` / `"../artifacts/e2e/minio-folderview-conv.png"`。

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
- Create: `openspec/changes/minio-folderview-and-baseline-disclosure/proposal.md`（承載 supersede 提案；內容見下方步驟逐字稿）
- Create: `openspec/changes/minio-folderview-and-baseline-disclosure/tasks.md`（對應本 plan 各 task；內容見下方步驟逐字稿）
- Create: `openspec/changes/minio-folderview-and-baseline-disclosure/specs/minio-fileserver-source/spec.md`（`#/minio` MODIFIED delta；逐字稿）
- Create: `openspec/changes/minio-folderview-and-baseline-disclosure/specs/minio-watch-auto-intake/spec.md`（watcher 觸發判定 MODIFIED delta；逐字稿）

**Steps:**

- [ ] 建新 openspec change 目錄承載 supersede delta（避免直接改 canonical spec 的 SHALL；照 repo openspec 慣例）：

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/minio-folderview-baseline-spec
mkdir -p openspec/changes/minio-folderview-and-baseline-disclosure/specs/minio-fileserver-source
mkdir -p openspec/changes/minio-folderview-and-baseline-disclosure/specs/minio-watch-auto-intake
```

- [ ] 寫 `openspec/changes/minio-folderview-and-baseline-disclosure/proposal.md`（照既有 `minio-watch-key-structure/proposal.md` 的 Why / What Changes / Impact 四段格式；**逐字內容如下，可直接寫入**）：

```md
## Why

`#minio`（MinioDataPage）在 #254 被偷接到真 `bim-control` bucket 的 raw flat-list（`/api/minio/objects`，527 物件），但接成「遞迴攤平＋只認 `model.ifc` 規約分組」的壞掉版：524 個幾何 `.json` 全落「(未知專案)」桶、6 個沒有 `model.ifc` 的專案在樹上連節點都不出現，與真實 MinIO 瀏覽器的 7 個乾淨專案資料夾完全不符。同時 `#conv` 把 `baseline_count`/`seen_count`/`triggered_total` 擠在單一 Field，使用者看到 `triggered_total=0` 無法判斷是畫面壞掉還是 by-design 不轉。使用者拍板：① `#minio` 改真 MinIO raw-folder 逐層導覽；② 轉檔狀態以持久 ledger 為真相、`.ifc` 旁顯狀態 chip ＋一鍵觸發鈕；③ watcher tick dedup 由 in-memory baseline 改持久 ledger 去重（既有未轉自動補轉、重啟不風暴）。

## What Changes

- `bim-review-coordinator` `/api/minio/objects`：**additive** 加 `delimiter` 參數 + `listMinioFolder`（S3 `Delimiter='/'` 資料夾語意 list，回 `{ folders[], objects, prefix, count }`，單層處理 `IsTruncated` 全拉）；`listMinioObjects` 舊簽名/回應 byte-identical 不動。`.ifc` 物件附 `idempotency_key` 供前端 chip 對 ledger lookup；每個 folder 附 `has_source_ifc`（對該 prefix probe）供「含 source IFC」badge。
- `bim-review-coordinator` 新增 **additive** `POST /api/conversion/trigger {key}`（一鍵手動觸發：`x-dev-token` 守門、server-side 生 presigned 不外洩、獨立 `triggerManualIntake` 直呼 `conversionLedger.upsert` 寫帳、冪等；**非** import `startMinioWatcher` 內私有 `triggerIntake` closure）。
- `bim-review-coordinator` watcher tick dedup：移除「首輪 baseline 不觸發」特例，改注入 `isLedgered(idkey)` 以持久 ledger 為去重水印——無紀錄→觸發、有紀錄→skip；in-memory `seen` 降為單輪/跨輪快取。`deriveIntakeFromKey` / `idempotencyKeyFor` / ledger schema 不改。
- `web-viewer-sample` `#minio`：raw-folder 逐層導覽（點資料夾換 prefix 重打）＋葉層三段語意 badge＋ledger 狀態 chip＋一鍵觸發鈕；`buildMinioTree` 退役。`#conv`：baseline/triggered 拆獨立 Field＋一致性基準文案＋ledger failed 列重新觸發鈕。
- 文件三方同步：prototype HTML 移除「真 S3/MinIO 三層待接 NOT BUILT」浮水印與 local_fs `#minio` 渲染；closed-loop design `#minio` display_model 改記 raw-folder 逐層＋葉層 badge。

## Impact

- Affected specs：`minio-fileserver-source`（MODIFIED：`#/minio` requirement 由「local_fs filesTree 真樹」改為「真 MinIO raw-folder 逐層 list」；`#/a1`/`#/a2` binding SHALL **不動**）、`minio-watch-auto-intake`（MODIFIED：watcher 觸發判定由「首輪 baseline 不觸發」改為「ledger 無紀錄才觸發」）。
- 跨 spec 調和：`minio-fileserver-source` 既有 `#/a1` 三層選擇器與 governance file-tree API（`local_fs`）**保留不動**——local_fs 只是不再當 `#minio` 顯示來源、原地降格為 A1/A2 頁內檔案選擇器。`minio-watch-key-structure`（仍 active，≥3 段規約）與本 change 對 `minio-watch-auto-intake` 同 spec 各改不同 Requirement/Scenario（前者改 key 結構、後者改觸發去重來源），archive 時須協調聯集、避免矛盾（見 plan 收尾「已知 gate」）。
- Affected code：`bim-review-coordinator`（`minioClient.ts` `listMinioFolder`/`MinioObjectView.idempotency_key`、`app.ts` route + watcher 注入、新 `manualIntake.ts`/`ledgerChipStatus.ts`、`minioWatcher.ts` tick dedup）；`web-viewer-sample`（`pages.tsx` `MinioDataPage`/`ConversionSchedulingPage`、`coordinatorClient.ts` `getMinioFolder`/`conversionTrigger`/型別、多支測試與 e2e）。
- 不改 `bim-streaming-server` / MinIO server / viewer baked image；不引入新 production dependency（`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` 皆已裝）。
- userFacing：true（`#minio` 逐層導覽 + chip + 觸發鈕、`#conv` baseline 揭露須 browser E2E 截圖驗收）。
- 風險：watcher tick dedup 由 baseline 反轉為「ledger 無紀錄才觸發」屬契約變更、非零 blast radius（既有 watcher 測試「首輪不觸發」斷言翻轉）；實作前跑 GitNexus `impact({target:'startMinioWatcher'})`、commit 前 `detect_changes`。
```

- [ ] 寫 `openspec/changes/minio-folderview-and-baseline-disclosure/specs/minio-fileserver-source/spec.md`（delta 格式照既有 change 的 `## MODIFIED Requirements` + `### Requirement:` + `#### Scenario:`；**逐字內容如下**——以**整段 Requirement 重述**取代舊「local_fs filesTree 真樹」，明示 local_fs 渲染移出 `#/minio`、A1/A2 binding 不動）：

```md
## MODIFIED Requirements

### Requirement: `#/minio` SHALL 顯示真 MinIO bucket 唯讀逐層資料夾導覽（四態 + 可重試）

本 change 將 `#/minio`（MinioDataPage）的顯示來源由 **governance-service local_fs `filesTree()`** 改為 **coordinator `GET /api/minio/objects?prefix=…&delimiter=/`**（真 `bim-control` bucket 的 S3 `Delimiter='/'` 資料夾語意 list）。`#/minio` SHALL 以 raw-folder 逐層導覽（point-and-list，像 MinIO 網頁）渲染：頂層 SHALL 列出**全部**專案資料夾（CommonPrefixes，依 `localeCompare('zh-TW')` 排序），點資料夾 SHALL 換 prefix 重打 list；含大量子物件的子樹（如 `geometries_chunks/`）SHALL 摺成單一可點資料夾、SHALL NOT 攤開其下葉物件、SHALL NOT 顯示寫死的物件數。導到含 `model.ifc` 的版本層時 SHALL 對該物件掛「專案/種類/版本」語意 badge（`deriveIntakeFromKey`，≥3 段才掛，不改）；資料夾（遞迴）含 `.ifc` SHALL 標輕量「含 source IFC」badge（後端 `has_source_ifc` 計算，前端 SHALL NOT 臆測）。`.ifc` 物件旁 SHALL 顯 ledger 衍生狀態 chip（值取自 `/api/conversion/records`，無紀錄誠實標「未轉」不臆測）＋一鍵觸發鈕（走 `POST /api/conversion/trigger`，`x-dev-token` 守門）。SHALL 維持 loading / error / empty / populated 四態：error 態 SHALL 誠實顯原因 + 提供「重試」動作（重打同一 fetch，SHALL NOT 要求整頁 reload）；empty 態 SHALL 分兩種文案——(a) MinIO 未設定（後端回 `note`，200）、(b) 已設定但當前 prefix 無物件，SHALL NOT 混用。list 回應 SHALL NOT 夾帶 presigned URL；SHALL NOT 以寫死示意樹偽裝真資料。

> 本 Requirement 取代原「`#/minio` SHALL 經 `governanceClient.filesTree()` 取真樹渲染 project/model/version」。local_fs `filesTree()` 與 governance file-tree API（canonical `:6-8`）**SHALL 保留不動**，原地降格為 `#/a1`/`#/a2` 頁內檔案選擇器來源；本 change **不動** `#/a1` 三層選擇器 Requirement（canonical `:69-95`）與其所有 Scenario。

#### Scenario: 真 MinIO 逐層導覽（populated）

- **WHEN** `getMinioFolder("")` 回頂層 CommonPrefixes（如 `洲際好宅/`、`東勢區許良宇紀念圖書館/` …）
- **THEN** 頁面 SHALL 渲染全部專案資料夾節點（依 `localeCompare('zh-TW')` 排序）、各為可點擊資料夾
- **AND** 點某資料夾 SHALL 以該 prefix 重打 `getMinioFolder` 並渲染下一層

#### Scenario: geometries_chunks 子樹摺疊不攤開

- **WHEN** 導到含大量 `chunk_*.json` 的層（API 帶 `delimiter=/` 回該 prefix 為單一 CommonPrefix）
- **THEN** 該層 SHALL 以單一可點擊資料夾節點呈現、`objects` SHALL NOT 含 chunk 葉物件
- **AND** 資料夾節點旁 SHALL NOT 顯示寫死的物件數

#### Scenario: `.ifc` 旁顯 ledger 狀態 chip 與一鍵觸發鈕

- **WHEN** 導到含 `model.ifc` 的版本層、且 ledger 對該物件 `idempotency_key` 有/無紀錄
- **THEN** 該 `.ifc` 物件旁 SHALL 顯狀態 chip（`ready`/`detected`/`queued`/`converting`/`failed`/「未轉(含 baseline)」），無紀錄 SHALL 誠實標「未轉」不臆測
- **AND** 對「未轉/failed」者 SHALL 提供觸發鈕（intent→confirm→`POST /api/conversion/trigger` 帶 `x-dev-token`），成功 SHALL patch chip、失敗 SHALL 顯 inline error 且 chip 不變

#### Scenario: error 態誠實顯示且可重試

- **WHEN** `getMinioFolder()` 失敗（coordinator / MinIO 不可達，回 502）
- **THEN** 頁面 SHALL 顯示錯誤原因（含 `/api/minio/objects`），SHALL NOT 偽裝有資料
- **AND** SHALL 提供「重試」按鈕，點擊後重打 `getMinioFolder()` 同一 prefix
```

- [ ] 寫 `openspec/changes/minio-folderview-and-baseline-disclosure/specs/minio-watch-auto-intake/spec.md`（delta 格式同上；**逐字內容如下**——MODIFIED 既有 Requirement 的觸發判定來源，並用 `#### Scenario:` 重述被取代/新增的 Scenario）：

```md
## MODIFIED Requirements

### Requirement: coordinator SHALL 以輪詢自動偵測 MinIO 新 IFC 並觸發既有 intake 鏈（O4 定案）

本 change 將 watcher tick 的去重判定來源由 **in-memory「首輪 baseline 不觸發」特例** 改為 **持久 ledger 去重水印**：watcher 每輪對每個 `*/model.ifc` 算 `idempotency_key = idempotencyKeyFor(bucket,key,etag)`（=`mw_<hash16>`，確定性、即 ledger 主鍵），查持久 ledger（`conversionLedger.get(idkey)`）——**無紀錄 SHALL 觸發 intake（並由 intake 落帳）；有紀錄 SHALL skip**。in-memory `seen` SHALL 降為單輪/跨輪快取（同 key 同 etag 不重查 ledger），權威去重 SHALL 以持久 ledger 為準。`deriveIntakeFromKey` 三段規約、`idempotencyKeyFor` 算法、ledger schema SHALL NOT 改。其餘（env opt-in、`ListObjectsV2` 分頁、輪詢間隔下限、暫時性失敗自癒重試、malformed 計數跳過）SHALL 維持不變。

> 本段取代 canonical `:18-22`「首輪 SHALL 只登記 baseline 不觸發」與其「首輪 baseline 不爆量」Scenario。重啟不風暴的保證由「持久 ledger 命中既有 `mw_<hash16>`」承擔（非新建 watermark），與既有「重啟冪等」Scenario 同源、一致。`baseline_count` SHALL 由「不觸發的基準計數」改記「首輪 list 到的規約檔總數」供觀測（不再有抑制觸發語意）。

#### Scenario: 既有未轉物件自動補轉（取代首輪 baseline 不觸發）

- **WHEN** watcher 首次或重掃時 list 到 ledger **無**紀錄的既有 `*/model.ifc`（含原被當 baseline 吸收的檔）
- **THEN** watcher SHALL 在該輪對其觸發 intake、ledger SHALL 落帳（`mw_<hash16>`）
- **AND** `baseline_count` SHALL 反映「首輪 list 到的規約檔數」、SHALL NOT 用於抑制觸發

#### Scenario: ledger 已落帳物件不重觸發（重啟不風暴）

- **WHEN** coordinator 重啟後 watcher 重掃到 ledger **已有**紀錄的同 key 同 etag 物件
- **THEN** watcher SHALL skip（持久 ledger 命中 `mw_<hash16>`）、SHALL NOT 重複觸發或重複建 job
- **AND** 僅**新 key 或新 etag**（→ 新 `mw_<hash16>`、ledger 無紀錄）SHALL 觸發
```

- [ ] 寫 `openspec/changes/minio-folderview-and-baseline-disclosure/tasks.md`（照既有 change tasks.md 格式，對應本 plan 各 task；**逐字內容如下**）：

```md
# Tasks — minio-folderview-and-baseline-disclosure

對應 plan `docs/superpowers/plans/2026-06-24-minio-folderview-and-baseline-disclosure.md`（含 5-Sonnet 交叉對抗修訂段）。

- [ ] 1. 後端 `listMinioFolder`（S3 Delimiter 逐層 list，additive）＋ `MinioObjectView.idempotency_key`＋ folder `has_source_ifc`；`listMinioObjects` 簽名零改（plan Task 1a/1b/1c）。
- [ ] 2. `/api/minio/objects` route 加 `delimiter` 參數（additive 回 `folders[]`），不帶時 byte-identical（plan Task 2）。
- [ ] 3. `triggerManualIntake` + `POST /api/conversion/trigger`（`x-dev-token` 守門、server-side presigned 不外洩、直呼 ledger.upsert、冪等）（plan Task 3a/3b）。
- [ ] 4. watcher tick dedup 改注入 `isLedgered` 持久 ledger 去重、移除 `isFirstRound` baseline 特例（plan Task 5；HIGH 風險，GitNexus impact/detect_changes）。
- [ ] 5. 前端 `#minio` 逐層導覽 + 葉層 badge + ledger chip + 一鍵觸發鈕、`#conv` baseline 揭露拆分 + failed 列重新觸發（plan Task 6/7/8/9）。
- [ ] 6. 文件三方同步：prototype HTML 移除 NOT BUILT 浮水印、closed-loop design display_model 改 raw-folder（plan Task 12）。
- [ ] 7. Browser E2E：逐層導覽 + geometries_chunks 摺疊 + chip + 觸發 + auto-enroll + 無假 ready，截圖落 `artifacts/e2e/minio-folderview-*.png`（plan Task 11）。
```

> **delta 撰寫驗證（執行者寫完上述四檔後跑）：** `cd .../minio-folderview-baseline-spec && npx openspec validate minio-folderview-and-baseline-disclosure --strict`（本機 openspec CLI 偶有結構驗證故障——若報工具自身錯誤而非 delta 內容錯誤，記錄於 commit/PR 並依 CI `pr-review-agent` 真 validate 為準，見 MEMORY「OpenSpec 批次收斂手冊」）。delta 只 MODIFIED 既有 Requirement、不新增 ADDED；`#/a1`/`#/a2` binding SHALL 全程不出現在 delta（確認未誤動）。

- [ ] 改 prototype HTML（`docs/plans/ai-bim-governance-prototype.html`）。給出確切替換內容（completeness 修正）：

  **(a) `:534` 從 NOT BUILT 清單移除「真 MinIO 瀏覽」：** 先 `grep -n "真 MinIO 瀏覽\|真 S3/MinIO" docs/plans/ai-bim-governance-prototype.html` 定位該清單項，刪掉「真 MinIO 瀏覽」那一筆陣列元素（連同其逗號），不動同陣列其他項。

  **(b) `MinioPage`（`:1108-1165`）整段替換。** 此版本是 prototype（非真程式碼，無 import coordinatorClient），僅作設計門面說明，故改寫成「raw-folder 逐層導覽 point-and-list」說明 + 已建 provenance、**移除 `tree` 兩層假樹、移除浮水印、移除 local_fs header**：

```jsx
/* ── #minio MinIO 資料(真 MinIO raw-folder 逐層導覽,已建) ──────── */
function MinioPage({ lang }) {
  return (
    <div>
      <PageHead crumb={tt({ zh:"M MinIO 資料", en:"M MinIO data" }, lang)} title={tt({ zh:"MinIO 資料", en:"MinIO data" }, lang)}
        sub={tt({ zh:"真 MinIO bim-control bucket 唯讀逐層資料夾導覽(像 MinIO 網頁一樣 point-and-list,S3 Delimiter)。非 metadata 權威——權威在 bim-control·MySQL。", en:"Read-only level-by-level folder browsing of the real MinIO bim-control bucket (point-and-list like the MinIO web UI, S3 Delimiter). Not the metadata authority — that lives in bim-control·MySQL." }, lang)}
        prov={<D.ProvTag level="built" note="接 coordinator /api/minio/objects · 真 MinIO" />} host={<HostTag kind="host" />} />
      <D.Panel title={tt({ zh:"逐層資料夾導覽 · 真 MinIO", en:"Level-by-level folder browsing · real MinIO" }, lang)} right={<D.ProvTag level="built" />}>
        <div style={{ fontFamily:"var(--font-mono)", fontSize:10.5, color:"var(--text-4)", marginBottom:10 }}>
          GET /api/minio/objects?prefix=&lt;層&gt;&amp;delimiter=/ · 回 folders[](CommonPrefixes)+ 當層直屬 objects
        </div>
        <div style={{ fontSize:12.5, color:"var(--text-3)", lineHeight:1.7 }}>
          {tt({ zh:"頂層列出全部專案資料夾(中文原名);點一層、問一層(換 prefix 重打 list)。含大量 chunk 的子樹(如 geometries_chunks/)摺成單一可點資料夾、不攤開、不寫死物件數。導到含 model.ifc 的版本層時,該物件旁掛「專案/種類/版本」語意 badge + 轉檔狀態 chip(ledger 衍生) + 一鍵觸發鈕。資料夾(遞迴)含 .ifc 標輕量「含 source IFC」badge。", en:"Top level lists all project folders (original Chinese names); click a level, query a level (re-list with the new prefix). Subtrees with many chunks (e.g. geometries_chunks/) collapse into a single clickable folder — not expanded, no hard-coded object count. At a version level containing model.ifc, the object carries a project/category/version semantic badge + a ledger-derived conversion-status chip + a one-click trigger button. Folders that (recursively) contain a .ifc get a lightweight 'has source IFC' badge." }, lang)}
        </div>
      </D.Panel>
      {/* 真 MinIO bucket layout — prov=demo,純語意參照(watcher deriveIntakeFromKey 解析語意),非逐層結果 */}
      <SectionTitle hint="watcher 解析語意 · 純語意參照">{tt({ zh:"真 MinIO bucket 規約(語意參照)", en:"Real MinIO bucket layout (semantic reference)" }, lang)}</SectionTitle>
      <D.Panel title={tt({ zh:"bim-control key 結構", en:"bim-control key structure" }, lang)} phase right={<D.ProvTag level="demo" note="語意參照 · demo" />}>
        <div style={{ fontFamily:"var(--font-mono)", fontSize:12, color:"var(--text-2)", lineHeight:1.8, background:"#070a0d", border:"1px solid var(--line)", borderRadius:8, padding:"12px 14px" }}>
          192.168.20.234:9000 / bucket <b style={{ color:"var(--accent)" }}>bim-control</b><br />
          專案中文 / …動態層 / 種類(倒數二) / 版本(末) / model.ifc<br />
          <span style={{ color:"var(--text-4)" }}>watcher: segments.length &lt; 3 擋 · 中文資料夾 → mv_&lt;hash8&gt;</span>
        </div>
        <div style={{ marginTop:12, fontSize:12.5, color:"var(--text-3)", lineHeight:1.65 }}>
          {tt({ zh:"此三層規約是 watcher 偵測的解析語意(deriveIntakeFromKey),作為葉層 badge 的依據;#minio 主樹本身是 raw-folder 逐層、忠實鏡射 bucket 巢狀結構,非此三層骨架。真實 endpoint 由部署區 .env 注入,不在程式碼硬編碼。", en:"This 3-level layout is the watcher's parse semantics (deriveIntakeFromKey), used as the basis for leaf-level badges; the #minio main tree itself is raw-folder level-by-level, faithfully mirroring the bucket's nesting — not this 3-level skeleton. The real endpoint is injected via deploy .env, never hard-coded." }, lang)}
        </div>
      </D.Panel>
      <DepsList deps={[
        { name:"coordinator · /api/minio/objects(真 MinIO list proxy)", port:":8004", host:"host", tone:"ok" },
        { name:"minioWatcher · deriveIntakeFromKey(≥3 段 · 葉層 badge)", port:"watcher", host:"container", tone:"ok" },
        { name:"真 MinIO bim-control(外連依賴,非 bind)", port:"192.168.20.234:9000", host:"host", tone:"idle" },
      ]} />
    </div>
  );
}
```

  注意：上面已**移除** `/api/files/tree`(local_fs)dep（改成 coordinator `/api/minio/objects`）、**移除浮水印與「待接」字樣**；DEMO panel 改標「語意參照」並明說主樹是 raw-folder 逐層、非三層骨架。

- [ ] 改 closed-loop design（`docs/superpowers/specs/2026-06-23-minio-conversion-closed-loop-observability-design.md`）。給出確切替換內容（completeness 修正）：

  **(a) `### 4.2 #minio 唯讀結構頁（新）` 整段（`:84-88`）替換**（4 個 bullet 全改；**不得只改「做什麼」一行而留「三層」舊語意**）：

```md
### 4.2 `#minio` 唯讀結構頁（新）
- **做什麼**：把真實 bucket 做成只讀**逐層資料夾導覽**（raw-folder，S3 `Delimiter='/'`，像 MinIO 網頁一樣 point-and-list，**無三層語意骨架**）。頂層列出全部專案資料夾；含大量 chunk 的子樹（如 `geometries_chunks/`）摺成單一可點資料夾、不攤開、不寫死物件數。三層「專案→類別→版本」語意**降為葉層 badge**——導到含 `model.ifc` 的版本層時才掛在該物件旁（`deriveIntakeFromKey`，≥3 段，不改）。每葉物件標角色：`source IFC` / `parsed USDC` / `pending(待產生)`；資料夾（遞迴）含 `.ifc` 標輕量「含 source IFC」badge。`.ifc` 旁另掛 ledger 衍生狀態 chip + 一鍵觸發鈕。
- **介面**：`GET /api/minio/objects?prefix=…&delimiter=/`（唯讀 folder list proxy，回 `{ folders[], objects(當層直屬), prefix, count }`，單層處理 `IsTruncated` 全拉）；`.ifc` 物件附 `idempotency_key` 供 chip 對 `/api/conversion/records` lookup；一鍵觸發 `POST /api/conversion/trigger`（`x-dev-token` 守門）。
- **誠實**：頁面明示「唯讀 intake 來源視圖，非 metadata 權威」；`model.usdc` 在 converter 落地前一律標 `pending · 待產生`，不假裝已轉；CommonPrefix 不寫死其下物件數（要顯示須再 list，與 lazy 互斥）。
- **安全**：擋路徑穿越（沿用 watcher key 規約：拒空段 / `.` / `..`）；list 回應**不夾帶 presigned URL**；presigned 下載連結（如提供）短效、不入 log。
```

  **(b) 非目標 `:42`（「❌ 不新增手動插隊/優先序佇列 UI」）加註 supersede：** 在該行後追加：

```md
- ❌ 不新增手動插隊/優先序佇列 UI（除非後續需求）。
  > **2026-06-24 supersede（change `minio-folderview-and-baseline-disclosure`）：** 本案使用者拍板新增「一鍵觸發轉檔」鈕 + `POST /api/conversion/trigger`。明示這是「手動 intake **觸發**」（走 spec 已認可的手動 webhook intake 等效路徑、包成按鈕），**非佇列插隊/優先序 UI**；佇列插隊仍為非目標。
```

  （`:25` 現況表「轉檔觸發」列也可同步加一行註記「2026-06-24 已新增一鍵觸發鈕，見 §4.x supersede」，非必要但建議。）

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
- **跨 monorepo import（Task 7，已在 plan 內定案）：** web-viewer `tsconfig.json` `include` 只含 `src`、`moduleResolution: bundler`，跨 package import 後端 `ledgerChipStatus` 會 TS2307 fail。**plan 已決定前端內聯 3 行同義函式**（Task 7 最小實作即內聯版），不走跨 package import。Task 4 後端純函式僅供後端單元測試與後端共用。這是刻意的小幅重複（避免動 tsconfig project boundary），非缺陷。
