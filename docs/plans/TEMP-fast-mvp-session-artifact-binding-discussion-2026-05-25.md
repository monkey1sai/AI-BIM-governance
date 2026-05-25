# TEMP: Fast MVP session / artifact binding discussion notes

> 文件性質：暫存討論筆記，非 source of truth，非 OpenSpec change，非正式 roadmap。
> 日期：2026-05-25
> 範圍：只整理目前對 fast MVP demo、`ifc-ready`、review session、viewer stage truth 的共同理解。

## 目前共同理解

fast MVP 的正式觀看路徑不是「viewer 永遠載入最後一筆轉檔」，而是：

```txt
viewer 載入目前 review_session_id 的 stream-config
→ stream-config 指定 expected stage URL
→ viewer 發 openStageRequest
→ Kit 載入該 expected stage
→ Stage truth 比對 expected 與 loaded
```

因此，`stream_conv_.../model.usdc` 是某次 streaming conversion job 的輸出，不是 BIM 業務語意上的 root。

## `api/external/ifc-ready` 的語意

`POST /api/external/ifc-ready` payload 內的 `project_id`、`version` / `external_model_version_id` 才是 BIM 業務語意上的定位資訊：

```txt
project_id
└─ version / external_model_version_id
   └─ derived primary artifact: model.usdc
      └─ produced by conversion_job_id: stream_conv_...
```

目前可以把欄位語意理解為：

| 欄位 / ID | 語意 |
|---|---|
| `project_id` | 這場審查屬於哪個專案 / 工作範圍 root |
| `version` / `external_model_version_id` | 這場審查要看的模型版本 |
| `stream_conv_...` | 產生 USDC 的 runtime conversion job id |
| `model.usdc` | viewer / Kit 實際載入的 primary 3D 成果檔 |
| `review_session_id` | viewer 啟動與 stream-config 查詢的會議上下文 |

## Stage truth 的判讀

當 viewer 顯示：

```txt
expected: http://127.0.0.1:49101/artifacts/stream_conv_xxx/model.usdc
loaded:   http://127.0.0.1:49101/artifacts/stream_conv_xxx/model.usdc
WebRTC:   started · kit_host_native_001 127.0.0.1:49100/47998
```

代表：

```txt
1. coordinator 給 viewer 的 expected stage 是該 conversion job 的 model.usdc
2. Kit / viewer 回報實際 loaded stage 也是同一個 URL
3. WebRTC 已連到 host-native Kit instance
4. 此 session 的 stage-load evidence 是 matched
```

這只證明「此 viewer 正在看此 session 指定的 primary artifact」。

不直接證明：

```txt
- IFC→USDC 幾何或語意品質完全正確
- element mapping 每筆都正確
- cloud callback 已被真實外部雲端接收
- 任意舊 asset 可被視為本次 session 的正式觀看結果
```

## 2026-05-25 live viewer 只讀觀察

觀察對象：

```txt
viewer URL: http://127.0.0.1:5173/?session=review_session_728ae2c982b8
session_id: review_session_728ae2c982b8
project_id: 765
model_version_id: 23cd2e90-9d50-4b39-950f-8c4f4944d599
conversion_job_id: stream_conv_20260525023531_f8c659cb
primary artifact: auto_usdc_stream_conv_20260525023531_f8c659cb
```

只讀 API 觀察到：

```txt
expected stage URL = http://127.0.0.1:49101/artifacts/stream_conv_20260525023531_f8c659cb/model.usdc
loaded stage URL   = http://127.0.0.1:49101/artifacts/stream_conv_20260525023531_f8c659cb/model.usdc
WebRTC             = started · kit_host_native_001 127.0.0.1:49100/47998
```

因此此場 session 的「載入正確檔案」與「WebRTC started」可以視為通過。

但轉檔 metadata 顯示：

```txt
source: ifcopenshell_openusd_fallback
primary_converter_error: A3D_LOAD_CANNOT_LOAD_MODEL
```

這代表 primary HOOPS / Kit converter 沒有成功匯入該 IFC；目前 viewer 看到的是 fallback converter 產物。fallback 可產生可開啟的 `model.usdc`，也可產生 sidecar，但不能直接視為 primary converter 的語意保真成果。

`quality_metrics.json` 顯示：

```txt
source_ifc_entity_count: 4889
mapped_count: 4889
coverage_ratio: 1.0
coverage_status: pass
materialization_strategy: ifcopenshell_openusd_fallback
minimum_coverage_baseline_locked: false
hard_quality_gates.usdc_openable: true
hard_quality_gates.has_renderable_prims: true
hard_quality_gates.placeholder_output: false
```

這代表目前有 4,889 筆 IFC entity 對應到 USD prim，且不是 placeholder output；但 baseline 尚未 locked，因此只能說「fallback 產物有 sidecar coverage」，不能說「BIM 語意驗收已通過」。

`element_mapping.json` 目前是 shape-level 對照：

```txt
ifc_guid -> /World/IfcShape_000001
ifc_guid -> /World/IfcShape_000002
...
```

所有 4,889 筆 sample path 都是 `/World/IfcShape_NNNNNN` 型態；mapping item 沒有直接帶 `ifc_type` / `name` 等語意欄位。

`entity_index.json` 有較完整的 IFC 語意，例如：

```txt
IfcCableCarrierSegment
IfcBuildingElementProxy
name: 電氣系統-出線口...
```

但這些語意目前沒有直接進入 viewer 可操作的 `element_mapping` item。也就是說，資料層有部分語意，但 viewer 的 mapping/highlight 操作仍主要拿 `usd_prim_path` 做 USD selection。

## 不合理橘色高亮的目前判讀

截圖中的橘色放射狀線段不應視為「BIM 語意構件高亮成功」。目前較合理的判讀是：

```txt
DataChannel highlightPrimsRequest
→ Kit 端使用 USD selection 作為 highlight fallback
→ 若選到 /World、大父層、或粗粒度 /World/IfcShape_NNNNNN mesh
→ Omniverse selection overlay 把大量 edge / outline 一起以橘色顯示
```

Kit 端 highlight handler 目前會回傳：

```txt
selected_paths
missing_paths
fallback_paths
applied_mode: selection
```

若 `fallback_paths` 不為空，或 selected path 不是 expected mapping path，viewer 應判定 mapping highlight 未通過。即使畫面出現橘色，也只能代表 selection overlay 被套用，不代表 IFC 語意構件被精準定位。

目前這張截圖暴露出的缺口不是 UI 功能不足，而是：

```txt
1. primary IFC→USDC converter 失敗，目前使用 fallback 產物。
2. element_mapping 是 shape-level path 對照，尚未提供 viewer 足夠的 BIM 語意。
3. highlight 使用 USD selection fallback，可能選到過大或不夠語意化的 prim。
4. Stage truth matched 只能證明載入檔案一致，不能證明語意與構件高亮正確。
```

以目前最小 MVP 目標判定：

```txt
接收 webhook：已通
IFC → USDC：有產物，但目前是 fallback 成果，品質不可視為 primary converter 通過
WebRTC：已通
viewer 載入正確檔案：已通
viewer 正確顯示原 IFC 建築資訊 / 語意：未通
viewer 高亮正確 BIM 構件：未通
```

## 不做審查問題時，Element mapping 的保留判斷

目前討論收斂為：即使暫時不做「審查問題 / issue」功能，`element_mapping` 這個資料能力仍應保留；可調整的是 viewer 上的問題導向 UI。

需要分成兩層看：

```txt
Element mapping 資料能力
= 應保留

目前畫面上的「用選取元件試標問題 / 試聚焦」操作
= 可視為驗收 / 除錯工具，不必作為正式 demo 主流程
```

理由是：若 MVP 目標只是「看見模型」，mapping 可以不放在主畫面；但目前目標包含「viewer 正確顯示原 IFC 的建築資訊 / 語意」，則 mapping 是必要橋接層。

沒有 mapping 時，viewer 最多只能證明：

```txt
我載入了一個 model.usdc
我看到一批 3D 幾何
```

但無法可靠證明：

```txt
這個 3D 物件來自哪個 IFC entity
它是 IfcWall / IfcBeam / IfcCableCarrierSegment / IfcBuildingElementProxy
它的 GUID / name / type 是什麼
點選或聚焦時能否回到原 BIM 語意
```

因此，不做審查問題時，mapping 的用途從：

```txt
issue / 審查問題 → BIM 元件 → 3D 高亮
```

收斂為：

```txt
IFC 元件 → USD prim → viewer 顯示 BIM 語意 / 驗證轉檔正確性
```

目前暫存判斷如下：

| 項目 | 暫存判斷 | 理由 |
|---|---|---|
| `element_mapping.json` | 保留 | IFC GUID 對到 USD prim，是語意橋 |
| `entity_index.json` | 保留 | 保存 IFC type / name / entity info |
| viewer 讀 mapping 的能力 | 保留 | viewer 才能顯示 BIM 語意，不只是幾何 |
| 「載入元件對照表」 | 可保留 | 作為 mapping 是否可用的驗收 / 除錯入口 |
| 「用選取元件試標問題」 | 可降級或改名 | 語意偏 issue workflow；不做審查問題時不應是主流程 |
| 「用選取元件試聚焦」 | 可保留 | 可驗證 IFC entity 是否能定位到 3D 空間 |
| mapping panel | 可弱化或放進 technical details | demo 主流程不一定需要暴露完整操作面板 |

一句話結論：

```txt
不做審查問題時，可以拿掉 issue 語境；
但不能拿掉 mapping 能力，否則 viewer 無法證明它顯示的是原 IFC 的 BIM 語意。
```

## 右側 USD / USDC 成果檔選單的現況理解

viewer 右側下拉選單可能列出多個 USD / USDC asset，例如：

```txt
BIM: 許良宇圖書館建築 2026
auto_usdc_stream_conv_...
```

但在目前 session-first 行為下，正式載入依據仍是 session stream-config 的 expected stage。

若使用者選到與 session expected URL 不一致的 asset，可能造成：

```txt
expected = session primary artifact
loaded   = user-selected legacy/debug asset
stageLoadStatus = mismatch
```

因此，右側下拉中的舊 asset / debug asset 不應直接等同於目前 fast MVP session 的正式 primary model。

## 關於 project root 與 primary artifact 的結論

目前討論收斂到的語意模型是：

```txt
Review Session
= project_id 作為審查上下文 / 專案 root
+ version / external_model_version_id 作為模型版本
+ primary artifact binding 指向該版本的 ready USDC
+ viewer 依該 session 的 stream-config 啟動觀看
```

也就是說，最合理的抽象不是：

```txt
viewer 看最後一筆 stream_conv
```

而是：

```txt
viewer 看某個 project_id + version 對應 session 內被指定為 primary 的 USDC artifact
```

## 參考外部架構後的前端重新定位

參考來源：

```txt
https://bim-docs.jackshappybot.com/
頁面標題：BIM 模型管理平台 — 系統架構
```

該架構頁的核心判讀：

```txt
公司雲端
= 輕量治理：RBAC / 版本 / API / 任務 / 狀態 / 簽章 URL / 索引

客戶落地端
= 重量資料中樞：.rvt / .ifc / .usdc / 3D 幾何 / IFC 轉檔 / GPU 3D 串流
```

網站將客戶落地主機定位為「落地端重量資料伺服器」。其責任包括：

```txt
- 模型檔案儲存
- IFC 轉檔運算
- GPU 3D 串流
- Omniverse Kit + WebRTC
- IFC→USDC Authority
- 資料品質指標
- 構件索引，供瀏覽端點選對應元件
```

因此，本專案 viewer 的前端不應再被設計成「審查會議 demo 操作台」為主，而應重新定位為：

```txt
Edge BIM Data Server Console
= 落地端重量資料伺服器的操作與驗收畫面
```

前端主畫面要回答四個問題：

```txt
1. 這是哪個 project / version 的資料包？
2. IFC 是否成功轉成可信的 USDC？
3. WebRTC 是否穩定載入正確 stage？
4. viewer 是否能證明這不是只有幾何，而是有 IFC / BIM 語意？
```

## 前端畫面資訊架構暫存規劃

在「不要新增其它功能」的前提下，前端應以重排、改名、分層為主：

```txt
┌──────────────────────────────────────────────────────────────┐
│ Top Bar: Edge BIM Data Server · project_id · version · status │
├───────────────────────────────┬──────────────────────────────┤
│                               │ 右側 Inspector               │
│        WebRTC 3D Viewer        │                              │
│        Omniverse stream        │  1. 本機資料包                │
│                               │  2. 轉檔品質                  │
│                               │  3. BIM 語意對照              │
│                               │  4. 技術細節                  │
├───────────────────────────────┴──────────────────────────────┤
│ Bottom Evidence Strip: webhook / conversion / stage / WebRTC  │
└──────────────────────────────────────────────────────────────┘
```

主畫面仍應以左側 WebRTC 3D stream 為第一視覺，因為本產品的核心是：

```txt
重量模型在落地端 GPU 上跑
瀏覽器只觀看串流
完整幾何資料不需要繞行公司雲端
```

右側 Inspector 建議分為四層：

```txt
1. 本機資料包
   - project_id
   - version / external_model_version_id
   - review_session_id
   - conversion_job_id
   - primary artifact: model.usdc
   - mapping_url
   - entity_index_url

2. 轉檔品質
   - converter source
   - primary converter 是否成功
   - fallback 是否啟用
   - mapped_count
   - coverage_ratio
   - baseline locked / not locked

3. BIM 語意對照
   - 保留 Element mapping
   - 拿掉 issue / 審查問題語境
   - 驗證 IFC entity → USD prim → viewer 高亮 / 聚焦

4. 技術細節
   - stage tree
   - DataChannel log
   - Socket.IO log
   - repo map
   - Interaction lab
```

## 目前 demo UI 應弱化的項目

以下能力不一定刪除，但不應作為現階段主流程：

```txt
- 建立或載入審查會議
- 連線即時頻道
- 標示範問題
- 建立審查標註
- Repo map
- Interaction lab
- Issue / annotation 語境
```

原因是目前目標不是多人審查，也不是 issue workflow，而是：

```txt
webhook → IFC → USDC → WebRTC → BIM semantic viewer
```

現有 step 文案可暫時收斂為：

```txt
① 接收 IFC-ready webhook
② 產生本機 USDC 資料包
③ 啟動 Kit / WebRTC 串流
④ 驗證 BIM 語意對照
```

不建議在現階段主流程繼續突出：

```txt
標記問題
記錄回寫
審查會議
```

除非該階段重新回到正式審查產品。

## 前端狀態語意應拆開

目前畫面容易把所有狀態都用 `ready` 表示，容易讓使用者誤解為「全部成功」。後續畫面應拆成三種 ready：

```txt
File ready
= model.usdc 存在，可載入

Runtime ready
= WebRTC started，stage expected == loaded

Semantic ready
= mapping / entity_index 可用，選取元件能正確定位，不是 fallback 大範圍 selection
```

以 `review_session_728ae2c982b8` 這場觀察來看：

```txt
File ready: yes
Runtime ready: yes
Semantic ready: no / incomplete
```

前端應直接呈現這個差異，避免使用者把「stage matched」誤解成「IFC 語意也正確」。

## 前端重新規劃的一句話結論

最適合現況的前端不是加功能，而是把既有能力重新排序、重新命名、重新分層：

```txt
從「fast MVP 審查 demo 操作面板」
轉成「落地端 BIM 重量資料伺服器的可信狀態面板」
```

主畫面保留：

```txt
- 3D stream
- project / version / session binding
- conversion quality
- mapping / entity semantic verification
- stage truth / WebRTC evidence
```

主畫面弱化：

```txt
- 審查問題
- 標註
- 多人協作
- repo map
- demo lab
```

## 尚未升格為正式決策的部分

以下只是目前討論中的概念，尚未視為已採納實作：

```txt
- coordinator 端可否在建立 session 前選擇 primary observable artifact
- 一個 session 是否綁多個 USD / USDC artifact
- 多 artifact 是單選切換、primary + secondary subLayers，或多 viewer 比較
- 已開啟 viewer 是否允許重新綁定 primary artifact
```

這些項目若要落地，仍需另行確認正式需求與 OpenSpec change。

## 49101 host-native conversion service 狀態 UI 觀察

2026-05-25 觀察結果：

```txt
http://127.0.0.1:49101/health

status: ok
authority: bim-streaming-server
service: host-native-conversion-authority
role: conversion-only
claims:
  ifc_to_usdc_conversion: true
  webrtc_49100: false
  kit_launcher: false
```

這代表 `127.0.0.1:49101` 目前不是 Kit / WebRTC viewer 本體，而是
`bim-streaming-server` 的 host-native conversion authority。它提供 IFC→USDC
轉檔 API，例如：

```txt
POST /api/conversions/ifc-to-usdc
GET  /api/conversions
GET  /api/conversions/{conversion_job_id}
GET  /api/conversions/{conversion_job_id}/result
```

本次重啟觀察重點：

```txt
1. 舊的 49101 process 需要先確認是否來自舊 worktree。
2. 只看 /health 不夠，因為 /health ok 只代表 service process 活著。
3. 真正可用要再確認 POST conversion job、job result、artifact path、kit stdout/stderr log。
4. 截圖顯示目前重啟流程正確：舊 server 已 shutdown，新 server 已從目前 repo 啟動，
   /health 回傳 ok，且已有 POST /api/conversions/ifc-to-usdc 202 Accepted。
```

關於是否要把此狀態做成 Web UI：

```txt
合理，但不應放進目前 change id `streaming-server-capture-kit-conversion-logs`。
```

原因：

```txt
- 目前 change id 的範圍是 capture Kit conversion logs / PowerShell wildcard plan gap。
- 49101 service status / job monitor UI 屬於前端資訊架構與 coordinator dashboard 規劃。
- 這個 UI 不應新增轉檔能力，只是把既有 API 狀態可視化。
- 若整合到 coordinator，coordinator 應只扮演 status proxy / dashboard host，
  不應取代 streaming-server 的 conversion authority。
```

未來若規劃 UI，最小合理範圍是：

```txt
coordinator UI 顯示：
- conversion service health
- service role / claims
- recent conversion jobs
- job status / artifact path
- kit_stdout_log / kit_stderr_log 是否存在
- File ready / Runtime ready / Semantic ready 三段狀態

不新增：
- 新轉檔流程
- 新 artifact binding 規則
- 新多人審查功能
- 新 issue / annotation workflow
```

這個想法應歸入後續「落地端重量資料伺服器前端重規劃」或新的 OpenSpec change，
不應追加入目前 implementation apply 的 scope。
