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

**Tracked sample（預設 LAN 位址／model，key 空白）：** 根目錄 `env.sample`  
（並已同步 key 名到 `.env.example`，若本機有該檔）。

```text
# from env.sample — safe defaults for this lab
A4_LLM_BASE_URL=http://192.168.10.248:18080/v1
A4_LLM_MODEL=Ornith-1.0-35B
A4_LLM_TIMEOUT_S=120
A4_LLM_ENABLED=true
ORNITH_API_KEY=             # 只寫進 untracked .env
```

```powershell
Copy-Item env.sample .env   # if you do not already have .env
# edit .env → set ORNITH_API_KEY (from private channel / ornith HTML; do not commit)
# restart governance-service so it inherits env
```

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
- Tracked `env.sample` / `.env.example` 只放 **空白 key** + 預設 base/model。
- `/api/search/llm-status` 只回 enabled/configured/model/base_url，**永不回 key**。
