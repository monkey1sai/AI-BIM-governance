# Local Verification

選擇與 changed paths 直接相關的 checks；沒有執行的項目必須明列，不能用遠端 CI、歷史 evidence 或其他 service 的 pass 代替。

| Scope | Commands |
|---|---|
| Root contracts/fakes | `.venv\Scripts\python.exe -m pytest tests -p no:cacheprovider` |
| `bim-review-coordinator` | `npm test`、`npm run build` |
| `bim-streaming-server` | `.venv\Scripts\python.exe -m pytest tests/test_conversion_authority_api.py -q` |
| `governance-service` | `C:\Program Files\Python312\python.exe -m pytest tests -v` |
| `web-viewer-sample` | `npm run test:session-first`、`npm run build` |
| `services/kit-manager-api` | `..\..\.venv\Scripts\python.exe -m pytest tests -q` |
| `apps/kit-manager-web` | `npm run build` |
| Runtime/deploy path | `.\scripts\deploy.ps1 -DryRun` |

## User-facing acceptance

### Structured-log evidence reports

`scripts/dev/run-structured-log-runtime-evidence.ps1` 產生及驗證的報告使用
`## Requirements and verification mapping`，引用現行 backlog、驗證入口及 log contracts。
新版驗證器不接受只有舊 `OpenSpec 10.1-10.5 mapping` 標題的報告。
歷史證據保留原檔並使用產生它的 commit 查證；新驗收須重跑產生新 attempt，
不得只改歷史 Markdown 或 hash manifest 來冒充本次驗證。
本機 renderer 回歸命令：`pwsh -NoProfile -File scripts/tests/test-run-structured-log-runtime-evidence.ps1 -Case ArtifactRenderer`。

### Browser and Kit

Browser/UI 變更需回報 route、主要操作、fixture、真 API、observed runtime ID、loading/success/failure/retry、E2E command、screenshot/trace 與 known gaps。靜態 build 或 API health 不證明 user workflow。

Kit/WebRTC 變更另需真實 first frame、正確 Stage、DataChannel 與 ACK。GPU 不可用時明確標記未驗證，不得在無 graphics channel 的容器內宣稱 runtime pass。

## PR safety

```powershell
node --test .github/scripts/pr-safety.test.mjs
node .github/scripts/pr-safety.mjs --base <40-character-base-sha> --head <40-character-head-sha>
```

此檢查只涵蓋 diff whitespace/conflict-marker、changed JSON、changed PowerShell 與新增行秘密模式；service tests 與人工審查仍由變更風險決定。
