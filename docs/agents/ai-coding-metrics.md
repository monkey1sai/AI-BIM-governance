# AI coding metrics baseline

`scripts/ai-coding-metrics-policy.json` 是 AI coding 指標與非必要重跑 telemetry 的 repository-local authority。它只提供量測契約，不是 merge authority，也不代表 hosted CI、branch protection 或四週基線已完成。

## Truth boundary

- 基線政策從 `2026-07-28` 起算且禁止補造較早資料，但 v1 的 `observed_at` 是 caller-supplied，capture provenance 仍為 `unattested`。因此即使到 `2026-08-25` 且滿 28 天，也不能自動升格為 baseline ready 或設定改善目標；必須先由 hosted producer 提供可信 capture-time attestation。
- required merge truth 的 retry 固定為 0。diagnostic telemetry 最多重跑一次；attempt 2 必須晚於 attempt 1、以 `retry_of_sha256` 綁定 exact canonical attempt-1 bytes，且只能重跑同 commit、plan、manifest、package、test 與 environment 下第一次失敗或 timeout 的測試。reporter 只接受 writer 推導出的 canonical artifact path。
- telemetry 固定 `authority=telemetry_only`。`scripts/lib/merge-evidence.mjs` 與 merge-evidence workflow 不讀 `artifacts/telemetry/**`；重跑通過不能掩蓋第一次失敗。
- 觀測只接受 policy registry 內的 package/gate/test identity。不得保存 command、argv、env、cwd、prompt、source、log、stack、stdout/stderr、URL、path、repository、actor 或 user。
- trace 只可保存 SHA-256 與 byte count；不得保存或上傳 raw trace。觀測檔最多 1 MiB、500 records，單次報告累計輸入最多 16 MiB。raw namespace 已由 `.gitignore` 排除；35 天是 hosted retention 目標，目前 enforcement 為 `not_configured/hosted-retention-unverified`，不能宣稱本機已自動刪除。月報只能按 package 聚合，不能提供人員 drill-down。

## Metric truth table

| 指標 | repository-local 狀態 | 可宣稱內容 |
|---|---|---|
| first-pass gate yield | collecting baseline；provenance unverified | 只由 accepted attempt 1 計算；零樣本為 `null/no_observations` |
| change-to-fast-check | not configured | 沒有可信 first-change timestamp，不以 editor/file mtime 代替 |
| rework commits | not configured | 沒有封閉 work-item/root-cause linkage，不讀 commit message 或 actor |
| active change WIP | snapshot only | 只計 `openspec/lifecycle-ledger.json` 當前 `active` 數量；不是歷史趨勢 |
| active change age | not configured | ledger 沒有 active-start timestamp |
| context packet size | snapshot only | 只報 task-packet corpus 的 declared `read_set`；不是 prompt/token/byte 實測 |
| flake rate | collecting baseline；provenance unverified | attempt 1 failure/timeout 且同 identity attempt 2 passed；零樣本不輸出 0% |

`attempt_one_duration_median_ms` 是 package-level diagnostic，不得改名或宣稱為 change-to-fast-check。

## Local contract checks

```powershell
node --test scripts/tests/test-ai-coding-metrics.mjs
```

錄入 telemetry 前，先產生符合 `ai-coding-telemetry-observation/v1` 的 bounded JSON；recorder 只會寫入由 subject、package 與 attempt 推導的固定新檔：

```powershell
node scripts/dev/record-ai-coding-telemetry.mjs `
  --repo-root . `
  --input artifacts/telemetry/ai-coding/input/observation.json `
  --out artifacts/telemetry/ai-coding/<subject>/<package>/attempt-1.json
```

產生當日報告時只傳明確檔案，不掃目錄；不提供 observation 時會產生 `no_observations`，不會捏造 0%：

```powershell
node scripts/dev/report-ai-coding-metrics.mjs `
  --repo-root . `
  --observed-at 2026-07-30T12:00:00.000Z `
  --lifecycle openspec/lifecycle-ledger.json `
  --task-corpus scripts/tests/fixtures/agent-governance-routing.json `
  --out artifacts/metrics/ai-coding/2026-07-30.json
```

Hosted producer、可信 capture-time attestation、35 天 artifact retention enforcement、四週資料與月對月決策尚須在真實 GitHub 執行環境驗證；本地 fixture、`.gitignore` 或 caller-supplied timestamp 不能把這些狀態升格為 passed。
