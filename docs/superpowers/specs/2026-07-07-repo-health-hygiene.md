# Spec: repo-health 衛生修復（2026-07-07 健檢）

## 背景

2026-07-07 以 `repo-health` 技能跑五面向健檢（workflow `repo-health-scan`，5 個唯讀 Explore agent），發現 21 項。使用者確認全部 14 個可修項執行。本 spec 涵蓋其中需要動 tracked files 的部分；純本地清理（分支、worktree、pytest 暫存）不在版控範圍，已於健檢報告記錄。

## 範圍（本 PR 動的檔案）

### 1. 版本漂移對齊（目標版本一律取 repo 內既有最高版本，不引入外來新版本）

| 檔案 | 變更 |
|---|---|
| `governance-service/requirements.txt` | `fastapi>=0.110`→`==0.115.6`；`uvicorn>=0.29`→`uvicorn[standard]==0.45.0`；`pydantic>=2.0`→`==2.10.4`（floor 範圍收斂為精確 pin，消除跨機器解析差異） |
| `bim-streaming-server/requirements.txt` | `fastapi==0.111.0`→`==0.115.6`；`starlette==0.37.2`→與 fastapi 0.115.6 相容版本 |
| `services/kit-manager-api/requirements.txt` | `uvicorn[standard]==0.34.0`→`==0.45.0` |
| `web-viewer-sample/package.json` | vitest `^1.6.0`→`^2.1.8`（主版本升級）；typescript `^5.2.2`→`^5.7.2`；`@types/react*` 對齊 kit-manager-web；socket.io-client `^4.8.1`→`^4.8.3` |
| `apps/kit-manager-web/package.json` | typescript `^5.2.2`→`^5.7.2` |

### 2. .claude 資產治理

- `saas-blueprint-tournament.js` 入庫（原「命中 .gitignore 白名單卻未 add」的孤兒；曾產出 docs/plans saas-* 語料（PR #301），保留 provenance）。
- 新增 `.claude/workflows/README.md` 與 `.claude/skills/README.md` 索引（登錄 3 個「僅靠 harness 自動發現」的獨立 workflow；標註技能來源）。
- gitnexus 家族巢狀 vs `gitnexus-blast-radius` 頂層並存：**裁決為刻意現狀**（產生器輸出 vs 本地自撰＋鏡像＋archive 引用），文件化於 skills README，不搬移。
- `fu-` 前綴：名稱被 SKILL.md 與兩個 pytest 硬編，不改名，於 workflows README 登錄定義。

### 3. 文件/設定同步

- `scripts/script-registry.json` 補登 `scripts/gen_routing.py`（role=agent-tooling），使 SCRIPT_CONTRACT「root-level script 須登記」的語言中性條文與實作一致。

## 不做（non-goals）

- 進度差異面向的計畫文件更新（§2.99 舊表、provenance.json 敘述）——唯讀評估結果，另案處理。
- `.env` vs `.env.example` key 比對——檔案在 agent deny 清單，交由使用者以 key-only 指令在本機執行。
- `bim-review-coordinator` 依賴——已是目標版本。

## 驗證

- Python：各服務 pytest baseline vs after 同尺比對（走各自 venv python，不用裸 python）。
- JS/TS：`npx tsc --noEmit` ＋ vitest suite baseline vs after；vite build 不跑 tsc 故 tsc 必須另跑。
- root contracts：`.venv\Scripts\python.exe -m pytest tests -p no:cacheprovider`。
- registry：JSON 解析 ＋ 既有 registry 相關 pytest。

## 風險

- vitest 1→2 為主版本升級，config/pool 行為可能變；以既有測試套件全綠為閘門，收斂不了即 revert 該項。
- fastapi 0.111→0.115 帶 starlette 升級，streaming server 的 TestClient 行為可能受影響；同上以測試為閘門。
- **host-native governance runtime 未同步升級**：`C:\Program Files\Python312` 需管理員權限，pip 安裝被拒且已完整回滾（host 實際仍為 fastapi 0.111.0 / pydantic 2.13.3，107 tests 綠）。requirements pin 與 host runtime 的收斂需另以管理員執行 `python -m pip install --no-user fastapi==0.115.6 pydantic==2.10.4` 並重驗；注意 pydantic 對 host 是 2.13.3→2.10.4 降級，先確認 ifctester/bcf-client 相容，或改走「全 repo 目標升 2.13.3」的後續決策。
