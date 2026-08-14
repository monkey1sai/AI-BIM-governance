# Successor crosswalk：`align-frontend-design-system-reference` × `migrate-console-to-hifi-design`

> **性質**：requirement / successor 對帳。這份文件解除的是「互斥未裁決」阻擋，**不是 thaw**。  
> **日期**：2026-08-14  
> **裁決來源**：使用者確認的權威序（doc-first **提案**＝PR #360、**落地採納**＝PR #361；A4 產品面＝PR #429；align 維持 deferred）。  
> **subject_commit**：align／hifi 列綁在本 PR 分支上、含目前 observed source 的 ancestor snapshot。squash 進 `main` 後依既有 rebind 慣例另開 chore（見 #524／#528），不得把列綁到 `main` 上不相干的 sibling commit。  
> **雙方 change 仍維持原 status**：align = `deferred`／frozen／non-canonical／non-owner；hifi migrate = `active`。

## 0. 操作權威序（本 crosswalk 必須服從）

```txt
使用者最新明確指令
  → docs/plans HTML + docs-plans-README（doc-first：#360 提案、#361 採納）
      長相：AI-BIM Console Hi-Fi.dc.html + ai-bim-governance.css（--ab-*）
      行為：設計文件 §01–§08
  → tests/contracts/*.json（payload）
  → 已 archive 的 OpenSpec capability spec
  → 仍 active 的 change（只代表「這一刀還沒做完」）
  → deferred align：非規格代表，不得 apply
  → docs/superpowers/specs/*：歷史
  → code＋tests：只證明建成現況，不得改需求
```

驗收尺另層：`docs/plans/design-system-reference.manifest.json` 以 **2026-07-14** 核准快照為準；**A4（`workspace.a4.default`）聽 PR #429 `canonical_product_surface`**。任何 rebaseline 若把該格打回 origin mockup，必須 STOP。

## 1. 四軸裁決

| 軸 | align 主張 | hifi migrate 主張 | disposition | successor |
|---|---|---|---|---|
| HTML-only authority | design gate 唯一輸入＝tracked `docs/plans/*.html`；manifest／golden 只是衍生物 | 換皮；重用現有 manifest／capture，不重建 gate 權威 | **keep-docs-plans**：需求權威已由 #361（採納 #360 提案）／README 落地。**不採納** align 現在就把 CI gate 改成 HTML-only extractor。align 此軸未落地 delta 標 `obsolete-until-successor` | 未來若要做 HTML-derived manifest v2，必須**另開** successor change；不得 apply 本 align delta |
| repo 外唯讀 origin | 禁止 design gate 依賴 `C:\Repos\design\desigin-system` | task 6.4 仍要人同步 origin；capture 預設打 origin 靜態伺服器 | **keep-mixed-#429**：CI 維持 `tracked_snapshot_only`。Authoring origin 維持唯讀、本 repo 不回寫。12 屏 origin 投影保留；**A4 不得再走 origin** | 產品面保全＝open PR **#535**／issue **#508**。6.4 維持 human-only，不由本 crosswalk 改寫 |
| mixed-change fail-closed | 同一 change 改 tracked HTML + production UI → fail closed，必須拆 PR | 原始形狀是改 production CSS 再同案 rebaseline | **keep-align-intent-as-policy-already-in-docs**：現行 hifi **不得**再混改 HTML 權威與 production UI。本 PR 只動 OpenSpec／NOW，不改 HTML、不改 golden | hifi 後續 PR 繼續只動產品 CSS／頁面；source／rebaseline 另 lane |
| rebaseline ownership | 只能從 current checkout HTML 抽契約、拍 golden | 視覺落地後用舊 `capture-design-system-reference.mjs --rebaseline` 重鎖 13×2 | **keep-#429**：產品面 screen 必須保全 pinned SHA；origin 投影屏才可走 origin capture。hifi 7.1 在 #535 merge 前維持 STOP | **#535** 為軸 4 的 implementation successor。本 crosswalk 不複製其 capture 程式 |

## 2. 條文級 disposition（只列互斥／過期條）

| 來源 | 條文／產物 | disposition | 理由 |
|---|---|---|---|
| align `proposal.md` Why／What Changes | HTML 為 design gate 唯一權威輸入 | `accepted-as-requirement-already-landed` | 需求層已在 README／#361（#360 為提案）；gate 實作層未授權 |
| align tasks 1.1–1.4 | HTML source set／stable IDs | `deferred-no-thaw` | 未做；解凍前仍須使用者另開 successor |
| align tasks 2.1–2.5 | manifest v2、從 HTML 重拍 golden、禁 origin | `superseded-in-part` | 2.3 全量 HTML／origin 重拍會破壞 #429。保全產品面改由 #535 |
| align tasks 3.1–3.8 | classifier 新 enum、`design_source_and_product_mixed_fail_closed` 原子更名 | `deferred-no-thaw` | 改 gate 基礎設施＝Lane G successor，不得夾在 hifi 換皮 |
| align tasks 4.x | functional／runtime 雙閘 producer | `not-owned-by-this-pair` | 已由 product-operability／既有 CI 持有 |
| align tasks 5.1 | 移除對 `desigin-system`／已刪七檔的 **active** 依賴 | `accepted-docs-already` | README §4 已給去向；CI 不依賴絕對路徑。capture 的 origin 是驗收尺，不是需求正本 |
| align `specs/documentation-source-of-truth/spec.md` | 仍殘留已刪 `TRUTH`／`TARGET`／`PROCESS`／`BACKLOG` 所有權模型 | **`obsolete`** | PR #342 已刪七檔。此 delta **不得**當 canonical、不得 apply |
| align 其餘 delta specs | HTML-only gate／fail-closed enum | `non-canonical-frozen` | 維持在 change 目錄作歷史草案 |
| hifi `console-design-token-authority` | `--ab-*` 為 production token 真相源 | `keep-hifi-active` | 換皮工作單；不取代 HTML 需求正本 |
| hifi task 6.4 | 人同步 origin 與 repo 正本 | `keep-human-only` | AI 不寫入任一手寫正本 |
| hifi task 7.1 | 全量 `--rebaseline` | `blocked-until-#535`；之後只准保全產品面／重拍非 `canonical_product_surface` 屏 | 未修 provenance 前會還原 #429 A4。禁止再寫「13 screens 一律 generic rebaseline」 |
| hifi task 7.2–7.4 | origin verify／consumer spec 稽核 | `unchanged` | 7.2 綁 7.1；7.4 維持不勾（STALE／UNVER） |
| `docs/superpowers/specs/2026-07-16-migrate-console-to-hifi-design-design.md` | Superpowers 歷史稿 | `historical-only` | 非需求正本 |

## 3. 解凍／開工規則（fail closed）

**仍然禁止**

- 把 align 改成 `active` 或對其跑 `openspec apply`
- 平行再開第三個改同一 design-authority／manifest／golden／gate enum 的 active change
- 以 Superpowers spec 或本 align delta 覆寫 #361／#429
- 在 #535 進 `main` 前執行會寫入 `workspace.a4.default` PNG／sha256 的 generic rebaseline

**仍然允許**

- hifi migrate 繼續做 token／頁面換皮（不改 HTML 權威、不改 gate enum）
- #535 合併後，hifi 7.1 只能重拍 **非** `canonical_product_surface` 的屏，或對產品面做「保全 pinned digest、零覆寫」的 verify
- A4 產品行為只走 `a4-console-convergence`；`Full completion claimed: no` 不必叫醒 align

**align 若要真正 thaw**，必須另有：

1. 使用者本輪明確說 thaw／開 successor  
2. 新 change id（不得直接 apply 本目錄 0/23 舊 tasks）  
3. successor 逐條繼承上表 `deferred-no-thaw` 項，並排除所有 `obsolete`  
4. 不得與仍 open 的 hifi／#535 搶同一 capability

## 4. 本文件不改變的東西

- 不修改 `docs/plans/*.html`、`ai-bim-governance.css`、manifest、golden PNG  
- 不修改 `web-viewer-sample/scripts/capture-design-system-reference.mjs`（軸 4 程式 successor＝#535）  
- 不修改 `openspec/specs/` canonical capability  
- 不修改 `openspec/changes/archive/`
