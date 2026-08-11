# linux-test-deploy-verifier-hardening — fixpoint summary

> 文件性質：**evidence**（fixpoint 完成證據）。本檔記錄已執行之驗證與其結果，不是 contract、不是 working note；ledger entry 閉合後受閘門的證據不可變規則保護。

Closes the `linux-test-deploy-verifier-hardening` ledger entry per
`docs/agents/self-referential-bootstrap.md` §2 obligation 3.

- `mechanism_commit` = `5a7fea9991f04a7e8204df2a02c5b4c4dedb1831` — PR #484's
  squash on main's first-parent line; subject binds `#484`; its first-parent
  diff touches the entry's declared mechanism paths.
- `verification_contract` digest preserved unchanged:
  `5caa635738c142274b5dbd0f045ceb8436f5401565306a5464f2086d6b472a64`.
- Reverified 2026-08-11T12:52Z。

## Attested run：嚴格契約順序單趟（1→14）

attestation.json 所記錄的執行：14 條命令**依 opening contract 的精確順序**
1→14 單趟完成、無重跑、無順序偏移，逐條 process-level exit code 記錄
（jsonl），全數 exit 0。

1. **本地契約套件（命令 1–11）**：於主 checkout（clean，
   `c88dca63e3187b9616e8801bad70898a2fd03eb0`＝當時 `origin/main` tip，亦即
   本輪 canonical rebuild 的 deployed source，含已 merge 的 #484/#487/#488/#498）
   依序執行。
   - `test-host-native-conversion-service`：101 passed, 6 skipped（六個皆為
     Windows 上跳過的 POSIX-only 案例，與 bootstrap baseline 一致）。
   - `test-kit-manager-api`：14 passed。
   - 其餘九條 PowerShell 契約套件全 PASS。
2. **`harden-cad-extension-cache`（命令 12）**：於部署 checkout 以
   deploy.ps1 Phase 2 同形命令執行（`--repo-root <deploy_root>/bim-streaming-server`），
   stdout 恰為 `{"schema_version":"cad-extension-cache-hardening/v1","status":"passed"}`，
   exit 0。
3. **`canonical-linux-rebuild`（命令 13）**：從 fresh `origin/main`
   （`c88dca63e`）隔離 worktree 以正規形
   `pwsh -NoProfile -NonInteractive -File scripts/dev/rebuild-test-deploy.ps1 -Build -InventoryPath '<owner-private-inventory>' -IdentityFile '<owner-private-identity>'`
   執行（owner 於本 session 內確認 canonical target 摘要與指紋後授權）。
   遠端部署 **exit=0**；建立並推送 deployment tag
   `deploy-20260811-639220494716638402-004`。canonical env 以暫存複本
   staging（protected ACL、gitignored），用畢即刪（`created` → `removed`）。
4. **`canonical-linux-deployment-verify`（命令 14）**：於遠端 deploy_root 以
   `AI_BIM_DEPLOY_TARGET_INVENTORY=<runtime_data_root>/target.local.json pwsh -NoProfile -NonInteractive -File scripts/verify-all.ps1 -Profile Deployment`
   執行，六項全 Passed（deployment required artifacts、coordinator health、
   governance health、conversion health、kit manager health、viewer endpoint）、
   Failed 清單為空，exit 0。

## Prior sweep（同日稍早，非 attested run）

同日稍早的第一輪已將全部 14 條命令跑至 exit 0，但時序為 13→12→14
（hardener 的獨立重跑在 rebuild 之後）且本地兩條 pytest 因 `.venv` 空殼退化
經重建後補跑；review 指出該時序不符 opening contract 的精確順序，故以上節的
嚴格順序單趟重跑並以其為 attested run。第一輪的其餘事實仍為有效脈絡：

- 該輪 rebuild（deploy tag `deploy-20260811-639220482065640754-003`）首次證明
  **#487 修復在正規機制路上生效**：Kit build phase 由部署 checkout 的
  stdin-fed wrapper 啟動，`repo.sh build` 真實執行且
  `Kit runtime build artifacts ready`（對照修復前同一 host 的撕碎簽名：
  1 秒假完成、artifacts 缺失、exit 2）。本輪（`-004`）rebuild 在 artifacts
  已就緒下按契約重驗其餘 phases 全綠。
- root `.venv` 依既有配方（`python -m venv --clear` ＋ 九件組 pin）重建。

## Operational findings fixed in-run（非機制變更）

第一輪 rebuild 於 Phase 2 被 #484 的 CAD 硬化正確 fail-closed 擋下
（`converter_unavailable`），根因為兩處 **group-writable（775）目錄**，皆屬
部署 runtime 狀態、非 repo 機制檔：

1. owner extension cache 的 package 目錄
   `~/.local/share/ov/data/exts/v2/omni.services.convert.cad-508.0.1+…`
   （Kit 套件管理器於本日 build 時以 775 重建）；
2. deploy checkout 的 `deploy_root` 與 `deploy_root/bim-streaming-server`
   （本日 reset/clean 重建時吃到 umask 002）。

處置：`chmod 755` / `chmod go-w` 收斂後硬化通過；嚴格順序 attested run 在
收斂後的狀態上執行。此即 #484 trust-root ancestry 驗證設計要抓的
套件/環境權限漂移；**復發風險**：未來 Kit 套件更新或 checkout 重建可能再現
775，屆時硬化會再次 fail-closed（症狀同 `converter_unavailable`），先查本節
兩類目錄的權限。

## Known limits

- Full-system browser、Kit/WebRTC first-frame、USD stage、DataChannel E2E
  不在本 fixpoint 主張範圍（同 bootstrap evidence 的邊界宣告）。
- fixpoint runner 的 PowerShell 函式管線污染 bug（Write-Output 混入 return
  值）於第一輪重現，attested run 全程以「jsonl process-level exit code＋
  單命令 ssh」記錄規避；exit code 以 jsonl 為準。
