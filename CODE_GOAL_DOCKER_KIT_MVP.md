/goal

你正在 `AI-BIM-governance` repo root。請自動執行直到完成第一版 Docker-first AI-BIM Runtime Manager MVP。

硬性要求：
1. MVP 只能以 Docker Compose 運行；host-local 啟動方式全部降級成 legacy/debug，不作為驗收路徑。
2. Kit 以 GPU container 運行；不能用 host Kit 假裝通過。
3. 最終要看到 Kit 管理前端頁面：`http://127.0.0.1:5174`。
4. Kit 管理前端可列出 `.usdc` 檔案，選擇 k 個檔案，對一個 Kit instance 執行 open / close。
5. 完成 OpenSpec change：`introduce-ai-bim-runtime-manager-docker-kit-mvp`。
6. 程式結構分明，每個檔案不可超過 500 行。
7. 物件導向優先：API service、repository、gateway、session manager 必須用 class 封裝。
8. Fast MVP：先完成 Docker-first 管理面與 contract；真實 Kit control endpoint 未準備時，狀態標 `blocked` 或 `recorded_only`，不得宣稱 GPU/viewport pass。

請依序執行：
1. 檢查 repo clean。
2. 建立 branch：`codex/openspec/introduce-ai-bim-runtime-manager-docker-kit-mvp`。
3. 套用本 package 所有檔案。
4. 執行：
   - `npx openspec validate introduce-ai-bim-runtime-manager-docker-kit-mvp --strict`
   - `docker compose -f compose.runtime-manager.yml --env-file .env.runtime-manager.docker config`
   - `.\scripts\start-runtime-manager-docker.ps1 -Build`
   - `.\scripts\check-runtime-manager-docker.ps1`
5. 若本機已具備 NVIDIA Container Toolkit 與 Linux Kit launcher，再跑：
   - `.\scripts\start-runtime-manager-docker.ps1 -Build -WithGpu`
   - `.\scripts\check-runtime-manager-docker.ps1 -WithGpu`
6. 打開 `http://127.0.0.1:5174`，確認 Kit Manager UI。
7. 在 `storage/` 放至少一個 `.usdc`，於 UI 選擇 k 個，按 `Open selected in Kit`，再按 `Close instance`。
8. 更新 `docs/verification/YYYY-MM-DD-docker-kit-manager-mvp.md`，記錄 pass / blocked / failed。
9. 確認每個新增或修改檔案 < 500 行。
10. 建立 PR，標題：
   `feat(runtime): Docker-first Kit Manager MVP`

不要：
- 不要直接在 main 寫 code。
- 不要提交 `.ifc`、`.rvt`、`.usd`、`.usdc` 大檔。
- 不要用 host-local Kit 取代 GPU container。
- 不要把 Docker blocked 說成 passed。
