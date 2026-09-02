> **Priority: P0 — 目前最高優先治理項目。** 本清單是後續實作順序；本 proposal 階段僅勾選契約／schema／測試等 bootstrap 交付項（1.x），不勾選任何 live activation task。

## 1. 契約與失敗語意

- [x] 1.1 盤點並以測試固定現有 exact-head collector、trusted-host merge、self-referential bootstrap、deployment inventory 與 terminal-state contract 的 current behavior。
- [x] 1.2 定義並驗證 immutable adjudication packet與attestation envelope，涵蓋repo／PR／base-head tuple、完整changed paths、diff／policy／manifest digests、required-check sources、conversation、issuer／key／nonce／expiry與artifact digests。
- [x] 1.3 定義並驗證closed `phase`、`terminal_class=DELIVERED|FAILED|HELD`、v1 `reason_code` transition table，以及delivery／attempt／supersedes append-only lineage與queue-lock語意。
- [x] 1.4 將 `human_critical` policy輸入遷移成 `critical_machine_adjudication`，為舊值提供明確拒絕／遷移錯誤，且不建立human-approval fallback。
- [x] 1.5 新增contract parse、unknown-field／enum、illegal transition、attempt rewrite與secret-redaction tests，證明malformed／incomplete input fail closed。
- [x] 1.6 實作closed PR classifier：`draft_report_only|ordinary|repair|reconciliation|activation_canary|activation_closure|revert|release_hotfix`；固定repair／revert failure lineage、merge ambiguity與post-active fixpoint reconciliation、activation-only closure的互斥適用範圍，證明每個exact tuple恰屬一類且沒有human fallback。
- [x] 1.7 定義並驗證ready後的closed finalization contract：Draft-first、single-writer head freeze、round 1完整finding batch、至多一個batch repair head、round 2 pass-or-`HELD`，以及round 1無blocker或round 2通過時的final exact head在同一lease立即進merge sink；不得存在自動第三輪。

## 2. Exact-head evidence 與 deterministic gate

- [ ] 2.1 實作bounded server-authoritative collector，完整分頁取得PR、base/head、changed files、reviews／conversations、required checks及其App source、ruleset／protection與OpenSpec alignment。
- [ ] 2.2 實作binary、submodule、rename、large-diff與evidence-budget分類；任何未被policy完整涵蓋的surface回傳 `HELD`。
- [ ] 2.3 在model前以isolated deterministic scanner檢查raw diff，將changed paths、commands、GitNexus、security／secret scan與product／design gates寫入packet；只有byte-identical完整review surface可進L1–L3，需redaction即block。
- [ ] 2.4 新增base/head drift、缺頁、wrong App source、同名status spoof、digest mismatch、unknown path、stale evidence與redacted／partial diff不得進model的negative tests。
- [ ] 2.5 新增routine docs、mechanical code、user-facing、deploy與self-referential fixtures，證明risk classification與required gate selection deterministic且可重現。
- [ ] 2.6 實作named-PR finalization state machine與persistent round budget，讓draft observation不消耗budget，ready head的任一push使舊evidence失效，round 2需要第三個head時唯一映射 `HELD/PREMERGE_EVIDENCE_INVALID`＋namespaced failure detail。
- [ ] 2.7 新增逐finding push、第二writer mutation、base/head drift、round 2 residual blocker、stale SHIP reuse、incomplete pagination與passing head未立即merge的negative／race tests。
- [x] 2.8 定義closed CI／review finding disposition contract：`ACCEPTED`、`FIX_REQUIRED`、`FALSE_POSITIVE`、`DEFERRED`、`ESCALATE`（舊值 `FIX`／`REJECT`／`ACCEPT_RISK`／`DEFER` 正規化），綁定severity、verification、scope、risk class、exact-head evidence、fix evidence（repair head／regression／independent re-review）、follow-up Issue與thread resolution；confirmed in-scope P0／P1／P2／BLOCKER／CRITICAL／HIGH只能 `FIX_REQUIRED` 或 `ESCALATE`，high-risk class只能 `ESCALATE` 或有反證的 `FALSE_POSITIVE`。
- [x] 2.9 新增executable tests證明Resolve代表disposition完成而非一律fix，並拒絕unverified finding、blocking accept／defer、自述fixed而無fix evidence、incomplete threads、convergence前或stale-head machine success，以及非expected source最新CheckRun的舊success。
- [x] 2.10 將merge queue agent延伸為Review Disposition Agent：`manage-pr-queue.mjs dispose` 以exact-head snapshot渲染structured reply與隱藏metadata（finding_id／thread_id／head_sha／base_sha／agent_run_id／sender／webhook_event_id／disposition／evidence fingerprint），`post-review-disposition.mjs` sink以完整tuple去重、marker loop guard、mutation前後exact-head reread與bounded resolution發布；agent assertion不得滿足merge gate，並以executable tests覆蓋。
- [x] 2.11 依exact-head review findings修補finalization contract：diff bytes與changed-file surface綁定、L1／L2／L3 packet與output digest綁定、machine gate綁定expected source最新CheckRun與convergence epoch、invalid clock fail closed、`release_hotfix` 准入、FAILED／HELD後只開放bound recovery lane、authoritative dependency graph與可重算proof、subsumption verifier。

## 3. 三層交叉對抗 machine adjudication

- [ ] 3.1 實作L1 finder closed schema與non-overlapping lens routing，輸出path:line evidence、uncertainty、risk與recommendation。
- [ ] 3.2 實作L2 cross-refuter，強制使用與L1不同的受允許模型並採refute-by-default；逐條標示killed、surviving或unverified finding。
- [ ] 3.3 實作L3 apex synthesizer，使其重讀raw immutable packet與L1／L2結果，輸出唯一closed verdict與unresolved HIGH／CRITICAL blockers。
- [ ] 3.4 將model、effort、prompt boundary、routing policy digest與output schema納入exact-head evidence；任一漂移、unavailable或parse failure回傳 `HELD`。
- [ ] 3.5 建立對抗fixtures覆蓋prompt injection、共享偏誤、偽造evidence、L2未真正反駁、L3未讀raw surface及unresolved critical finding。
- [ ] 3.6 將G1–G12 rubric固化為machine-readable activation checklist；任一 `fail|uncertain` 時L3輸出 `HELD/ACTIVATION_UNATTESTED`。

## 4. External App check 與 privileged exact-head merge

- [ ] 4.1 建立non-secret external trust-root descriptor，驗收App／issuer／key用途、add-before-remove rotation、revocation、short-lived credential、artifact ACL／auth／retention、deny-by-default egress與CPU／time／memory／output quotas；不得包含private key或provisioning value。
- [ ] 4.2 實作expected GitHub App source-pinned CheckRun驗證與publisher contract，只有expected source的actual `success`可解鎖；`HELD`／incomplete／drift保持absent／pending或blocking，明確拒絕以 `neutral`／`skipped` 滿足required authority，且candidate workflow、PR comment、review event或同名status一律不得替代。
- [ ] 4.3 實作base-pinned privileged executor，使其只消費server state與authenticated immutable packet，分離check／merge／deploy brokers，並以negative test證明不checkout、import、source或執行candidate code。
- [ ] 4.4 實作single-use merge-authorization lease，綁定exact tuple、ruleset／protection epoch、check sources、conversation、policy／evidence digests、nonce與expiry；所有owner settings mutation經同一broker序列化。
- [ ] 4.5 只以GitHub Pull Request Merge REST compare-and-swap `sha=<preparedHead>`執行policy允許的merge method，禁止 `--admin`、bypass、force-push與PR-number-only merge。
- [ ] 4.6 實作post-sink bounded authoritative reread與 `HELD/MERGE_OUTCOME_UNVERIFIED` recovery，並以non-head mutation、timeout／ambiguous response／duplicate request tests證明不猜測或重複merge。
- [x] 4.7 實作closed subagent merge-plan validator，強制 `generatedBy.kind=subagent`、exact heads、dependency proof、predecessor-before-successor拓撲順序與 `SKIP_SUBSUMED` lineage；拒絕human-authored order、dependency inversion及無proof skip。
- [x] 4.8 將Finding disposition、兩輪熔斷、source-pinned gate、subagent merge plan、exact-head CAS與Linux delivery整合成版本控制Mermaid acceptance baseline，並以executable tests覆蓋FAIL-CLOSED／HELD路徑。

## 5. Single-flight delivery ledger 與 repair lineage

- [ ] 5.1 實作per-repository single-flight lock，涵蓋merge preparation到terminal delivery；concurrent ordinary PR在前一筆完成前不得進入merge sink。
- [ ] 5.2 建立append-only delivery／attempt ledger，強制 `PR head → merge commit = fetched origin/main = deployed commit`，並綁定supersedes、target／runner descriptors、commands與authenticated evidence references。
- [ ] 5.3 實作queue freeze與closed lane mapping：merge／fixpoint不可證明的 `HELD` 只開放bound reconciliation，`FAILED/MERGED_NOT_DELIVERED` 只開放bound repair／revert，其他post-merge `HELD`不開放sink；證明merge成功、ancestor包含或部分runtime evidence不會產生 `DELIVERED`。
- [ ] 5.4 只允許deterministically classified transient failure對相同commit／command做一次redeploy；其餘失敗建立綁定delivery ID的新repair／revert PR lineage。
- [ ] 5.5 新增concurrent merge、commit attribution drift、lock recovery、same-commit retry budget、repair／revert／reconciliation互斥lane與append-only history tests。

## 6. Canonical Linux rebuild 與 post-deploy verification

- [ ] 6.1 更新public target registry與resolver contract，使repo-external inventory只能唯一解析 `role=canonical_test_deploy` Linux target；credential broker只產生opaque target lease，candidate helper不得讀出、上傳或覆寫private topology。
- [ ] 6.2 更新attested `scripts\dev\rebuild-test-deploy.ps1 -Build -InventoryPath ...` transport，強制fresh fetch `+refs/heads/main:refs/remotes/origin/main`、owner-controlled checkout，且fresh／deployed commits完全等於expected merge commit。
- [ ] 6.3 將cleanup限定在已驗證ownership的deployment root，排除agent/tooling與root planning artifacts並保留required production assets；在任何recursive action前加入path／ownership negative tests。
- [ ] 6.4 在啟動 `deploy.ps1` 前實作read-only port／process preflight；blocker只記錄non-secret identity、不得stop且以 `HELD`結案，command啟動後nonzero則唯一映射 `FAILED`。
- [ ] 6.5 只在target內執行 `scripts\deploy.ps1 -Build`，禁止 `local-windows`、`-DryRun`、`-Force`、當前worktree、stale ref與替代啟動命令。
- [ ] 6.6 將runner contract拆成Linux build／health／API／integration／Kit／WebRTC／artifact readback與Windows DPR1 design／跨網段browser operability，並綁定runner、target、fixture、runtime IDs與digests。
- [ ] 6.7 實作sanitized terminal CheckRun／delivery event publisher；只有exact commit與全部required Linux／Windows gates成功才輸出 `DELIVERED/DELIVERY_VERIFIED`，retry／fixpoint建立linked attempt。
- [ ] 6.8 新增inventory missing／ambiguous、non-Linux target、fresh-fetch／exact-equality failure、partial health、Windows runner／network unavailable、signer revoked、artifact auth、egress／quota與secret leakage tests。

## 7. Self-referential bootstrap 與一次性 activation

- [ ] 7.1 為所有merge／verification／deploy mechanism paths建立bootstrap ledger opening contract，並證明candidate版本只作data、由先前attested external policy裁決。
- [ ] 7.2 定義並驗證signed `activation-plan`：每phase列exact command／ID、authority、pre-state digest、server observation、artifact schema、pass／failure state與rollback command ID，不保存private topology。
- [ ] 7.3 在 `LEGACY_GUARDED` 且merge sink disabled時完成App、signer／trusted verifier／executor、authenticated artifact store、credential brokers、Linux／Windows runners的一次性owner provisioning及non-secret attestation。
- [ ] 7.4 在 `SHADOW_DUAL` 執行live negative matrix：wrong／revoked source、head/base與non-head drift、candidate mechanism mutation、credential inheritance、ruleset mismatch、concurrent delivery、commit mismatch、artifact／egress／quota與secret redaction全部fail closed。
- [ ] 7.5 在舊gate仍為唯一merge authority時先加入source-pinned machine required check並執行shadow observation；machine gate不可用時確認merge保持blocked。
- [ ] 7.6 進入 `CUTOVER_ARMED`：owner broker取得settings lease與exact rollback snapshot，在sink disabled時把approvals設0／CODEOWNER off／last-push approval off／停用User broker，並確認native auto-merge維持disabled及source-pinned check只接受actual `success`；authoritative reread不符即rollback。
- [ ] 7.7 在 `CANARY_ACTIVE` 先讓manifest-pinned `activation_canary` 以machine-only REST merge與exact delivery完成；再由其merge commit／open debt導出single-use `activation_closure` tuple，只准ledger＋該entry新fixpoint evidence paths。
- [ ] 7.8 Closure-only PR以machine gates／REST CAS／exact delivery關閉oldest debt；canary與closure皆 `DELIVERED`、settings reread相等後才進入 `AUTONOMOUS_ACTIVE`，任何額外path／PR即rollback `HELD`。
- [ ] 7.9 在 `AUTONOMOUS_ACTIVE` 以綁定debt與delivery ID的 `reconciliation` PR完成一般self-referential fixpoint closure；fixpoint command已啟動後的可重現negative結果則轉入repair／revert lineage，且ordinary queue全程凍結。

## 8. 文件、回歸驗證與 closeout

- [ ] 8.1 更新 `AGENTS.md` lazy-load入口、`docs/agents/github-workflow.md`、`self-referential-bootstrap.md`、deployment contract與shared workflow docs，清楚區分一次性activation與未來machine-only PR flow。
- [x] 8.2 依writing-skills TDD先對現行repo-local skills跑RED pressure scenarios，保存實際違反的masked token／`blip-approve`主路徑與第三head；同時保存既有正確的wrong-source／`neutral` fail-closed、partial pagination拒絕、stale-head invalidation與credential separation，不為了製造RED改寫baseline evidence。
- [x] 8.3 最小化更新Claude／Codex byte-identical `autonomous-pr-queue` mirrors，使其成為D13 named-PR finalization主入口；將 `blip-approve` mirrors降為 `LEGACY_GUARDED` compatibility，更新 `pr-queue-manager` routing與 `agent-skills-manifest.json` digests，重跑相同pressure scenarios取得GREEN並完成REFACTOR review。
- [ ] 8.4 建立merge後global maintenance activation handoff，明列user-level `ai-bim-pr-queue` routing、其他user-level skill與ProgramData runtime的Stage、Apply、machine-truth checks與rollback；repo source或manifest pass不得冒充installed／live activation evidence。
- [ ] 8.5 執行affected typecheck、lint、unit／contract／integration tests，以及repo lifecycle、OpenSpec strict、closed state／G1–G12、finalization round budget、skill parity、signer／artifact／secret-redaction與self-referential bootstrap verifiers。
- [ ] 8.6 對所有修改的shared symbols依Lane G執行GitNexus impact與commit前detect-changes；HIGH補上測試／隔離策略，CRITICAL取得明示sign-off。
- [ ] 8.7 執行PR local preflight與machine-truth檢查，逐項記錄G1–G12、checks、exact-head lease／adjudication、App／signer source、兩輪收斂、skill pressure evidence、merge observation、canonical Linux／Windows runtime與fixpoint evidence。
- [ ] 8.8 在實作PR merge且fixpoint closure完成後同步canonical specs、archive本change、更新lifecycle ledger／NOW，並只以 `DELIVERED|FAILED|HELD` terminal class加closed reason code完成交接。
