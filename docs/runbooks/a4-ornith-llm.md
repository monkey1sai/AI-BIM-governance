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

```text
ORNITH_API_KEY=...          # 或 A4_LLM_API_KEY；只設 session / 本機 .env，不 commit
A4_LLM_BASE_URL=http://192.168.10.248:18080/v1
A4_LLM_MODEL=Ornith-1.0-35B
A4_LLM_TIMEOUT_S=120
A4_LLM_ENABLED=true         # 省略時：有 key 即 true
```

PowerShell（session only）:

```powershell
$env:ORNITH_API_KEY = "<paste-from-private-channel>"
# then restart governance-service so it picks env
```

## interpret_mode

| Mode | Behavior |
|---|---|
| `deterministic` | 僅文法（離線可測） |
| `semantic` | 強制 Ornith → JSON filters；失敗回 `uninterpreted`＋next_step |
| `auto` | 文法可解則直接用；否則再呼叫 LLM |

## 安全

- Key **禁止**寫入 script、HTML 範例外的 tracked 檔、PR body、log 回覆。
- `/api/search/llm-status` 只回 enabled/configured/model/base_url，**永不回 key**。
