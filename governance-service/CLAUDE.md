# governance-service — Claude Mirror Entry

本檔是 [`governance-service/AGENTS.md`](AGENTS.md) 的 Claude 鏡像入口。完整規則以 sibling `AGENTS.md` 為準；衝突時依根目錄 `CLAUDE.md` §1 優先序解析。

重點：A1 rule-run authority（FastAPI `127.0.0.1:49102` loopback、純 CPU ifcopenshell、無 GPU）。瀏覽器只經 coordinator `:8004` 的 `/api/governance/*` proxy；`ifc_guid` 為主鍵、未對映 `usd_prim_path=null` 不捏造；ifctester 已安裝（支援 buildingSMART IDS）；BCF 2.1 匯出已實作（`bcf/` 匯出模組執行期只用 stdlib、不 import bcf-client；惟 ifctester 會在環境 transitive 安裝 bcf-client(GPLv3)，匯出產物不含其程式碼）。

Verify：

```bash
"/c/Program Files/Python312/python.exe" -m pytest tests/ -v
```
