## 0. Archive Hold(2026-05-27)

**狀態:不歸檔(active 保留)**。本 change 與當前 main 版本不相符,理由三項:

1. **Spec 不通過 strict validate**:`specs/project-risks-mitigation/spec.md` 5 個 ADDED Requirements(`RISK-IN-MEMORY-QUEUE-PERSISTENCE` / `RISK-CI-GPU-VERIFICATION-BLINDSPOT` / `RISK-FALLBACK-VISUAL-INCONSISTENCY` / `RISK-WEBRTC-DATA-CHANNEL-RACE` / `RISK-AI-AGENT-HISTORICAL-HALLUCINATION`)描述使用「應建立 / 應...」語氣,缺少 OpenSpec 規約要求的 SHALL / MUST 關鍵字,`openspec validate project-risks-mitigation --strict` 報 5 個 error。
2. **對應實作未進 main**:相關 risk 防禦措施(sqlite queue 持久化、CI GitNexus 自動校驗、DataChannel 狀態機)未落地到 main;唯一相關 commit `8095796 docs: add project understanding, setup guide, and project-risks-mitigation openspec` 仍停在 `feat/understand-project` branch。
3. **Follow-up tasks 仍 pending**:Section 2「測試與流程加固(後續階段)」3 個 task(2.1 / 2.2 / 2.3)未完成,本身被標為「後續階段」backlog。

**後續處理建議**:
- 若要繼續推進:把 5 個 Requirement 改寫成 SHALL/MUST 語氣 → 落實 2.1 / 2.2 / 2.3 → 再開 PR 歸檔。
- 若認定為純文件式 backlog placeholder:用 `openspec archive --no-validate --skip-specs` 強制歸檔(不建議,會失去 strict validate 防線)。
- 目前選擇保留 active 等對應實作 PR 出來再一次歸檔,避免歸檔後 spec 與實際行為脫鉤。

---

## 1. 規格文檔與方案確認

- [x] 1.1 初始化專案風險規格文件並定義 Requirement ID
- [x] 1.2 完成風險對應的初步技術架構設計 (design.md)

## 2. 測試與流程加固（後續階段）

- [ ] 2.1 對 Coordinator 排隊佇列加入本地持久化 (sqlite 或 file-based)
- [ ] 2.2 在 CI 流程中整合 GitNexus 跨界防禦的自動校驗指令
- [ ] 2.3 在 WebRTC DataChannel 中對 Stage 載入指令加入連線狀態機
