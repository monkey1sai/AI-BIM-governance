# GPU session SLO 與環境指紋綁定（可稽核部署文件）

本檔是 `gpu-session-baseline` capability 指定的「可稽核部署文件」：**session admission 參數的 SLO 具體數值只能寫在這裡**，且每一項都必須綁定一份合格基準報告的環境指紋。

- 規格正本：`openspec/changes/gpu-session-baseline-and-idle-reclaim/specs/gpu-session-baseline/spec.md`
- 本檔目前落地的是 task 1.5 前半（環境指紋失效政策）。**SLO 數值表仍為空**，由 task 1.3（隔離 soak）／1.4（由本地實測訂門檻）填入。
- 硬規則：**禁止引用任何未經本機實測的外部數字**（含任何外部系統的 GB/日 洩漏率、TTFF 參考值、並發上限）。空著比填一個沒量過的數字正確。

## 1. 環境指紋的定義（機器真相）

環境指紋由 `Get-EnvironmentFingerprint`（`scripts/lib/measure-session-baseline.ps1`）產出，寫在基準報告的 `environment_fingerprint` 物件。**下游引用資格的五個必填欄位**（`Test-SessionBaselineReportForDownstream` 的 `$requiredFingerprintFields`）：

| 欄位 | 意義 | 合格條件 |
|---|---|---|
| `gpu_model` | 第一張 GPU 型號 | 非空字串且 `measured=true` |
| `gpu_driver_version` | 該卡 driver 版本 | 非空字串且 `measured=true` |
| `kit_version` | checkout 宣告的 Kit 版本 | 非空字串且 `measured=true` |
| `fixture_hash` | 量測 fixture 的 SHA-256 | 64 字元小寫 hex 且 `measured=true` |
| `fixture_size_bytes` | 該 fixture 大小 | 正整數且 `measured=true` |

另外三個欄位會**撤回**完整性宣稱，即使上表五項齊全也一樣：

- `gpu_fingerprint_scope`：`single_gpu` / `all_gpus` 合格；`partial_gpu_rows` 表示有 nvidia-smi 列無法解析，拓撲指紋不完整。
- `fixture_binding_scope`：只有 `no_live_session_observed` 可被下游引用；`live_session_unverified`（宣告了 fixture 但同時觀察到 live session）、`runtime_state_unknown`（runtime 探針沒取到可觀察的 session/binding 計數）、`not_supplied` 一律拒絕。
- `complete`：必須是嚴格布林 `true`，且與欄位層級證據一致；手改的 `complete=true` 會被判為 fabrication-shaped inconsistency 而拒絕。

`kit_version` 帶 `runtime_verified=false` caveat：它是 checkout 宣告值，不是跑在現場那顆 Kit 行程的版本。runtime artifact-identity 驗證屬 task 1.3 範圍，**本檔不得宣稱已驗**。

## 2. 產生與驗證基準報告

```powershell
# 產生（唯讀：只跑 nvidia-smi + coordinator GET 探針，不建立/關閉任何 session，不啟停服務）
pwsh -NoProfile -File scripts/measure-session-baseline.ps1 -FixturePath <量測用 IFC 絕對路徑>

# 判定這份報告能否被 SLO／admission 參數引用（exit 0 = 可引用；exit 1 = 拒絕）
pwsh -NoProfile -File scripts/validate-session-baseline-report.ps1 -ReportPath <報告路徑>
```

報告預設落 `artifacts/gpu-baseline/<run_id>.json`（已 gitignore）。本 repo 為 PUBLIC：**報告本體含主機名等環境 metadata，不得 commit 進 repo**；稽核時引用 `run_id` 與上表指紋欄位值即可。

驗證器輸出 `gpu-session-baseline-report-validation/v1` 結構化 verdict 到 stdout，任何讀不到／解析不了／schema 未知的報告都是拒絕，不是崩潰，也不會變成通過。

## 3. SLO 數值表（尚未量測）

| SLO 項目 | 數值 | 綁定的基準報告 run_id | 綁定指紋 | 狀態 |
|---|---|---|---|---|
| session 建立成功率下限 | — | — | — | 未量測（task 1.4） |
| TTFF 上限 | — | — | — | 未量測（task 1.4） |
| 探針逾時定義 | — | — | — | 未量測（task 1.4） |
| 並發上限 | — | — | — | 未量測（task 1.4） |
| idle-timeout | — | — | — | 未量測（task 1.4） |
| 記憶體洩漏 watchdog 門檻 | — | — | — | 未量測（task 1.3 soak → 1.4） |

填表規則：

1. 每列必須是**具體數值＋單位**。禁用「合理」「足夠」「約略」等模糊詞。
2. 每列必須填入產出該數值的報告 `run_id`，以及當時的五項指紋值。沒有 run_id 的列視為未量測。
3. TTFF 與 session 建立成功率**目前在 harness 內結構上量不到**：`measure-session-baseline.ps1` 是唯讀的、不建立 session，兩者只能由呼叫端以 `-TtffMs` / `-SessionCreationSuccessRate` 傳入，報告會標成 `source=caller_supplied`。填表時必須註明該數值出自哪一次 live 量測（task 1.3 soak）。
4. 洩漏門檻只能由本機 soak 的記憶體斜率訂出。soak 期間單次自然斷流記為 finding 並視為量測窗雜訊；連兩次同點斷流才判環境污染需查因。

## 4. 環境指紋變動即 SLO 失效

**規則**：第 1 節任一指紋欄位變動，既有 SLO 立即失效，須重跑基準取得新指紋後才能重新設定 admission 參數。

觸發重跑的變動至少包含：

- 換卡或增減 GPU（`gpu_model`、`gpus[]`、`gpu_count` 任一變動）
- driver 升級／回滾（`gpu_driver_version` 變動）
- Kit 版本變動（`kit_version` 變動）
- 量測 fixture 換檔或內容變動（`fixture_hash` 或 `fixture_size_bytes` 變動）
- `gpu_fingerprint_scope` 由 `single_gpu`／`all_gpus` 掉到 `partial_gpu_rows`
- `fixture_binding_scope` 不再是 `no_live_session_observed`

失效處置：

1. 把第 3 節對應列的狀態改成「失效（指紋變動：<欄位>，舊 run_id <id>）」，**不得沿用舊數值**。
2. 重跑 §2 兩道指令取得新報告並通過 exit 0。
3. 重跑 soak 取得新斜率後才重填數值。

指紋比對是逐欄位相等比較，不做「差不多」判斷；任何一欄不同就是不同環境。

## 5. 硬 gate：無基準報告不得上線

規格要求：**無合格基準報告時，admission 參數 SHALL NOT 上線**，且 admission 參數 loader 必須以硬 gate 拒絕未經量測的門檻。

目前落地狀態（誠實揭露）：

- **已落地**：報告端的 fail-closed 判定 `Test-SessionBaselineReportForDownstream` 與 CLI `scripts/validate-session-baseline-report.ps1`。任何 SLO 形式化或 admission 參數載入路徑在引用報告前 **SHALL** 先呼叫其中之一，exit 1 即停。
- **未落地（open）**：repo 目前**沒有** admission 參數 loader 實體，因此「loader 拒絕上線」的硬 gate 測試尚未存在。此缺口屬 task 1.5 後半，且其參數檔 schema 依賴 task 1.4 定出的數值形狀，故不在本檔落地時一併發明。
- 在 loader 落地前，第 3 節空表本身就是 gate：**沒有數值可載入 = 不得上線**。

## 6. 稽核步驟

1. 讀第 3 節：任一列狀態不是「有效」→ 該 admission 參數不得上線。
2. 對該列的 `run_id` 對應報告跑 `scripts/validate-session-baseline-report.ps1`，確認 exit 0。
3. 比對報告當下的五項指紋值與表中記載值逐欄相等。
4. 對現場環境重跑 `scripts/measure-session-baseline.ps1`，確認指紋未漂移。任一欄不同 → 依 §4 判失效。
