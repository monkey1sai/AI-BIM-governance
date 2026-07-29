# Cross-service structured-log P4 evidence

This evidence records the standalone viewer diagnostics slice for Task 11. The tested product commit is `aa1f191449bcb9a48884a3bbdfc1be25c3847929`; the owned runtime attempt is `attempt-20260728T061317Z-aa1f191`.

## Verified facts

- The coordinator-generated route opened successfully at `http://127.0.0.1:8005/ui/open?session=review_session_222aa892a09b&trace_id=ifcready_1785219227760_d633cc09`.
- The browser clicked `structured-log-flush`, observed exactly three Playwright-intercepted `503` responses, clicked `structured-log-retry`, and received a real coordinator `200` response.
- The same browser surface clicked `review-session-close`; `POST /api/review-sessions/review_session_222aa892a09b/close` returned `200` with status `closed`.
- The visible sequence was `ready -> flush_loading -> flush_failure -> retry_loading -> flush_success -> close_loading -> closed`.
- Runtime identities were case-exact: root/IFC-ready `ifcready_1785219227760_d633cc09`, browser run `run_20260728_061443_890e56`, conversion `stream_conv_20260728061348_6d54bbe0`, review session `review_session_222aa892a09b`, and Kit `kit_local_001`.
- The authorized fixture was `demo_lib_2026.ifc`, 89,394,282 bytes, SHA-256 `54d77fe1c8839bdd7d2cb46a9a87e4491b75f0019462608fab7bc5fc86155b71`.
- The artifact manifest and runtime verifier independently revalidated all 18 listed files by size and SHA-256. Runtime schema/redaction validation passed for coordinator, streaming-server, viewer, and scripts. Owned shutdown completed with no foreign listeners.
- Canonical P4 native-equivalent output is `ok=true`, `engine=playwright`, `verticalSliceOk=true`, and `notObserved=[]` for this diagnostics slice.

## Browser artifacts

- [Visible forced failure and retry](structured-log-failure.png), 146,586 bytes, SHA-256 `db8588e78126bcb72ec2379376d96f9ae68605f3bfa997dfe1fcd15d81f601a6`.
- [Visible delivery success and closed session](structured-log-success-closed.png), 150,313 bytes, SHA-256 `1b582c6c366b5efdc8c3905bb13ea310f379e67ac1dd98dbba3611beb7d26fe5`.
- The privacy-sanitized Playwright trace plus console, network, operability, manifest, runtime validation, and shutdown records are retained under `C:\Repos\active\iot\AI-BIM-governance\artifacts\e2e\cross-service-structured-log-baseline-trace`.
- The machine-readable P4 summary is `C:\Repos\active\iot\AI-BIM-governance\artifacts\e2e\cross-service-structured-log-baseline-summary.json`.

## Design gate

- Classification remains `mixed`; full completion is `no`.
- Current-HEAD reference, Playwright visual, and visual-result gates all passed without changing product code, goldens, or thresholds.
- All 13 approved screens had semantic parity `100%`.
- Maximum diff ratios were `0.00006944444444444444` at 1440x900 and `0.00009837962962962963` at 1920x1080, both below `0.01`.
- The result and all 52 actual/diff images are retained under `C:\Repos\active\iot\AI-BIM-governance\artifacts\e2e\cross-service-structured-log-baseline-design-visual-result.json` and `...\cross-service-structured-log-baseline-design-visual`.
- Reference-missing routes remain `#issues`, `#reports`, `#viewer`, `#gpu`, `#conv`, `#sessions`, `#instances`, `#minio`, `#admin`, `#spec`, and `#review`; reference-missing surfaces remain `kit-manager-web` and `coordinator-dev-console`.

The first diagnostic visual run was invalid because the sandbox denied Google Fonts requests and Chromium used fallback fonts. A managed network-enabled rerun loaded the required Noto Sans TC and JetBrains Mono assets and passed. This is an execution-boundary diagnosis, not a product or golden change.

## Commands

Runtime evidence runner:

```powershell
pwsh -NoProfile -File scripts/dev/run-structured-log-runtime-evidence.ps1 -AttemptRoot C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline\artifacts\spec-to-done\cross-service-structured-log-baseline\evidence\attempt-20260728T061317Z-aa1f191 -FixturePath C:\Repos\active\iot\AI-BIM-governance\storage\demo_lib_2026.ifc -PythonExe C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline\.venv\Scripts\python.exe -CoordinatorPort 8005 -ViewerPort 5175 -ConversionPort 49104 -KitProvisionMode Build -LivePollSeconds 180
```

Design gates:

```powershell
pwsh -NoProfile -NonInteractive -File scripts/tests/verify-design-system-reference.ps1
Push-Location web-viewer-sample
npm run test:visual:design-system
Pop-Location
pwsh -NoProfile -NonInteractive -File scripts/tests/verify-design-system-visual-result.ps1 -TargetCommit HEAD -AllowUntrackedArtifacts
```

## Inferences

- The standalone structured-log diagnostics flow is operable across browser, coordinator, conversion, and Kit identity carriers.

## Unverified risks

- WebRTC first-frame, matched stage truth, and render fidelity were not observed by this standalone diagnostics pass. Full viewer or full-system completion is not claimed.
- The sanitized action trace intentionally has no embedded screenshots, DOM snapshots, or network payload. Separate hash-bound screenshots and structured network evidence retain those observations.

## Backup path

The superseded HELD artifacts were preserved at `C:\Repos\active\iot\AI-BIM-governance\artifacts\e2e\cross-service-structured-log-baseline-stale-held-20260728T1436` and in the worktree's ignored `artifacts/spec-to-done/cross-service-structured-log-baseline/stale-doc-evidence-20260728T1422` directory.
