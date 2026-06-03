# Design — a1-bcf-export

## 決策 1：自寫 BCF vs 用 bcf-client（授權）

`ifctester` 安裝時附帶 `bcf-client`，能直接讀寫 BCF。但 `bcf-client` 授權為 **GPLv3**（已用 `importlib.metadata` 確認）；任何 import 它的程式都受 copyleft 約束，會污染此專有 `governance-service`。

BCF 2.1 本身是 buildingSMART 開放標準，格式即一個 `.bcfzip`（zip）內含 XML。產生它不需要 GPLv3 程式庫。**決策：以 Python stdlib（`zipfile` + `xml.etree.ElementTree`）自寫最小 writer**，零新增依賴、零授權風險。代價是只支援匯出所需的子集（component selection viewpoint，不含 PNG snapshot），對「把治理 issue 帶進其他工具」這個目標已足夠。

## 決策 2：BCF 2.1 檔案結構（最小可互通子集）

```
governance-issues.bcfzip
├─ bcf.version                      # <Version VersionId="2.1">
└─ <topic_guid>/
   ├─ markup.bcf                    # Markup/Topic(+TopicStatus) + Comment + Viewpoints
   └─ viewpoint.bcfv                # VisualizationInfo/Components/Selection/Component[@IfcGuid]
```

- 每個 issue → 一個 `<topic_guid>/` 目錄（topic_guid 為新生 UUID，非 issue id，符合 BCF topic 慣例）。
- `markup.bcf` 的 `Topic@TopicStatus` 由內部狀態映射（open→Open、in_progress→In Progress、resolved/rejected→Closed、reopened→ReOpened）。
- `Comment` 內嵌 `model_version` / `ifc_guid` / `source_type`，讓接收端不丟失溯源。

## 決策 3：哪些 issue 可匯出（BCF 政策 rule 10）

只有 `kind=issue` 且有非空 `ifc_guid` 的 issue 會成為 BCF topic。`annotation`（無 guid 的視覺標註）**不匯出**——因為 BCF viewpoint 的構件定位主鍵是 `IfcGuid`（rule 3），沒有 guid 的標註無法在其他工具穩定還原。`build_bcfzip` 回傳 `(bytes, count)`；count=0 時 API 回 404（誠實：沒有可匯出的正式 issue，而非回空 zip 假裝成功）。

## 邊界

- governance-service 為 issue / BCF 權威；瀏覽器只經 coordinator `:8004` proxy 取 `.bcfzip`，不直連 `:49102`。
- coordinator 純二進位透傳（沿用既有 `forward(..., binary=true)`），不解讀 / 不保存 BCF。
- 不引入 BCF 匯入；不復活已退役的 socket collaboration。

## 交叉驗證

- 單元測試解開自寫 `.bcfzip`、用 `xml.etree` 解析，斷言 `bcf.version`=2.1、Topic/TopicStatus、viewpoint `Component@IfcGuid`、annotation 被排除、status 映射。
- API 測試經 TestClient 實際走 `GET /api/bcf/export`，驗證 200（含正式 issue）與 404（只有 annotation）。
