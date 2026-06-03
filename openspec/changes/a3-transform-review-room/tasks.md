## 1. Preflight

- [x] 1.1 以真實 pxr 26.5 probe 驗證 sublayer 強層 `Add*Op` 的 xformOpOrder append 語意（不 clobber member transform）。
- [x] 1.2 branch `codex/openspec/a3-transform-review-room`（stacked 於 a1-bcf-export）。

## 2. Tests First

- [x] 2.1 per-member transform：member root 自帶 translate → 合成 stage resolved transform = member ∘ federation；member usdc SHA1 不變；xformOpOrder 同含 member op 與 :fed op。
- [x] 2.2 rotate+scale 順序 = [scale, rotateXYZ, translate]（translate 最外層）；無 transform → `transformed` 空。
- [x] 2.3 review-room：build 後 ready=true + stage_composition.primary = federated_review.usda；build 前 ready=false 導引去 build；未知 set → 404。

## 3. Core

- [x] 3.1 `builder.py`：`_parse_transform` + `_apply_member_transform`（root layer over xformOp，scale→rot→translate）；build 結果加 `transformed`。
- [x] 3.2 `federation/api.py`：`GET …/review-room`（stage_composition handoff + 誠實 note）。

## 4. 前端 + proxy

- [x] 4.1 coordinator `GET /api/governance/federated-sets/:id/review-room` 透傳。
- [x] 4.2 governanceClient `reviewRoom` + `FederatedMember.transform_json` + `FederatedBuildResult.transformed`；FederationPage 位移輸入、transformed 顯示、Open in Review Room；兩個 p1 標示翻 asbuilt；更新 honesty smoke 測試。

## 5. Validation

- [x] 5.1 federation 測試（builder 7 + api 5）通過。
- [ ] 5.2 全套 pytest + viewer vitest（38）+ vite build + coordinator build。
- [ ] 5.3 `npx openspec validate a3-transform-review-room --strict`。

## 6. Closeout

- [ ] 6.1 commit + PR（stacked 於 a1-bcf-export PR #160）。
- [ ] 6.2 merge 後 archive。
