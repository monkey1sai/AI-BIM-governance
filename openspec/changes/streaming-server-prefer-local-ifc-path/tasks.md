# Tasks — streaming-server-prefer-local-ifc-path

> `/goal` 視這份 tasks.md 為**參考路徑**;acceptance condition 見 `acceptance.md`。任一 task 失敗 stop 給人類。

## 0. Pre-implementation setup

- [x] 0.1 切 worktree + branch(`codex/openspec/streaming-server-prefer-local-ifc-path` from `origin/main`)
- [x] 0.2 寫 proposal / design / tasks / acceptance / spec deltas
- [x] 0.3 GitNexus reindex(已 background 跑完,index = 12e883d)
- [ ] 0.4 Commit scaffold(本 task 完成後)

## 1. GitNexus pre-impact analysis

- [ ] 1.1 `gitnexus_impact({target:"_ifc_artifact", direction:"upstream"})`
- [ ] 1.2 `gitnexus_impact({target:"_resolve_local_ifc", direction:"upstream"})`
- [ ] 1.3 `gitnexus_impact({target:"_url_to_local_path", direction:"upstream"})`
- [ ] 1.4 `gitnexus_impact({target:"Ifc2UsdcPowerShellAdapter", direction:"upstream"})`
- [ ] 1.5 任一回 HIGH/CRITICAL → stop,回報後等使用者裁定

## 2. conversion_authority._ifc_artifact propagate local paths

- [ ] 2.1 `bim-streaming-server/.../conversion_authority.py` `_ifc_artifact`:
      - return dict 加 `local_path: str | None = raw.get("local_path")`
      - return dict 加 `host_local_path: str | None = raw.get("host_local_path")`
      - 不驗證(留給 adapter `_resolve_local_ifc` sandbox)

## 3. Ifc2UsdcPowerShellAdapter storage_root config

- [ ] 3.1 `bim-streaming-server/.../ifc2usdc_powershell_adapter.py` `Ifc2UsdcPowerShellAdapter.__init__`:
      - 加 `storage_root: Path | None = None` 參數
      - 內部 resolve:`self.storage_root = (storage_root or Path(os.environ.get("STORAGE_ROOT") or Path.cwd())).resolve()`

## 4. Adapter _resolve_local_ifc new resolution order

- [ ] 4.1 加 helper `_try_local(self, candidate: str | None) -> Path | None`:
      - None / empty → None
      - relative → join `self.storage_root`
      - absolute → resolve
      - 必須 `relative_to(self.storage_root)`,否則 raise `ConversionAuthorityError("invalid_ifc_input", "local IFC path is outside storage_root: ...")`
      - `is_file()` 才回傳;否則 None(soft fallback)
- [ ] 4.2 `_resolve_local_ifc` 改寫順序:
      1. `_try_local(artifact.get("host_local_path"))` → 用它
      2. `_try_local(artifact.get("local_path"))` → 用它
      3. fallback 既有 url 解析(unchanged)

## 5. Pytest 覆蓋

- [ ] 5.1 `bim-streaming-server/tests/test_conversion_authority_api.py` 加 case:
      - `test_resolve_prefers_host_local_path_inside_storage_root`
      - `test_resolve_falls_back_to_local_path_when_host_local_path_missing`
      - `test_resolve_falls_back_to_url_when_local_paths_unreadable`
      - `test_resolve_rejects_local_path_outside_storage_root`
      - `test_existing_file_url_still_resolved`(regression guard)
- [ ] 5.2 若 conversion_authority test 也涵蓋 `_ifc_artifact` 行為,加:
      - `test_ifc_artifact_propagates_local_paths`

## 6. OpenSpec spec deltas finalize

- [ ] 6.1 `openspec/changes/streaming-server-prefer-local-ifc-path/specs/conversion-webhook-lifecycle/spec.md`:
      `## ADDED Requirements` `Streaming-server consumes shared-volume local IFC path before url fetch` + 3 Scenarios
- [ ] 6.2 `npx openspec validate streaming-server-prefer-local-ifc-path --strict` 綠
- [ ] 6.3 `npx openspec validate --specs --strict` 整體仍綠

## 7. L1 verification

- [ ] 7.1 `cd bim-streaming-server && python -m pytest tests/test_conversion_authority_api.py -q`(含新增 case 全綠)
- [ ] 7.2 `cd bim-streaming-server && python -m pytest tests -q`(整 suite regression)
- [ ] 7.3 `cd bim-review-coordinator && npm run verify`(coordinator 端不動,regression 防護)
- [ ] 7.4 `python -m pytest tests -p no:cacheprovider`(root contracts/fakes)

## 8. L3 GitNexus post-change

- [ ] 8.1 `gitnexus_detect_changes({scope:"all"})` 確認影響面 = §2 / §3 / §4 / §5 預期 file set
- [ ] 8.2 任一新出現的 unexpected file → stop debug

## 9. L4 真實 runtime end-to-end

- [ ] 9.1 用 PR #95 已驗證的 docker stack:`docker compose -p ai-bim-web-plane-host-kit ... up -d --build coordinator viewer`
- [ ] 9.2 streaming-server host-native 重啟(讀新 code):`pytest` 已綠不代表 runtime;`Ctrl+C` 既有 process,重啟 49101/49100
- [ ] 9.3 重跑 Postman ① ②(或 Python urllib 等效):
      - ① POST 預期 202 + download_status:downloaded
      - ② Poll 預期 conversion_status 從 queued → 終態(ready / failed,而非 stuck queued)
      - 若可達真實 URL → ready + viewer_url 出現
- [ ] 9.4 `docker exec coordinator ls /workspace/storage/ifc-cache/<jobId>/source.ifc` 確認 IFC bytes 真實落地
- [ ] 9.5 streaming-server 端 log 看 path resolution 結果(host_local_path / local_path / url 哪一條走通)

## 10. Commit / Push / PR / Merge

- [ ] 10.1 `git status` 確認 staged file set = §2-§6 expected
- [ ] 10.2 `git add` 指定路徑(不用 `-A`)
- [ ] 10.3 `git commit` 繁中 message(涵蓋 §2-§6 + verification summary)
- [ ] 10.4 `git push -u origin codex/openspec/streaming-server-prefer-local-ifc-path`
- [ ] 10.5 `gh pr create`(繁中 title + description)
- [ ] 10.6 GitHub Actions CI 全綠
- [ ] 10.7 Reviewer approves
- [ ] 10.8 `gh pr merge --squash`

## 11. Post-merge sync + archive

- [ ] 11.1 切回 main 工作目錄,`git fetch origin --prune` + `git pull --ff-only origin main`
- [ ] 11.2 切 archive branch:`git switch -c codex/openspec/archive-streaming-server-prefer-local-ifc-path`
- [ ] 11.3 `git mv openspec/changes/streaming-server-prefer-local-ifc-path/` → `openspec/changes/archive/<YYYY-MM-DD>-streaming-server-prefer-local-ifc-path/`
- [ ] 11.4 把 spec delta 併進 `openspec/specs/conversion-webhook-lifecycle/spec.md`(主 spec body 加新 requirement + scenario;模仿 fast-ifc-link-demo-loop archive PR #93)
- [ ] 11.5 `npx openspec validate --specs --strict` 綠
- [ ] 11.6 更新 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`:加 archive 摘要
- [ ] 11.7 commit + push + open archive PR + merge
- [ ] 11.8 worktree closeout:`git worktree remove .worktrees/streaming-server-prefer-local-ifc-path` + `git branch -D` local
- [ ] 11.9 `npx gitnexus analyze --embeddings`(GitNexus reindex final)

## 12. Goal done

- [ ] 12.1 §0 ~ §11 全 check
- [ ] 12.2 通知使用者 change archived;fast-mvp loop end-to-end 真實達成(viewer_url 出現)
