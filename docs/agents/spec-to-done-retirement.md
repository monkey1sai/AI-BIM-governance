# spec-to-done 退役

文件性質：agent boundary。2026-09-11 使用者核准逐刀 PR 計畫後退役此技能。

現行退役契約：[spec-to-done-retirement Specification](../../openspec/specs/spec-to-done-retirement/spec.md)。它明確取代 ai-coding-governance 中的舊 workflow routing Requirement；原治理規格作為 pinned review-policy source 保持原 bytes 與 SHA，其他審查及 main 保護規則繼續適用。

一般任務依 F/B/G lane 執行；完整需求沿既有 source/spec 切成可獨立驗證的 PR，前一刀合入 main 後才開始下一刀。舊 P0–P7、NEW_RUN 與累計 agent 次數不是新任務的執行流程。

三個技能 discovery roots 的 spec-to-done 入口已移除。舊 workflow 名稱只保留零派工的 retired 回應，不能建立新 run、執行實作或宣告完成。

歷史 state、需求、模型、收據與證據保留。唯讀 state validator 與 trusted Git 驗證搬至 scripts/lib/legacy-spec-to-done；共用 port ownership helper 搬至 scripts/dev/ensure-host-native-ports-free.ps1。保留的 machine/Fabric/trusted-host contracts 僅供既有相容性與證據驗證，不授予新 workflow 或 merge 權限。

普通 PR 仍須適用測試、完整 diff review、required checks、無未解 threads，以及合格人類 exact-head approval。程序停止、網路、部署與資料操作保留原有授權及 ownership 邊界。
