# A4 Ornith vLLM 語意解譯

## Endpoint

| Item | Value |
|---|---|
| Base URL | `<operator-provided verified URL>`（只允許 verified HTTPS、exact loopback tunnel，或明確 allowlist 的 RFC1918 lab 位址） |
| Chat | `POST {base}/chat/completions` |
| Model | `Ornith-1.0-35B` |
| Auth | `Authorization: Bearer <key>` |

## Env（governance-service process）

**Tracked sample（只可放 placeholder）：** 根目錄 `env.sample` 與 `.env.example` 不得作為 live endpoint 或 credential 的 authority。任何 operator-owned value 必須經 out-of-repo deployment injection 提供；不得從 tracked sample 複製、回顯或提交實值。

```text
# operator-owned deployment inputs; values intentionally omitted
A4_LLM_BASE_URL=<operator-provided HTTPS-or-allowed-loopback URL>
A4_LLM_MODEL=<operator-provided model identifier>
A4_LLM_TIMEOUT_S=<bounded timeout seconds>
A4_LLM_ENABLED=<true|false>
A4_LLM_PROFILE=<production|local-dev|trusted_lab_http>
A4_LLM_TRANSPORT_MODE=<verified_https|loopback_tunnel|trusted_lab_http>
ORNITH_API_KEY=<operator-provided secret>
```

```powershell
if (Test-Path -LiteralPath '.env') { throw '.env already exists; refusing to overwrite operator-owned values' }
Copy-Item -LiteralPath '.env.example' -Destination '.env'
# restart governance-service / deploy 使 process 繼承；既有 .env 的實值不可由 agent 修改
```

### A4 proof signing（governance-service only）

完整、已驗證的 session table result 才可能帶短效 row proof。proof keyring 只可由
governance-service 的 operator-owned deployment input 注入：

```text
A4_PROOF_ACTIVE_KID=<opaque key identifier>
A4_PROOF_ACTIVE_KEY=<at least 32-byte operator-managed secret>
# Optional verify-only overlap for one rotation window:
A4_PROOF_PREVIOUS_KID=<previous key identifier>
A4_PROOF_PREVIOUS_KEY=<previous at-least-32-byte secret>
```

- active pair 必填；previous 兩個欄位必須同時存在，且不能與 active `kid` 相同。
- 僅保留一個 previous verify key；owner 的 rotation cadence 必須至少覆蓋短效 proof TTL。
- 缺失、衝突、過短或無效設定時，搜尋仍可回 table-only 結果，但不發 proof、不啟用 A4 Issue。
- proof 使用簽章 embedded claims；registry miss 時可由 governance-service 以 submitted canonical snapshot 與 active/previous verify key 驗證，不要求 sticky/shared process state。key 缺失或已退役、snapshot/binding 不符、proof 過期時才 fail closed 並要求重新查詢。

> 出 lab／對外分享前請輪替 key；prod 勿沿用 sample。

## interpret_mode

| Mode | Behavior |
|---|---|
| `deterministic` | 僅文法（離線可測） |
| `semantic` | 強制 Ornith → JSON filters；模型／transport／schema 失敗回 `semantic_error`＋structured error code，無法由任何解譯器形成 usable candidate 才回 `uninterpreted` |
| `auto` | 文法可解則直接用；否則再呼叫 LLM |

## Deploy 注意（host-native governance）

- `governance-service` 在 Mode C 是 **host-native**（`compose.host-kit.yml` 註解），**不在 Docker compose 內**。
- `deploy.ps1` Phase 4a 啟動 governance 時，須讓該 process **繼承** operator-provisioned LLM credentials（本機 `.env` 不會自動被 Python 讀入，除非 start wrapper 有 dotenv）。
- 由 credential owner 使用既有的 out-of-repo secret injection 完成 provisioning 後再執行 `deploy.ps1 -Build` / 重啟 governance；agent 不得讀取、列印或手動匯入 credential value。
- 後續可選強化：deploy Phase 4a 明確從 root `.env` 透傳 `ORNITH_*` / `A4_LLM_*`（不 log 值）。

## A4 trusted context transport

- A4 browser request only carries bounded query controls.  The coordinator must
  resolve authorization and the server-side IFC path, then call the separate
  governance internal endpoint with `A4_INTERNAL_CONTEXT_TOKEN`.
- Before enabling that path, inject the **same opaque value** into the
  coordinator process and the host-native governance process through the
  deployment secret mechanism.  Missing or mismatched values intentionally
  return a safe 503/401; they must not be worked around with a browser token.
- The token-bearing hop is restricted to a verified internal origin and rejects
  redirects.  Do not add this key to `VITE_*`, URL/hash/query parameters,
  browser storage, screenshots, logs, or PR bodies.
- The current host-kit `host.docker.internal` bridge is not accepted as a
  token-bearing A4 origin without a separately verified internal-network
  contract.  Keep A4 fail-closed in that topology until such a contract and
  integration evidence exist.

## 安全

- Key **禁止**寫入 script、HTML 範例外的 tracked 檔、PR body、log 回覆。
- 若 tracked sample 曾含 active value，credential owner 必須在 out-of-repo 完成 revoke/rotate，並以 placeholder 取代；在此之前不得把 semantic transport 視為已完成。
- `/api/search/llm-status` 只回安全狀態欄位（例如 enabled/configured/model/transport class），**永不在 API 回傳 endpoint 或 key**。
- Agent 回覆 / PR body **仍勿 echo** 完整 key。
