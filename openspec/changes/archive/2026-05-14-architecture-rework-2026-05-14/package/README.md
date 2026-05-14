# architecture-rework-2026-05-14 OpenSpec 草案包

這包是針對新版 HTML 架構工作台與使用者決策產出的 **OpenSpec 需求方案草案**。它不修改產品程式碼，只提供可放進 repo 的 OpenSpec change、spec delta、合約草案與套用說明。

## 已採用的使用者決策

1. `bim-review-platform` 是 root repo 內的整合部署邊界，不是新的 nested Git repo。
2. `_bim-control` 的 Revit Plugin 是 fake / PoC intake API，不是真的把 Revit runtime 放進 `_bim-control`。
3. 採用 **B 方案**：`bim-streaming-server` 成為 IFC→USDC conversion job authority；`_worker` 只負責 RVT→IFC bridge 與 `ifc_ready` handoff。

## 包內重點

```txt
openspec/changes/architecture-rework-2026-05-14/
  proposal.md
  design.md
  tasks.md
  specs/
    bim-control-revit-intake-facade/spec.md          # new
    worker-rvt-ifc-bridge/spec.md                    # new
    bim-review-platform-boundary/spec.md             # new
    streaming-ifc-usdc-conversion-authority/spec.md  # new, B 方案核心
    streaming-usd-stage-composition/spec.md          # new
    conversion-webhook-lifecycle/spec.md             # new
    worker-artifact-pipeline/spec.md                 # modify existing
    review-session-request-lifecycle/spec.md         # modify existing
    multi-artifact-kit-routing/spec.md               # modify existing
    streaming-multi-layer-payload-loading/spec.md    # modify existing
    session-first-review-viewer/spec.md              # modify existing
    demo-runtime-readiness-smoke/spec.md             # modify existing
    documentation-source-of-truth/spec.md            # modify existing

docs/architecture/ARCHITECTURE_ALIGNMENT_NOTES.md
docs/contracts/drafts/*.md
```

## 建議使用方式

1. 在本機 repo 建 branch：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance
git switch main
git pull --ff-only
git switch -c codex/openspec/architecture-rework-2026-05-14
```

2. 將本 zip 內的 `openspec/changes/architecture-rework-2026-05-14/` 複製到 repo 對應位置。

3. 先只驗 OpenSpec：

```powershell
openspec validate architecture-rework-2026-05-14 --strict
```

4. 驗證通過後，再進入 `/openspec apply architecture-rework-2026-05-14` 或人工切片實作。

## 注意

這包沒有包含任何 font、HTML bundle、build output 或大型 BIM artifact。它是文字規格包。
