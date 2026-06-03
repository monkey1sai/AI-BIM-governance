# Design — a3-transform-review-room

## 決策 1：per-member transform 如何不破壞 member（xformOp 合成語意）

需求：把 member 在 federation 世界裡位移/旋轉/縮放，但 member `model.usdc` 必須 immutable。

疑慮：`xformOpOrder` 是 `uniform token[]`，理論上「強層 opinion 完全覆寫弱層」。若 root layer 直接重設 `xformOpOrder`，會 clobber member 自身的 transform。

**以真實 pxr 26.5 ground-truth 驗證**（USD-Code MCP 在 headless 無授權，依專案既有 introspection 方法論改用本機 pxr 實測）：

```
member root /World/ARC 自帶 xformOp:translate = (10,0,0)
root layer 對 /World/ARC author over，呼叫 Xformable.AddTranslateOp(opSuffix="fed").Set((0,0,5))
→ 合成 xformOpOrder = ['xformOp:translate', 'xformOp:translate:fed']   ← Add*Op 讀 composed order 再 append
→ GetLocalTransformation().ExtractTranslation() = (10,0,5)              ← member 與 federation 皆生效
→ member.usda 重開：xformOpOrder 仍只有 ['xformOp:translate']          ← member 檔未變
```

結論：`UsdGeom.Xformable.Add*Op` 在 over 上會**讀現有 composed `xformOpOrder` 再 append**，member 既有 op 完整保留（其值仍從 member 弱層解析），federation op 落 **outermost**（最後套用）＝ world placement 語意。**不需手動 prepend-compose**；naive `Add*Op` 即正確。member 檔永不被開啟寫入。

順序：依 **scale → rotateXYZ → translate** 加，使 translate 成最外層 op（標準 TRS：先縮放、再旋轉、最後平移到世界位置）。op 命名空間加 `:fed` 與 member 自身 op 區隔。

## 決策 2：Open in Review Room 的誠實邊界

federated stage 的 GPU 串流需 host-native Kit（此機 Docker/WSL2 無繪圖驅動）。governance-service 是 CPU loopback，**不該也不能**啟動串流。

故 review-room 端點只產出 **handoff descriptor**：與 viewer `streamConfig.stage_composition` 同形的 `{ primary, secondary_layers }`。`primary.url` = 已 build 的 `federated_review.usda`（其本身已 sublayer 疊合所有 member），`secondary_layers` 留空。coordinator session + host-native Kit 才是實際載入與串流的權威。`note` 明說此邊界，不假裝開了串流。

build 前查詢 → `ready=false` + 導引去 build，不回半成品。

## 邊界

- governance-service 為 federation authoring 權威；不啟動 GPU、不控制 Kit viewport。
- 瀏覽器只經 coordinator `:8004` proxy；member usdc 唯讀（conversion authority 產出）。

## 交叉驗證

- builder 測試在合成 stage 上用 `GetLocalTransformation()` 斷言 member∘federation 合成、SHA1 證 member immutable、xformOpOrder 證未 clobber。
- api 測試經 TestClient 驗 review-room ready/未 ready/404 與 stage_composition 形狀。
