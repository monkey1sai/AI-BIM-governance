# Tasks：align-html-derived-design-gate-contract

每個 checkbox 都是獨立的 future commit＋push boundary；每項必須能在單一 session 完成、取得獨立驗證結果，且不得與其他項目重疊。

Scope guard：任何 task 都不得修改 HTML 內容、manifest、golden、baseline、capture script、rebaseline 行為、production UI、runtime、API、data/event、storage 或 session/conversion 行為。

## 1. Closed policy 與 ref-bound source collection

- [ ] 1.1 新增 closed-schema `scripts/config/design-gate-policy.json`，登錄 `ai-bim-frontend-backend-design` → `docs/plans/AI-BIM 前後端設計文件.dc.html` → `architecture_behavior` 與 `ai-bim-console-hifi` → `docs/plans/AI-BIM Console Hi-Fi.dc.html` → `console_hifi_visual`；複製目前已驗證的 Windows/Chromium、`windows-2025`、Node `20.20.2`、npm `10.9.4`、Playwright `1.61.1`、Chromium revision `1228`／version `149.0.7827.55`、DPR1、`1440x900`／`1920x1080`、`zh-TW`、`Asia/Taipei`、fonts-ready、animations-disabled、pixelmatch `0.1`、anti-aliasing excluded、max diff ratio `0.01`、semantic parity `1.0` 與 full-completion policy；以 schema fixtures 驗證 missing/unknown key 失敗，且 policy 不含自我參照 `policy_digest`。
- [ ] 1.2 實作 ref-bound source collector：current checkout source set 以 `git ls-files -- 'docs/plans/*.html'` 定義，base/head 則以等價 Git tree query 解析；對 raw Git blob bytes 計算 SHA-256，驗證 stable source ID、unique role、base-only deletion visibility，並以 tests 拒絕 external、origin-projected、untracked 與 ignored HTML。

## Future successors（不屬於本 change，尚未建立）

- `align-html-derived-design-gate-provenance`：承接原 2.1、2.2 的 field-level provenance registry、semantic locator 與 negative fixtures。
- `align-html-derived-design-gate-classifier-status`：承接原 3.1、3.2 的 base/head classifier、八值 status 與 atomic legacy migration。
- `align-html-derived-design-gate-typed-consumers`：承接原 4.1–4.3 的 typed consumers、design/runtime independence 與 final verification reporting。

上述 successors 尚未建立；本 change 不宣稱其實作或驗證完成。
