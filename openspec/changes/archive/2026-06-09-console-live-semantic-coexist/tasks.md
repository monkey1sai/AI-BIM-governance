## 1. 前端：語意面板與 live 3D 並存

- [x] 1.1 `MockViewport.tsx` 新增 `liveMode` prop；`liveMode=true` 套 `gv-mock--live` + 誠實 banner（「語意側欄 · live 3D 已出幀」），non-live 維持中央 deterministic·no-GPU 佔位；reserved padding 僅 non-live。
- [x] 1.2 `Window.tsx` MockViewport gate 移除 `!_hasRemoteVideoFrame()`、改傳 `liveMode={this._hasRemoteVideoFrame()}`（先 gitnexus_impact：MockViewport upstream LOW，僅 Window.render d=1）。
- [x] 1.3 `viewer.css` 新增 `.gv-mock--live`（左 400px 側欄 / 單欄 grid / z-index 18，不覆蓋中央 video、不與右側治理 overlay 重疊）。

## 2. 部署（viewer 入口為 :5173 docker viewer）

- [x] 2.1 重建 docker `viewer` image（baked source；`/ui/open` 302 轉址至 :5173），`up -d viewer` 套用。

## 3. 驗證

- [x] 3.1 `npx tsc --noEmit` 綠；viewer vitest 綠。
- [x] 3.2 Playwright 全 15 支綠：`element-semantics`（點 row → ②⑥⑤ 與 live 3D 並存）由紅轉綠、`issues-tab` 去 flaky、`gov-viewer-layout`（harness）回歸；截圖佐證左側語意側欄 + 中央 live 3D + 右側治理 overlay 並存。
- [x] 3.3 node 全鏈 smoke 另證 ②④⑥ 資料路徑（for-session 200 / 真實 psets+spatial+roadmap）。

## 4. 收尾

- [ ] 4.1 `npx openspec validate console-live-semantic-coexist --strict` 綠。
- [ ] 4.2 PR（繁中）→ CI + pr-review-agent 綠 → merge → archive/sync。
