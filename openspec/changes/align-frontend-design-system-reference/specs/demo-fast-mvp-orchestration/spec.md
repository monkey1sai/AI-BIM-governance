## MODIFIED Requirements

### Requirement: Repo SHALL 提供單一 fast MVP demo runbook

Repo SHALL 在 `docs/demo/fast-mvp-demo-recap.md` 提供唯一 canonical fast MVP demo runbook，整合啟動順序、port matrix、host 與 container 邊界、WSL Kit graphics 限制、sample fixture 選取規則，以及僅使用 repo 內服務與 `tests/fakes` doubles 執行 coordinator + streaming-server + viewer 單機閉環 demo 所需的驗收條件。

#### Scenario: 新操作人員從 repo root 找到 demo runbook

- **WHEN** 新操作人員從 repo root 尋找「如何執行 demo」
- **THEN** `README.md` SHALL 交叉連結至 `docs/demo/fast-mvp-demo-recap.md`
- **AND** product requirement sources（`docs/plans/docs-plans-README.md` → TARGET/TRUTH/PROCESS，加上 repo-pinned design manifest/baselines 與兩份 legacy companion prototypes）SHALL NOT 取代 demo runbook
- **AND** design fidelity evidence SHALL NOT 取代 demo runtime readiness evidence
- **AND** `docs/demo/fast-mvp-demo-recap.md` SHALL 維持 demo orchestration knowledge 的單一來源

#### Scenario: Runbook 引用既有驗證入口而不複製內容

- **WHEN** runbook 列出 service launch / verification / trigger commands
- **THEN** 它 SHALL 以相對路徑引用 `scripts/` 下既有 scripts（例如 `scripts/start-all.ps1`、`scripts/demo-health-check.ps1`、`scripts/smoke-bscheme-intake.ps1`）與 `CLAUDE.md` §5 的驗證入口
- **AND** 它 SHALL NOT 複製 canonical command strings，以免引用的 scripts 或 `CLAUDE.md` §5 變更時產生 drift
- **AND** 當既有 script 已涵蓋該步驟時，它 SHALL NOT 引入新的 `scripts/demo/` 子目錄或 orchestration scripts
