## ADDED Requirements

### Requirement: Superseded design drafts SHALL point to the authoritative archive

當同一主題的設計文件已被正式 OpenSpec change archive 取代,殘留於 `docs/` 的舊草稿(brainstorming / pre-archive draft)SHALL 在頂部標記 superseded 並指向權威 archive 路徑,SHALL NOT 與 archive 並存而無區別以免讀者誤用過期決策。原草稿 MAY 保留作歷史脈絡,但 MUST NOT 被引用為現行設計權威。

#### Scenario: Pre-archive draft coexists with archived authority

- **WHEN** `docs/` 下存在一份設計草稿,其主題已由 `openspec/changes/archive/<change-id>/` 的正式 spec 取代(例:`docs/superpowers/specs/2026-05-26-one-click-deploy-design.md` 對 `openspec/changes/archive/2026-05-27-add-one-click-deploy-hybrid/`)
- **THEN** 該草稿頂部 SHALL 標記 superseded 並指向該 archive 權威路徑
- **AND** 決策以 archive spec.md 為準,草稿 MUST NOT 被引用為現行設計權威
- **AND** 草稿 MAY 保留供歷史脈絡,archive artifact SHALL NOT 被刪改(immutable)
