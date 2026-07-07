# .claude/workflows — 索引

本目錄的 Dynamic Workflow 腳本清單與引用關係。新增 workflow 時同步補一列（repo-health 健檢會抓「無 in-repo 引用的孤兒 workflow」）。

## 索引

| Workflow | 用途 | 引用處 / 觸發方式 |
|---|---|---|
| `std-plan.js` | spec-to-done P1：產 plan → 四軸 plan review → GitNexus impact 預掃 | `.claude/skills/spec-to-done/SKILL.md` 編排 |
| `std-implement.js` | spec-to-done P3：逐 task 序列實作（impact→TDD→雙 review→commit）；mode=fix 修未閉合 findings | `.claude/skills/spec-to-done/SKILL.md` 編排 |
| `std-evidence.js` | spec-to-done P4：browser E2E 收 evidence → vertical slice 裁決 | `.claude/skills/spec-to-done/SKILL.md` 編排 |
| `fu-adversarial-verify-generic.js` | 參數化修復對抗複驗：per-finding 懷疑者（refute-by-default）＋ holistic critic | spec-to-done SKILL.md P5；`tests/test_fu_verdict_schema.py`、`tests/test_dacs_findings_contract.py` 硬編名稱/路徑（改名須連動） |
| `spec-to-done-adversarial-verify.js` | 對抗驗證 spec-to-done 四個落地檔（規範一致/技術正確/應用測試/防錯覆蓋） | 獨立 slash workflow（維護 spec-to-done 本身時用） |
| `ship-item.js` | 單一 work item 自動 ship：commit→PR→CI watch→buffered auto-merge→closeout | spec-to-done P6；權威程序見 `ship-item.md` |
| `ship-item.md` | ship-item 的權威程序文件（非腳本） | `ship-item.js` 引用 |
| `repo-health-scan.js` | 五面向 repo 健檢唯讀掃描（版本漂移/清理/.claude 資產/文件同步＋進度差異） | `.claude/skills/repo-health/SKILL.md` 編排 |
| `plan-next-spec-to-done-aware.js` | 推薦下一個 spec-to-done（考慮 merged ＋ in-flight branch） | 獨立 slash workflow（刻意無 skill 編排） |
| `plan-test-deploy-and-tidy.js` | 勘查測試區一鍵部署＋參數整理＋散落檔清理計畫 | 獨立 slash workflow（刻意無 skill 編排） |
| `fable5-repo-advisory.js` | 告別盤點：6 視角唯讀掃描＋合併去重＋懷疑者驗證 | 獨立 slash workflow（一次性盤點工具，保留可重跑） |
| `saas-blueprint-tournament.js` | 4 視角 SaaS 藍圖提案 → 3 評審 → 仲裁合成最終藍圖與逐檔 brief | 獨立 slash workflow；產出 docs/plans saas-* 語料（PR #301） |
| `routing.json` | spec-to-done 模型 routing 資料（tiers/fallback 鏈） | `scripts/gen_routing.py` codegen 至 std-*.js 的 `// <routing:gen>` 區塊 |

## 命名備註

- `std-` ＝ spec-to-done 三引擎前綴；`fu-` ＝ 修復對抗複驗（fix-up verify）家族前綴。`fu-` 名稱被 SKILL.md 與兩個 pytest 契約測試硬編，改名成本高於效益，維持現名並在此登錄定義（repo-health 2026-07-07 裁決）。
- 「獨立 slash workflow」＝僅靠 `export const meta.name` 被 harness 自動發現、無 skill/command 編排，屬刻意設計，非死碼。
