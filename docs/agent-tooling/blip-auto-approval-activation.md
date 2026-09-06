# Blip protected broker source handoff

> 文件性質：agent-tooling source/development handoff。本文記錄 2026-08-17
> `codex/blip-auto-approval` 的 repo machine truth；它不是 runtime activation、
> GitHub review、branch protection、credential 或 ProgramData 安裝證據。

## Status

- Branch：`codex/blip-auto-approval`
- Worktree：`C:\Repos\active\iot\AI-BIM-governance-blip-auto-approval`
- Rebaseline authority：2026-08-17 freshly fetched `origin/main`
  `67f82d23127070858f05d72cbbc2a9b74849638c`（含已 merge 的 #549）。本 change-set 已在
  隔離 worktree 整合該基線；`docs/agents/github-workflow.md` 與
  `.claude/workflows/ship-item.md` 的衝突已保留 main 的 trusted-host elevated authorization
  契約及本 PR 的 source-only broker 邊界。
- Source package：implemented；stage／commit／PR 狀態以 Git machine truth 為準
- Activation：**HELD**

本切片只建立 repo-owned source、離線測試與 activation authority 文件。Git branch／PR
publication 可透過既有 `git`／`gh` credential store 完成，但不讀取或輸出 token 值；沒有執行
broker live GitHub mutation、ProgramData 讀寫／安裝、token health、broker credential 存取或
owner-context activation。

## Implemented source boundary

Canonical package：`scripts/agent-tooling/blip-approve/`

- GitHub App producer 支援 `COMMENT`／`REQUEST_CHANGES`，不得送出 `APPROVE`。
- 固定 GitHub User broker 支援 counted `APPROVE`，流程 deterministic、model-free，
  且與 App／Codex process 分離。
- App producer 分成 token-bearing collector、token-free model gate、token-bearing
  final binder 及 poster。Final binder 在任何 review event 前重新綁定 exact
  base/head/files/full-patch tuple；collector 與 User broker 皆使用 immutable compare
  並以 metadata 前後雙讀拒絕 mixed snapshot；`.gitmodules` 在 tree/blob/model/identity/policy
  前 deterministic fail closed，不依賴 REST patch mode 或模型判斷。
- Finder 或 aggregate finding 容量飽和時直接 HELD，不得截斷後 SHIP；PR title、author、
  refs、paths 與 diff 全部 JSON encode 並置於同一 untrusted prompt envelope。
- Model gate 要求 reviewed `codex-cli 0.147.0`，並對每次 `codex exec` 明確停用所有列舉的
  shell／unified exec／Apps／plugins／browser／computer／image／skill／memory／workspace／
  child-agent tool features 與 web search；read-only sandbox 僅作 defense in depth。模型輸出
  若命中 private-key/token/JWT/credential-assignment 或 sentinel DLP 規則，輸出檔立即移除並
  HELD；poster 在取得 token 或 HTTP 前重複同一 fail-closed outbound DLP 檢查。另以真實 pinned
  CLI、相同 production argv 與 loopback fake provider 驗證 strict config parser 能抵達 request
  boundary；測試不使用 credential 或外部網路。
- 所有模型／PR-controlled 顯示文字先以 ASCII-escaped JSON 寫入 canonical inert Markdown
  code block；binder 與 poster 拒絕 active mention/link/image/HTML/command/task-list、CRLF／Unicode
  方向控制字元、多重或非 terminal verdict，並要求 SHIP footer 完整符合 exact PR/head grammar。
- App wrapper 以 protected per-PR exclusive lock 序列化本機 review pipeline；gate child
  timeout 依 `AgentTimeoutSec`／`Jobs` 的最壞 phase wave 動態計算。
- User approval body byte-exact 使用 distinct `ai-bim-automated-approve-only` schema，明示
  `automated=true` 與 `action=approve-only`；trusted-host merge consumer 明確拒絕把它當成
  `merge`／`merge-elevated` authority。branch protection 必須精確要求一個 approval；
  App attestation 僅接受單一 `COMMENTED` footer，且同時綁定
  changed-files 與 full-patch digest。
- Runtime manifest／completion marker 使用 duplicate-aware exact schema reader；User broker
  將新引入的 immutable packet helper納入 ACL、manifest hash、open-stream pin 與 child
  bootstrap。
- User broker 僅從固定 `C:\Users\IOT\.grok\github-bot\.env.blip` 取得
  `BLIP_GITHUB_TOKEN`；先要求 immutable owner SID、protected ACL、explicit sandbox deny、
  regular non-reparse path 與 exclusive handle，再以 bounded strict UTF-8 parser 要求恰一筆
  assignment。Agent、command line、stdin、clipboard 與一般 ambient env 都不承載 token。
- Protected Python auth／poster source 不含 PEM、JWT、dotenv、token-printing、generic
  installation-token 或 App `APPROVE` 路徑，只接受固定 Codex identity 與
  `COMMENT`／`REQUEST_CHANGES`。
- `-TokenHealth` 是獨立 parameter set，與 PR／live 參數互斥，不要求或檢查 Codex
  `auth.json`；取得並驗證 App token 後立即離開，不啟動 collector、model、binder 或
  poster。
- GitHub installation-token response 以實際 stream bytes 限制 65,536 bytes；
  第 65,537 byte fail closed，不依賴 `Content-Length` header。
- Production candidate 只能由 separately reviewed protected launcher，以 fixed PowerShell
  `-NoProfile -NonInteractive` 與 minimal environment 啟動。外部核准的
  `blip-auto-approval-reviewed-build/v2` manifest 精確綁定 clean source commit、
  distinct builder-launcher／builder／installer-launcher／verifier、所有 source/runtime hash
  及所有「已簽章」runtime executable/DLL 的 Authenticode signer（共 9 個；上游 ripgrep
  `runtime/codex-path/rg.exe` 從不簽章，僅以 runtime_source hash pin 綁定完整性）。
- Candidate builder 產生 deterministic v3 freeze；production freeze 綁定 reviewed manifest
  hash 與 source commit。Candidate 是 inert data，排除 builder、launcher、tests 與
  external verifier；TEST_ONLY freeze 使用全零 provenance sentinel，無法安裝。
- Public installer launcher 與 internal verifier 必須從 candidate 外、separately
  protected／base-pinned 的來源執行，並由 operator 另行提供 reviewed-manifest、launcher 與
  verifier hash。Public launcher 只接受 fixed PowerShell 的 exact
  `-NoProfile -NonInteractive -File` command line，pin 自身與 verifier bytes，清理 process
  environment，然後在同一 clean process 以 fresh reference-equal capability 與 exact
  launcher context 執行已驗證的 strict-UTF-8 verifier bytes。Internal verifier 拒絕 file-based
  execution，並再次綁定 launcher OS argv、PID、host、paths、hashes 與 retained streams；直接以
  canonical verifier argv 啟動會在任何 candidate／owner／ProgramData 檢查前拒絕。
  Root-loader v4、bootstrap-context v3 與 installer 持續保留 launcher／verifier／manifest
  provenance stream；inner bootstrap 要求 freeze 的所有 source/runtime hash 與 manifest
  完全一致，並以完整 installer command AST contract 拒絕未知或 shadowed cmdlet/function。
  整條鏈要求 production v3 freeze、strict JSON schema、exact file/hash inventory 與
  launcher／verifier／manifest provenance。
- Installer 只允許 initial version publish，不原地覆寫既有 runtime；completion marker
  僅在 publish 後驗證成功時建立。

Package trust model、能力表與 activation gate 見
`scripts/agent-tooling/blip-approve/README.md`。

## Offline verification evidence

所有下列檢查皆在本 worktree 執行，使用 synthetic fixtures／mocked transport；沒有
連線 GitHub 或讀取 credential。

### Python tests

以固定 Python 3.12、`-I -S -B` 執行 package 內全部 `test_*.py`：

- `test_app_auth.py`：7 passed
- `test_bind_ship_attestation.py`：10 passed
- `test_blip_review.py`：38 passed
- `test_codex_ship_gate.py`：15 passed（含 real CLI／loopback provider parser contract）
- `test_collect_ship_gate_packet.py`：2 passed
- `test_post_review.py`：6 passed
- `test_ship_gate_packet.py`：7 passed
- Total：85 passed

### PowerShell safe-only tests

- User approval wrapper：exact runtime metadata schema 與
  `broker-safe-tests-ok` passed
- App producer wrapper：exact runtime metadata schema、per-PR lock、dynamic timeout budget、
  bounded response、token isolation、parameter-set 與 token-failure-before-child regressions
  passed
- Candidate builder：兩次 TEST_ONLY v3 build byte-identical；exact source/runtime hash inventory、
  inert candidate、兩個 protected launcher contracts、reviewed manifest v2 exact-schema／tamper
  matrix passed
- Installer：production v3 exact freeze schema、reviewed-manifest hash/stream chain、自綁 bootstrap、
  pinned source、runtime ACL contract passed；owner ACL mutation test skipped
- Frozen bootstrap：v3 safe-schema／manifest forwarding、bootstrap authority、完整 source tuple
  tamper、canonical fresh-process direct-verifier refusal、process-local launcher proof／schema、
  builder-verifier-bootstrap-fixture exact inventory、完整 command-AST／cmdlet shadow regressions
  與 immutable owner-SID denial passed；owner binding matrix skipped

### Static checks

- PowerShell AST parse：13 files passed
- Python compile：14 files passed
- Secret literal signatures：0 matches（只輸出計數）
- Trailing whitespace：0 lines
- `git diff --check`：passed
- 本機 `codex-cli 0.147.0` 的 `debug prompt-input` 接受完整 tool-free denylist 與 config keys；
  未呼叫模型、未讀 credential、未發 API request

## Skipped gates and uncertainty

- Owner-context ACL／full installer integration：未執行。本 session 未授權安裝、
  credential 存取、ProgramData 寫入或 live mutation；即使未來逐項明確授權，這個未
  merge 的 source change 尚未具備獨立保護的 reviewed manifest、
  launcher／verifier publication 與 owner-context candidate；sandbox-safe suite 只證明
  source contract 與拒絕路徑。
- Production candidate freeze、external verifier publication、ProgramData installation：
  未執行。
- App token-only health、producer dry-run、App COMMENT／REQUEST_CHANGES、User counted
  APPROVE 與 GitHub readback：未執行。
- 真實 App installation permissions、fixed User permission、branch protection 與
  credential ACL：未驗證。

以上缺口都使 activation 保持 HELD；source-only 測試通過不得寫成 operational ready。

## Activation gates

本 session 未授權安裝、credential 存取、ProgramData 寫入或任何 live mutation；未來每個
named operation／PR 都必須逐次取得明確授權，且 activation 維持 HELD。即使取得授權，仍須
先讓每一項 prerequisite 都通過 exact tuple 驗證，才可依序處理：

1. exact diff security acceptance、tracked clean source review，並由獨立 reviewer 產生／保存
   reviewed build manifest 與 SHA-256；任何 Codex 版本或 tool feature inventory 變更都必須
   重新審查 tool-free denylist 與 outbound DLP；
2. protected builder launcher／installer launcher／internal verifier publication，以及
   owner-context production v3 freeze（不得把 builder stdout 當成核准 authority）；
3. ProgramData initial install及 owner ACL／completion-marker驗證；
4. owner-provided App／Codex／reviewer credential setup；
5. token-only health與 mutation-free producer dry-run；
6. 指名 PR 的 App COMMENT／REQUEST_CHANGES canary；
7. 另行指名並授權的 User counted APPROVE canary與 GitHub readback。

任一步 tuple、identity、hash、schema、ACL 或 policy drift 都必須 fail closed。不得直接
修補 installed bytes，也不得把 prior credential/runtime 敘述當成這個 source package
的 activation 證據。
