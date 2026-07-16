# 設計：以HTML為根的設計契約與雙閘驗收

## 1. 權威模型

| 層 | 權威範圍 | 不負責 |
|---|---|---|
| Git-tracked `docs/plans/*.html` | design gate 的唯一輸入；canonical IA／routes、2D chrome、layout、screens、states 與設計意圖 | 不證明 runtime 已實作，不覆寫 executable contracts |
| code＋tests/contracts | 現行 API、enum、安全、資料、runtime lifecycle 與建成行為 | 不創造 HTML 未核准的 design fidelity reference |
| manifest／route inventory／semantic cases／goldens | 從同一 subject commit HTML 抽取、正規化與 capture 的 machine artifacts | 不得成為平行設計權威 |
| capture CSS／scripts／CI result | render 與驗證機制 | 不得補畫、推測或批准 HTML 缺少的 surface |

Source set MUST 以 `git ls-files -- 'docs/plans/*.html'` 的結果建立，不能使用 directory scan 把 untracked file 納入，也不能從 repo 外絕對路徑 fallback。每個 source 的 repo-relative path、blob SHA-256、角色與可抽取 contract 必須寫入衍生 manifest。render runtime、`support.js`、fonts、`assets/` 與 `uploads/` 可以是 pinned dependencies，但不是 design authority。

目前 HTML 角色：

1. `AI-BIM 前後端設計文件.dc.html`：服務邊界、route map、IA、API／state 語意與交付規則。
2. `AI-BIM Console Hi-Fi.dc.html`：六類 screen 的 chrome、layout、component、interaction 與 visual state。

若未來新增 tracked `docs/plans/*.html`，它會進入 source set；在其 source role、stable IDs 與衍生策略尚未可機器解析前，design gate MUST fail closed，而不是靜默忽略。

## 2. HTML 機器契約

每份 HTML MUST 提供或可確定性抽取：

- stable `source_id`、`source_role`、版本與語系；
- canonical route 或 screen/state 對應；
- 對 visual source 而言，stable `screen_id`、`state_id`、viewport eligibility、dynamic-region mask 與 required semantic actions；
- 對 behavior/IA source 而言，canonical route、legacy redirect、live／concept／not-built provenance 與 backend boundary。

衍生 manifest MUST 記錄 extractor version 與 normalized contract digest。若同一 HTML-derived field 在兩份 HTML 互相衝突、HTML-derived manifest field 無法回溯到某個 tracked HTML node／metadata，或 policy-derived manifest field 無法回溯到 versioned policy path 與 digest，validation MUST fail。route inventory 只能由 design 文件的 canonical route map 派生；舊 `#home`／`#a1` 類 route 不得覆寫 `#/home`、`#/workspace?dock=...`、`#/pipeline`、`#/ops`、`#/app/:slug`。

## 3. 衍生產物

衍生 manifest 至少分開：

- `design_sources[]`：tracked HTML path、role、hash 與 contract digest；
- `render_dependencies[]`：runtime script、asset、font、browser／runner fingerprints；
- `route_inventory[]`：HTML-derived canonical route、surface、coverage state 與 source reference；
- `screens[]`：screen/state、viewports、semantic cases、golden hash 與 HTML source reference；
- `gate_policy`：只複製versioned `scripts/config/design-gate-policy.json` 的 engineering measurement policy與digest；manifest本身不是policy authority。

Route、screen、state與semantic design intent只能來自HTML；pixel threshold、runner、viewport、status enum與full-completion rule則來自versioned engineering policy。兩者都必須有source path/hash，manifest只能組裝與pin，不能手動發明任一類欄位。

Golden MUST 由 repo checkout 中的 visual HTML 在固定環境 capture。Production capture 則在同一 subject commit 的實際 frontend route 執行。任一 HTML source hash、normalized contract、render dependency 或 extractor version 改變，而 manifest／golden 未同步重建時，gate MUST fail closed。

## 4. 閘門流程

```text
tracked HTML source set + hashes
  -> extract and normalize route/screen/state contracts
  -> verify manifest is a lossless, traceable derivative
  -> derive changed scope from stricter base/head union
  -> product: passed | mixed | partial_reference_missing
  -> non-product: design_source_update_only | gate_infrastructure_only
  -> forbidden mixed: design_source_and_product_mixed_fail_closed
  -> unknown_fail_closed
  -> capture HTML-derived golden in fixed Windows environment
  -> capture production subject at the same screen/state
  -> pixel comparison at 1440x900 and 1920x1080
  -> branch-protected Playwright executes HTML-derived semantic cases
  -> CI emits visual-result.json; validator independently recomputes PNG metrics

functional/runtime browser flow
  -> canonical route/button/fixture/real API
  -> loading/success/failure/retry/domain and runtime IDs
  -> trace/network evidence
  -> Kit first-frame/stage/DataChannel ack when applicable
```

兩條 flow 均通過才可宣告 user-facing built。PR body、外部 semantic JSON、手填 boolean、既有 artifact 或非 current-checkout screenshot 不是 gate input。missing／skipped／blocked semantic case 一律失敗。

## 5. 狀態與範圍語意

- `passed`：所有 affected surfaces 都有可追溯至 HTML 的 approved reference，且 pixel、semantic 與衍生物完整性全過。
- `mixed`：affected scope 同時含 approved 與 `reference_missing`；必須跑全部 approved screens、列出 missing scopes，且 `Full completion claimed=no`。
- `partial_reference_missing`：affected scope 只有 HTML 未定義 surface；不得偽造 design result，functional/security bug fix可誠實繼續，但 `Full completion claimed=no`。
- `design_source_update_only`：只修改 tracked HTML與其 derivatives，不含production UI；可走獨立source review/rebaseline lane，但不是product pass，`Full completion claimed=no`。
- `gate_infrastructure_only`：只修改extractor、validator、CI或policy infrastructure；只跑schema/negative tests，不產生product visual pass，`Full completion claimed=no`。
- `design_source_and_product_mixed_fail_closed`：同一change同時修改tracked authority HTML與production UI。為避免moving-goalpost，MUST 拆成先落地source/rebaseline、後以已落地base驗production的changes；不得產生`passed`。
- `unknown_fail_closed`：path、route、source、artifact 或 extraction 關係無法分類；阻擋 product completion。

Shared bundle scope MUST 使用較嚴格的 base/head HTML-derived manifest 聯集，避免 head 端刪除 mapping 來縮小 gate。RVT↔IFC↔USDC lineage 的 Alignment、Attempts、Audit 與相關 detail panel，目前 HTML 沒有 reference，因此維持 `reference_missing`。

## 6. 量測與環境

Visual gate 固定 Windows runner、Chromium、DPR1、locale `zh-TW`、timezone `Asia/Taipei`、dark color scheme、font-ready、animations disabled，viewports 為 `1440x900` 與 `1920x1080`。每個 required viewport：

```text
pixel_diff_ratio = differing_in_scope_pixels / total_in_scope_pixels
pass iff pixel_diff_ratio <= 0.01
```

Required semantic cases MUST 100% 執行且通過。Accessibility 與 security 不得為像素對齊而移除。live WebRTC frame、GPU render 與核准 dynamic regions不納入 pixel baseline；它們由 functional/runtime gate 裁決。

## 7. 重新建立基準

一般 CI 只驗 tracked derivatives。Rebaseline 必須在獨立source-update lane中顯式、可 review地從 current checkout HTML重新抽取contract與capture，原子更新source hashes、policy digest、manifest、goldens與aggregate digest。包含production UI變更的同一change不得rebaseline後宣稱product pass；production比較必須以已獨立落地主線的HTML snapshot為base。不存在「接受外部 origin drift」或「只換 PNG 不換 source contract」的路徑。

## 8. 遷移

1. 先讓兩份 tracked HTML 提供／可抽取 stable machine metadata。
2. 建立 manifest v2，將 design source、render dependency 與 derived contract 分離。
3. 從 HTML 重建 canonical route inventory、screens、states、semantic cases 與 goldens。
4. 將 scope classifier、validator、CI、branch protection 與 PR machine fields切到 manifest v2；現行 `reference_authority_mixed_fail_closed` 必須在同一 implementation change 原子遷移為 canonical target `design_source_and_product_mixed_fail_closed`，新舊值不得同時被接受。
5. 移除外部 path／legacy route／已刪文件 fallback。
6. 完成 current subject 的 visual＋functional證據後，才可宣告 product fidelity；spec 或 infrastructure 完成本身不是通過。
