## RENAMED Requirements

- FROM: `### Requirement: Repository SHALL provide a single fast MVP demo runbook`
- TO: `### Requirement: Repo SHALL 提供唯一的fast MVP demo runbook`

## MODIFIED Requirements

### Requirement: Repo SHALL 提供唯一的fast MVP demo runbook

Repo SHALL 在 `docs/demo/fast-mvp-demo-recap.md` 提供唯一 canonical fast MVP demo runbook，整合啟動順序、port matrix、host 與 container 邊界、WSL Kit graphics 限制、sample fixture 選取規則，以及僅使用 repo 內服務與 `tests/fakes` doubles 執行 coordinator + streaming-server + viewer 單機閉環 demo 所需的驗收條件。

#### Scenario: A new operator finds the demo runbook from the repo root

- **WHEN** 新操作人員從 repo root 尋找「如何執行 demo」
- **THEN** `README.md` SHALL 交叉連結至 `docs/demo/fast-mvp-demo-recap.md`
- **AND** product design sources SHALL 由 `docs/plans/docs-plans-README.md` 導向所有 tracked `docs/plans/*.html`
- **AND** manifest、goldens 與 visual results SHALL 明標為 HTML-derived validation artifacts，SHALL NOT 取代 demo runbook或 runtime readiness evidence
- **AND** 已刪文件、repo 外 design path 與 arbitrary screenshot SHALL NOT 作為 active demo/design authority
- **AND** `docs/demo/fast-mvp-demo-recap.md` SHALL 維持 demo orchestration knowledge 的單一來源

#### Scenario: Runbook references existing verification entries rather than duplicating them

- **WHEN** runbook 列出 service launch、verification 或 trigger commands
- **THEN** 它 SHALL 以相對路徑引用 `scripts/` 下既有 scripts 與 `docs/agents/sub-repo-verify-commands.md` 的驗證入口
- **AND** 它 SHALL NOT 複製 canonical command strings，以免 owning scripts 或 agent contract 變更時產生 drift
- **AND** 當既有 script 已涵蓋該步驟時，它 SHALL NOT 引入新的 `scripts/demo/` 子目錄或 orchestration scripts
