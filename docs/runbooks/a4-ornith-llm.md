# A4 Ornith vLLM 語意解譯

Reference UI 範例：`ornith-vllm-api-examples.html`（主工作區；**勿把 key 寫進 repo**）。

## Endpoint

| Item | Value |
|---|---|
| Base URL | `http://192.168.10.248:18080/v1`（可用 env 覆寫） |
| Chat | `POST {base}/chat/completions` |
| Model | `Ornith-1.0-35B` |
| Auth | `Authorization: Bearer <key>` |

## Env（governance-service process）

**Tracked sample（lab 一鍵預設）：** 根目錄 `env.sample`（與 `.env.example` 同步）  
含 LAN base/model **與 lab API key**（同源 `ornith-vllm-api-examples.html`），減少本機部署步驟。

```text
# from env.sample — lab defaults
A4_LLM_BASE_URL=http://192.168.10.248:18080/v1
A4_LLM_MODEL=Ornith-1.0-35B
A4_LLM_TIMEOUT_S=120
A4_LLM_ENABLED=true
ORNITH_API_KEY=<lab key in env.sample>
```

```powershell
Copy-Item env.sample .env -Force   # 若尚無 .env；已有 .env 則只合併缺鍵
# restart governance-service / deploy 使 process 繼承
```

> 出 lab／對外分享前請輪替 key；prod 勿沿用 sample。

## interpret_mode

| Mode | Behavior |
|---|---|
| `deterministic` | 僅文法（離線可測） |
| `semantic` | 強制 Ornith → JSON filters；失敗回 `uninterpreted`＋next_step |
| `auto` | 文法可解則直接用；否則再呼叫 LLM |

## Deploy 注意（host-native governance）

- `governance-service` 在 Mode C 是 **host-native**（`compose.host-kit.yml` 註解），**不在 Docker compose 內**。
- `deploy.ps1` Phase 4a 啟動 governance 時，須讓該 process **繼承** 已含 `ORNITH_API_KEY` 的環境（本機 `.env` 不會自動被 Python 讀入，除非 start wrapper 有 dotenv）。
- 建議：開 shell → `Get-Content .env | …` 或手動 `$env:ORNITH_API_KEY=…` → 再 `deploy.ps1 -Build` / 重啟 governance。
- 後續可選強化：deploy Phase 4a 明確從 root `.env` 透傳 `ORNITH_*` / `A4_LLM_*`（不 log 值）。

## 安全

- Key **禁止**寫入 script、HTML 範例外的 tracked 檔、PR body、log 回覆。
- Tracked `env.sample` / `.env.example` 含 **lab key**（使用者授權減少部署步驟；同源 HTML 範例）。
- `/api/search/llm-status` 只回 enabled/configured/model/base_url，**永不在 API 回傳 key**。
- Agent 回覆 / PR body **仍勿 echo** 完整 key。
