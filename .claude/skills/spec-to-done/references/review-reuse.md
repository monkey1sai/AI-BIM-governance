# Review reuse — only on a repeated dispatch

### 收斂與 anti-loop 契約

- 每次 check、review、approval 或 blocker 觀察都以 `evidenceFingerprint=head/base/diffDigest/gate/blocker/authorityState` 去重。同一 fingerprint 沒有 `evidence delta` 時固定為 `NO_RETRY`／`SKIP_ALREADY_SATISFIED`：不得重跑相同 gate、重啟 reviewer、重送 approval request，或以換 session／CLI 規避；採 incremental gate evaluation，不因任一檔案變動就全套重跑。
- 合法 `evidence delta` 只包含新 HEAD／base／diffDigest、外部 authorityState 實際改變，或 owner 對同一 blocker 提供新的明確決策；時間經過、未變的 check 狀態與重述既有訊息都不算。
- 每個 blocker 另以 `blockerFingerprint=gate/errorCode/affectedScope/rootCause` 計數；同一 blocker 只允許一次自主修復。修後仍是同一 fingerprint 就標記 `CIRCUIT_BREAKER_OPEN`，交付可完成部分或收斂為 HELD，禁止第三次 recovery 與 trust／generator／architecture 的旁支擴張。
- P5 採 `one_conclusive_p5_review_per_exact_head`。先累積已知 in-scope 修正為一個 bounded batch，再審 exact head；finding 必須分成 `BLOCKING / CONFIRMED_CORRECTNESS / OPTIONAL / OUT_OF_SCOPE`，只有前兩類可阻擋。若審查要求改碼，最多一個修正 batch 與一個 final exact-head review，之後仍有 blocking finding 就收斂為 HELD，不再開 review/fix 循環。
- P7 的 exact-head authority 採 `one_approval_request_per_exact_head`。同一 exact head 僅查詢並請求一次；但 owner 已授與的 operation/repository/branch/authority scope 若未擴張則 `REUSE_AUTHORIZATION`，不得因 minor HEAD 或 metadata 改變重問。`REUSE_AUTHORIZATION` 只表示操作範圍仍獲授權，絕不重用 GitHub counted approval；HEAD 改變後仍須重新取得該 exact head 的有效 approval。只有 scope/security boundary/deployment target/destructive action 改變或 authority 失效，才可再次請求；沒有 authorityState delta 就記錄一次 blocker 並收斂為 HELD，不輪詢、不重送。
- 既有 PASS 只要輸入與相依面未被新 diff 失效就沿用；只重跑被 evidence delta 明確失效的 gate。out-of-scope 或 non-blocking finding 放入 deferred backlog，不可擴張本 run。

`remainingAgentCalls=maxAgentCalls-agentCalls.used` 必須傳入每個 `std-*` / `fu-*` 等價 workflow；回傳的
`agentCallsUsed` 立即累加後才可決定下一步。P6 每次 `ship-item` 等價 workflow 呼叫另計 1 call。任何計數到頂、
workflow 試圖超額、或 resume 缺少可信計數，一律 fail-closed，不可用新 session / 新 run ID 歸零。

## Executable dispatch decision
任何 native reviewer follow-up／重建 reviewer 前，將 {previous,next} JSON 傳入
`node .claude/skills/spec-to-done/review-dispatch.mjs` 的 stdin。
每個 observation 只含 head_sha（40 hex）、input_sha256、policy_sha256、
verification_manifest_sha256、evidence_fingerprint（後四者為 SHA-256）。
previous=null 只用於這個實際 slice/review scope 的第一次審查。
digest 必須來自實際需求/範圍、policy、驗證輸入與證據；不把時間、agent 名稱、模型或提示措辭當作新 evidence。
它直接使用 repo 的 retryCarriesNewInformation，不建立另一套 review loop 或 budget。
NO_RETRY 時保留未閉合 finding／HELD；只有原 verdict 已通過且相依面未失效時才能沿用 PASS。
缺失/invalid reviewer output 可在原額度內重試一次，但不能把有效的未通過 verdict 當成 infra retry。
同一 finding 修正可以沿用 reviewer；更換切片或責任範圍用短的新任務包，避免長 reviewer history。
