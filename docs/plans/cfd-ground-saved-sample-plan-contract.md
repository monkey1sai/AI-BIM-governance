# 已保存原面版本的相對高度位置報告

本刀沿用 `cfd-ground-relative-sampling-contract.md` 的純位置算法，接入 coordinator 與明選面板。位置報告不是 CFD 結果，不讀 U/p、不改 Stage、不產生 run 或新求解。

## 來源與權限

Browser POST `/api/review-sessions/{sessionId}/ground-surfaces/selections/{selectionId}/sample-points`，body 僅 `bounds_m=[xmin,ymin,xmax,ymax]` 與正格距 `spacing_m`。使用 owning primary lease、source client、實際 active binding 與 coordinator 已確認版本 ledger；streaming 的 preview manifest 本身不能提供使用者確認權威。保存時的歷史 revision 是 provenance，不必等於目前 revision。

await 前複製 principal、conversion、primary ID／URL、lease、source client、當前 revision 及保存版本純值；回覆前再驗相同身分與 immutable version。變動、缺版本、跨模型或未授權拒絕，不接受 caller 頂點、faces、SHA、confirmed 或 URL。

Streaming 沿既有 internal auth，fresh snapshot 核对 registered USDC SHA、保存 manifest、原面完整幾何與預覽身分；同批 fresh faces 生成位置。顯示抬高 0.01 m 不參與取樣。來源與幾何 hash、schema、固定 1.5 m／display lift 0、三 false 狀態、每點 index/face/XY/高度與拒絕統計由 coordinator 驗证；請求格網的全部 XY 亦逐項核對。

## 有界性與操作

請求解析上限 8 KiB，包含 chunked body；最多 100 面／10,000 點／1,000,000 次面測試。Streaming 同時只接受一個位置計算，busy 回 429；不建立 job queue。輸出上限 8 MiB，coordinator transport 在 JSON 解析前累計 bytes，超限取消 reader；保留 timeout 與 redirect:error。來源 snapshot 沿既有 512 MiB 上限。這些上限不代表數值或工程精度。

面板僅使用 confirm+GET 或 restore+GET 的 `saved`，範圍預填原面 XY 邊界，使用者可縮範圍／改格距；邊界框內沒有來源的格點明確拒絕。顯示固定高度摘要、來源與目標 Z 區間、成功／拒絕數及原因，不建立 10,000 個 DOM rows。參數、draft、來源、版本或 readiness 變更清除舊報告，late response 不復活；連點只有一個請求。按鈕不送 Kit 圖層命令、不移動舊雲圖。

## 交付及後續

本刀需本機 auth／stale／HTTP budgets／UI race 測試、生成 OpenAPI/types 一致、獨立 full diff 審查、pr-safety、正常合併、canonical181 部署與可見 Chrome 原 session 產生位置／拒絕摘要驗收；檢查無新 run 或 layer binding。真地面定位、walkability、有效 fluid cell、solver ground/inlet/frame 與 terrain 入 mesh 仍未完成。新網格／U/p 重取樣／求解另列資源及停止重試計畫，不能重用已耗盡的 30 分鐘探針預算。
