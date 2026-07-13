# Conversion API environment ownership design

## 狀態與目的

- 狀態：已核准
- 日期：2026-07-13
- 對應工作：PR #327 `chore/env-example-hygiene-20260713`

本規格固定 conversion API environment key 在 workspace root 與
`bim-review-coordinator` 之間的 ownership、相容性與部署安全邊界。目標是讓
`.env.example` 能完整描述 coordinator 實際接受的 key，同時避免把 legacy alias
誤升格成 root 或跨服務的正典設定。

## 範圍

本次只調整：

- root `.env.example` 的 ownership／退役說明；
- `bim-review-coordinator/.env.example` 的空值 legacy alias 宣告；
- 驗證上述宣告與既有 runtime precedence 一致。

本次不修改：

- 任何真實 `.env` 或 secret；
- runtime code、public API、port、route 或服務邊界；
- conversion service 的預設位址或啟用狀態；
- `scripts/deploy.ps1` 的 missing-key merge 行為。

## Environment ownership contract

### Workspace root

- Root conversion endpoint 的正典 key 是 `STREAMING_CONVERSION_API_BASE`。
- Root 不宣告 `CONVERSION_API_BASE`；該 key 只屬於 coordinator 的 legacy
  compatibility surface。
- `CONVERSION_SERVER_API_BASE`、`S3_STORAGE_BASE` 與
  `S3_STORAGE_STATIC_BASE` 在 root 沒有 runtime reader，維持退役狀態。
- Storage root 繼續由 `RUNTIME_STORAGE_ROOT` 表達。

### bim-review-coordinator

- `STREAMING_CONVERSION_API_BASE` 是首選 key。
- `CONVERSION_API_BASE` 必須在 `.env.example` 以空值 placeholder 宣告：
  `CONVERSION_API_BASE=`。
- 空值 placeholder 只讓部署 missing-key audit 能看見 legacy compatibility
  surface，不得提供 endpoint、不啟用功能，也不得覆蓋正典 key。

### Runtime precedence

既有 `conversionApiBaseFromEnv()` precedence 保持不變：

1. 非空的 `STREAMING_CONVERSION_API_BASE`；
2. 非空且不屬於 retired legacy base 集合的 `CONVERSION_API_BASE`；
3. `DEFAULT_STREAMING_CONVERSION_API_BASE`。

若 legacy key 為空，必須視為未設定。若 legacy value 命中 retired base
集合，必須回退正典 default，不得重新連回已退役服務。

## Deployment and security behavior

- `deploy.ps1` 可以從 coordinator `.env.example` 偵測缺少的 legacy key，
  但 example 中的空值不得讓 production watcher、conversion 或 callback 自動啟用。
- Existing `.env` values 必須由 deployment merge 邏輯保留；本規格不授權覆寫。
- 測試、log、PR 與驗收報告只能列 key 名稱與空值／非空分類，不得輸出真實值。
- 本規格不要求修改 canonical deploy script；以 read-only DryRun 驗證現行路徑。

## Acceptance criteria

- Root `.env.example` 只把 `STREAMING_CONVERSION_API_BASE` 描述為正典
  conversion endpoint key。
- Coordinator `.env.example` 同時宣告正典 key與空值 legacy alias。
- Config tests 證明正典 key 優先於 legacy key，retired legacy value 會回退 default。
- Environment parity／preflight tests 通過。
- Coordinator TypeScript build 與完整 test suite 通過。
- `scripts/deploy.ps1 -DryRun` 完成且不執行任何 auto-fix。
- GitNexus change detection 不回報 code symbol 或 execution-flow 影響。

## Verification commands

```powershell
cd bim-review-coordinator
npm test -- tests/config.test.ts tests/env-example-minio-watch-parity.test.ts
npm run verify

cd ..
pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-preflight-env.ps1
.\scripts\deploy.ps1 -DryRun
git diff --check
```

## Rollback

Rollback 只需回復兩個 `.env.example` 與本規格文件；沒有資料 migration、secret
rotation、runtime state 或 deployment artifact 需要回復。
