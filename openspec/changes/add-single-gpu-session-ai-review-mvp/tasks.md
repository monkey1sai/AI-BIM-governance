## 0. 前置閘門與 Open Questions 收斂

- [ ] 0.1 向使用者揭示並取得裁決：OQ-A（max-hold 無硬上限是否可接受）、OQ-B（是否加 BCFzip fast-follow）、OQ-2（MVP AI 審查＝零模型確定性 IfcClash 的 headline 落差）；裁決與依據寫入可稽核文件，未決前對應 spec Requirement 標為待確認。
- [ ] 0.2 收斂 OQ-1/OQ-3/OQ-4/OQ-5/OQ-6 為實作前設計決策：GUID churn 資料模型形狀（新 draft vs merge-candidate）、忘關分頁第二回收路徑、認領視窗「起流」判準與 N 下限、soak 是否納 spectator+探針負載、ledger 持久化落點；各寫入 design.md 補充或獨立 ADR。
- [ ] 0.3 確認無 successor 衝突：`npx openspec list` 檢查無平行改同一 capability 的 active change；本 change 六個 capability 皆為 New，確認 `openspec/specs/` 無同名。

## 1. Phase 0 — gpu-session-baseline（量測 harness，`scripts/` + 部署文件）

- [ ] 1.1 在 `scripts/` 建立 `measure-session-baseline.ps1`：nvidia-smi 取 VRAM/利用率 + WebRTC health probe + TTFF；輸出結構化 JSON 報告含 GPU 型號盤點（判定消費級 RTX、MIG 不可用）、1 primary + k spectator VRAM 水位、TTFF、建立成功率。
- [ ] 1.2 在報告 schema 加「環境指紋」必填欄位（GPU 型號/driver 版/Kit 版/fixture hash+大小），缺欄位判不完整並拒絕被下游引用；於 `scripts/` 加最小驗證測試。
- [ ] 1.3 實作 ≥30 分鐘（目標 2 小時）soak：隔離 stack（獨立埠 + 獨立 governance，沿用 branch E2E 隔離模式）+ 獨佔量測窗 + 內建 keepalive health probe；輸出記憶體斜率報告；自然斷流記 finding、連兩次同點才判污染。
- [ ] 1.4 由 soak 報告訂洩漏 watchdog 門檻（只用本地實測、禁引用外部 GB/日 數字）；將 session 建立成功率下限/TTFF 上限/探針逾時/並發上限/idle-timeout/洩漏門檻以具體數值寫入可稽核部署文件並綁定環境指紋（禁模糊詞）。
- [ ] 1.5 撰寫「環境指紋變動即 SLO 失效須重跑基準」的部署文件段落與 G4 checklist 勾稽；驗證：無基準報告時 admission 參數 loader 拒絕上線（硬 gate 測試）。

## 2. Phase 1 — session-lifecycle（SessionBroker，`bim-review-coordinator` + `bim-streaming-server`）

- [ ] 2.1（coordinator）建立 SessionBroker driver 介面（SEAM-1）：一級 API `create(model_ref)`/`join(session_id, role)`；提供 `SingleGpuDriver` + `InMemoryFakeDriver`；driver 參數（並發上限/timeout）引用 Phase 0 報告，介面內不塞拍腦袋數字。
- [ ] 2.2（coordinator）實作 admission control（fail-closed，競爭單位＝會議 session）：既有 primary 佔用下新 primary 請求回 202 + 佇列位置，絕不多開第二 Kit primary；spectator 未滿分配 49110~49150、滿員 fail-closed 明確拒絕不轉佇列。封裝 `omni.services.livestream.session` REST 疊加路由，不動凍結三檔。
- [ ] 2.3（coordinator）實作 primary 佇列語意：requester-TTL 逾時自動出列遞補、輪到發「輪到你」+ 認領視窗、視窗內未起流讓位；MVP 無 preemption、無 max-hold（依 0.1 裁決）。
- [ ] 2.4（coordinator）實作 TTL/idle 回收：idle＝連續 T 秒無任一 readyState=4 peer（primary+spectator 皆計入），禁用輸入/滑鼠活動判 idle；顯式 terminate；idle-timeout 預設引用 Phase 0。
- [ ] 2.5（streaming/Kit）實作健康探針（readyState=4 + 影像尺寸 + DataChannel 回應，非 port-open）與 `-ResetUser` 自動復原：連續 N 次探針失敗觸發復原，失敗則 teardown 並寫 session ledger。
- [ ] 2.6（coordinator）實作冷啟動 202 + statusUrl 輪詢端點；`web-viewer-sample` UI 顯示啟動進度、輪詢至 ready 才進 viewer。
- [ ] 2.7（coordinator）實作環境指紋啟動比對：載入基準 SLO 時讀當前指紋比對，不符 fail-loud（拒起排程或顯著告警），不靜默沿用舊門檻。
- [ ] 2.8（coordinator）確認 WebRTC 分配 endpoint 維持 RFC 8825/8826/8827 DTLS-SRTP，無未加密路徑。
- [ ] 2.9 在 `tests/contracts/` 寫 SessionBroker `InMemoryFakeDriver` contract test，證明換 driver 不改 caller、`create`/`join` 兩動詞語意覆蓋；YAGNI gate：若無法證明則移除抽象退回直呼並記錄。
- [ ] 2.10 跑 coordinator/streaming affected 測試（各留服務目錄）：admission fail-closed、佇列 requester-TTL/認領視窗、idle 綁 peer 存在性、`-ResetUser` 復原、冷啟動 202、指紋 fail-loud 各有自動化測試。

## 3. Phase 2a — ai-review-draft-pipeline（`bim-streaming-server` 審查執行 + `governance-service` draft store）

- [ ] 3.1（streaming）建立 Finding SPI（SEAM-2）並落地唯一 IfcClash checker；凍結「LLM 層可整層關閉不中斷審查」降級接縫但不實作 LLM 層。
- [ ] 3.2（streaming）IfcClash clash set 執行：`has_occ=False` 缺 OpenCASCADE hard guard fail-loud（非靜默回 0）、大模型 size guard 攔截逾時。
- [ ] 3.3（streaming）離線 bounding box viewpoint 計算：以 IFC 世界座標表述相機參數；IFC→USD 座標變換（含 georeference offset）記入 ConversionLedger 保留變換鏈。
- [ ] 3.4（governance-service）finding ingest fail-closed 驗證：強制 GUID + 規則引用 + viewpoint + 信心值 + abstain 標記，缺任一進 abstain 桶不進佇列。
- [ ] 3.5（governance-service）issues store 疊加 `source_type=ai_review` 與 draft 狀態（不改既有狀態機語意）；draft 不入正式 issue 清單、不觸發派發。
- [ ] 3.6 跑 streaming pytest（服務目錄）+ governance 測試：缺 OCC fail-loud、size guard、ingest 缺欄位拒收、120 筆審查後正式 issues 淨增 0；語意測試：抽樣 viewpoint 視錐在 IFC 座標系包含目標 GUID bbox。

## 4. Phase 2b — issue-idempotency（`governance-service` + 校準腳本）

- [ ] 4.1（校準腳本）對同模型 re-export 版本對執行容差校準，產 GUID 存活率與幾何容差曲線報告；無報告則第二層 bucket 不上線（硬 gate）。
- [ ] 4.2（governance-service）兩層 fingerprint：第一層 GUID+規則精確匹配（沿用 `mw_` hash 鍵 + atomic swap）；第一層 miss → 第二層規則 id + 幾何 bucket（大小引用 4.1 報告），命中標 `guid_churn_suspected` 強制人審、禁自動 dedup/suppress。
- [ ] 4.3（governance-service）parent/child 收斂：分群鍵寫死 `(rule_id, sorted GUID 集合)`（fallback 模式改幾何 bucket 集合），同鍵收斂 1 parent + children，人審對 parent 一鍵處置。
- [ ] 4.4（governance-service）resolved 延續/reopen-candidate：幾何已消解不重生 draft；幾何仍衝突產 reopen-candidate（鏈結原 issue + 歷史鏈）；resolved→reopened 僅人審 accept 觸發，reject 維持 resolved 入 ledger，AI 無直接 reopen 路徑。
- [ ] 4.5（governance-service）版本回跑產機器可讀 resolved-candidate 差異報告（新增/持續/已消解/reopen 四類 JSON）。
- [ ] 4.6 跑 governance 測試：同模型重跑第二次 0 新 draft、群組收斂筆數 << 原始命中、GUID churn 版本對第二層命中標記+路由人審不靜默 dedup、reopen 流三態（產 candidate/僅 accept 轉 reopened/reject 維持 resolved）、差異報告四類斷言。

## 5. Phase 3a — human-triage-queue（`bim-review-coordinator` + `web-viewer-sample`）

- [ ] 5.1（web-viewer-sample）console 疊加 triage 頁（dist-ui 體系，build:ui 交付）：單筆/批量 accept・reject・edit；accept 經既有 issues store 寫入正式 issue；建立/關閉/指派只能人在此觸發。
- [ ] 5.2（coordinator）併發一致性：draft store 所有變更經 coordinator store service in-process 序列化（atomic swap 僅持久化）；per-draft 版本號存檔內、比對不符回 409 重讀；欄位所有權（AI 僅寫 evidence/last_seen/occurrence，觸碰人審欄位 fail-loud）。
- [ ] 5.3（coordinator）稽核 ledger：每筆 accept/reject/edit 記操作者/時間/AI 版本標記/原始證據包；持久化落點依 0.2/OQ-6 裁決落在 rebuild/`git clean -fdx` 洗除範圍外（掛載卷或 MinIO），重啟後權威明確。
- [ ] 5.4 跑 coordinator 測試（服務目錄）+ 前端 triage 頁測試：批量 accept 3 parent → 正式 issues +3、版本號 409、AI 觸碰人審欄位 fail-loud、AI 重跑與人審並行零遺失；前端有操作 route + 可見成功/失敗狀態 + E2E 截圖/trace。

## 6. Phase 3b — bcf-contract-export（`governance-service`）

- [ ] 6.1（governance-service）BCF-API 3.0 topic/comment/viewpoint JSON 匯出端點（疊加於既有 BCF-IDS 匯出旁），含 guid/viewpoint 相機/GUID 綁定；不做完整 OpenCDE server。
- [ ] 6.2（governance-service）匯出物以 BCF-API 3.0 官方 JSON schema 驗證；驗證層 pin IFC 4.3、幾何走 adapter 不硬編 entity。
- [ ] 6.3 跑 governance 測試：匯出 3 筆 accepted issues → 官方 schema 驗證 0 error；IFC 4.3 pin 與 adapter 解耦有測試。

## 7. 橫切治理 gate G1–G6 與零破壞回歸

- [ ] 7.1 G1/G2：Phase 0 報告存在且含 GPU 盤點/VRAM/TTFF/成功率/soak 斜率/環境指紋；CAP-1 設定檔可追溯引用；admission SLO 數值化無模糊詞且綁定指紋——checklist 勾稽。
- [ ] 7.2 G3：宣稱 production-ready 前 checklist 有「Omniverse EULA/pricing 逐字確認完成，附官方文件連結與日期」一項。
- [ ] 7.3 G4：硬體/driver/Kit/fixture 任一變動之擴充或續用附重跑容量基準報告（含新指紋），否則不核定。
- [ ] 7.4 G5：BCF/IDS/DCGM/IfcClash 標準件不於範圍外重造——review checklist 檢核。
- [ ] 7.5 G6：`:8004` proxy byte-identical 回歸通過、凍結三檔（`app.py`/`conversion_authority.py`/`governanceProxy.ts`）git diff 為空、既有 A1–A4/轉檔閉環測試全綠。

## 8. Vertical slice E2E（真實 IFC fixture，host-native Kit + RTX）

- [ ] 8.1 單一 vertical slice 一次跑通：轉檔 → AI 草稿（含 GUID/viewpoint/引用/信心值）→ 人審 accept 轉正式 issue → BCF 3.0 匯出 0 error → 6 人 WebRTC 會議看模型討論該 issue ≥30 分鐘不斷流 → 版本回跑產差異報告；收 E2E evidence（錄影/trace 落 `artifacts/e2e/`，PNG 需 `git add -f`）。
- [ ] 8.2 不斷流驗證：primary 佔用下第二 primary 請求 100% 進佇列（0 次擊落）、spectator 滿員 fail-closed、6 人 ≥30 分鐘 readyState=4 trace。
- [ ] 8.3 stop-and-ask：GIVEN Phase 0 實測 6 人 fixture 安全上限 < 6，呈使用者裁決（降人數/換 fixture/調品質/接受風險），裁決與依據入可稽核文件，禁靜默下修或硬湊 6 人。
- [ ] 8.4 更新文件：session 生命週期 REST、Phase 0 報告 schema、draft/fingerprint 資料模型、BCF 匯出端點與 IFC→USD 變換鏈記錄，於相關 `docs/` 與服務 README 補充。
