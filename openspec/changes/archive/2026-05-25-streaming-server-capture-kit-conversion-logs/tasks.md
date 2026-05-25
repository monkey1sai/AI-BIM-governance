# Tasks — streaming-server-capture-kit-conversion-logs

> `/goal` 視這份 tasks.md 為**參考路徑**;acceptance condition 見 `acceptance.md`。任一 task 失敗 stop 給人類。

## 0. Pre-implementation setup

- [x] 0.1 切 worktree + branch(`codex/openspec/streaming-server-capture-kit-conversion-logs` from `origin/main`)
- [x] 0.2 寫 proposal / design / tasks / acceptance / spec deltas
- [x] 0.3 Commit scaffold
      - scaffold / primary implementation 已先由 PR #100 merge;本 branch 追加 apply gap follow-up

## 1. GitNexus pre-impact analysis

- [x] 1.1 `gitnexus_impact({target:"_run_powershell_conversion"})`(or whichever Python method invokes ps1)
- [x] 1.2 `gitnexus_impact({target:"Ifc2UsdcPowershellConverterAdapter"})`
- [x] 1.3 任一 HIGH/CRITICAL → stop 回報

## 2. ps1 redirect Kit subprocess stdout/stderr

- [x] 2.1 `bim-streaming-server/scripts/convert-ifc-to-usdc.ps1`:line ~285 之後改 startInfo 加:
      - `$startInfo.RedirectStandardOutput = $true`
      - `$startInfo.RedirectStandardError = $true`
- [x] 2.2 加 `$stdoutLog` / `$stderrLog` 變數(`Join-Path $artifactDir "kit-stdout.log" / "kit-stderr.log"`)
- [x] 2.3 加 `StreamWriter` + `Register-ObjectEvent` async pipe(per `design.md` §2)
- [x] 2.4 `BeginOutputReadLine` / `BeginErrorReadLine` 在 process start 後立即呼叫
- [x] 2.5 `finally` 內:`WaitForExit()` 二次 call ensure async drain → `Unregister-Event` → `StreamWriter.Close` → `process.Dispose`
- [x] 2.6 失敗 throw 改寫成 multi-line message,含:
      - 既有 reason 字串
      - `kit_stdout_log:` <path>
      - `kit_stderr_log:` <path>
      - `---- stderr tail (last 100 lines) ----` + content
      - `---- stdout tail (last 50 lines) ----` + content

## 3. Python adapter 帶 log path 進 result.error

- [x] 3.1 `bim-streaming-server/source/extensions/.../ifc2usdc_powershell_adapter.py`:
      - subprocess.run `result.returncode != 0` 時,從 `result.stderr` / 或 ps1 throw message 用 regex 抓 `kit_stdout_log:\s*(.+)$` + `kit_stderr_log:\s*(.+)$`(每行一個)
      - 若解到 path,把 `ConversionAuthorityError("converter_failed", message, metadata={kit_stdout_log, kit_stderr_log})` 帶 metadata(若 ConversionAuthorityError 不接 metadata,加 attribute)
- [x] 3.2 `host_native_conversion_service` 寫 result error dict 時,從 ConversionAuthorityError 拿 metadata 寫進 `error.kit_stdout_log` / `error.kit_stderr_log`

## 4. Pytest

- [x] 4.1 `bim-streaming-server/tests/test_host_native_conversion_service.py` 加 case:
      - fake `ConverterAdapter` 拋 `ConversionAuthorityError("converter_failed", "<msg with kit_stdout_log:/path; kit_stderr_log:/path>", metadata=...)`
      - 跑 conversion API
      - `GET /result` response `error` 含 `kit_stdout_log` + `kit_stderr_log` 欄位
- [x] 4.2 `tests/test_conversion_authority_api.py` 既有 case 不破

## 5. OpenSpec spec delta finalize

- [x] 5.1 `openspec/changes/streaming-server-capture-kit-conversion-logs/specs/streaming-ifc-usdc-conversion-authority/spec.md`:`## MODIFIED Requirements` 加 SHALL 子條款
- [x] 5.2 `npx openspec validate streaming-server-capture-kit-conversion-logs --strict` 綠
- [x] 5.3 `npx openspec validate --specs --strict` 整體仍綠

## 6. L1 verify

- [x] 6.1 `cd bim-streaming-server && python -m pytest tests -q`(31 既有 + 新)
- [x] 6.2 `cd bim-review-coordinator && npm run verify`(coordinator 不動,regression)
- [x] 6.3 `python -m pytest tests -p no:cacheprovider`(root)
- [x] 6.4 `cd bim-streaming-server && powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\tests\test-convert-ifc-to-usdc.ps1`
      - gap:plan-only script test failed because `ConvertTo-AbsolutePath` passed wildcard `*.ifc` to `.NET GetFullPath`
      - fix:wildcard patterns keep wildcard tokens and are only anchored under repo root before `Get-ChildItem -Path`

## 7. L3 GitNexus post-change

- [x] 7.1 `gitnexus_detect_changes({scope:"all"})` 確認 scope

## 8. L4 真實 runtime

- [x] 8.1 streaming-server 重啟讀新 code(kill 7488 + 重新 launch)
      - L4 restart:PID `36380`,`STORAGE_ROOT=C:\Repos\active\iot\AI-BIM-governance\storage`,
        `GET http://127.0.0.1:49101/health` 回 `status=ok` / `role=conversion-only`
- [x] 8.2 用 user 341MB IFC URL 透過 Postman / Python urllib 重跑 一次
      - user 341MB IFC local cache:`storage/ifc-cache/ifcready_1779687625000_064c6813/source.ifc`
        (`332760325` bytes)
      - direct streaming POST job:`stream_conv_20260525055218_115177da`
- [x] 8.3 看 `GET /api/external/ifc-ready/<job>` 內 dispatch_error 或 streaming-server `GET /result` 內 error 是否含 `kit_stdout_log` / `kit_stderr_log` path
      - L4 result terminal:`status=succeeded`,`ready=true`,
        `materialization_strategy=ifcopenshell_openusd_fallback`,
        `source_ifc_entity_count=4889`,`mapped_count=4889`
      - 因 result 成功,依 spec 沒有 `error` object;成功情境改驗證
        `kit-stdout.log` / `kit-stderr.log` retained on disk alongside `model.usdc`
- [x] 8.4 `tail bim-streaming-server/_cache/host-native-conversion/artifacts/<conv>/kit-stderr.log` 看 Kit 真實錯誤訊息
      - `bim-streaming-server/_cache/host-native-conversion/artifacts/stream_conv_20260525055218_115177da/kit-stderr.log`
        tail 顯示 Kit / HOOPS primary import failure:
        `A3D_LOAD_CANNOT_LOAD_MODEL` / error code `-10007`
      - 同 artifact dir 另有 `kit-stdout.log` 與 `model.usdc`;證明本 change 的 subprocess
        stdout/stderr capture 在真實 runtime 下可觀察

## 9. Commit / PR / merge

- [x] 9.1 stage + commit(繁中 message)
      - `fb80a91 fix(streaming): handle IFC wildcard plan paths`
      - `388b661 docs(openspec): 記錄 L4 轉檔觀察證據`
- [x] 9.2 push + gh pr create
      - follow-up PR #103:`https://github.com/monkey1sai/AI-BIM-governance/pull/103`
- [ ] 9.3 CI / reviewer / merge

## 10. Post-merge sync + archive

- [ ] 10.1 archive branch + git mv
- [ ] 10.2 sync `openspec/specs/streaming-ifc-usdc-conversion-authority/spec.md` 加 MODIFIED requirement body
- [ ] 10.3 roadmap 加 archive 摘要
- [ ] 10.4 archive PR + merge
- [ ] 10.5 worktree closeout + GitNexus reindex

## 11. Goal done

- [ ] 11.1 §0-§10 全 check
- [ ] 11.2 通知使用者 change archived;debug 大檔 Kit fail 已有可觀察性
