# Tasks — fix-ifc-usdc-hoops-load-failure

## 0. Setup

- [x] 0.1 Clean unrelated GitNexus statistic diffs from main.
- [x] 0.2 Create isolated worktree/branch `codex/openspec/fix-ifc-usdc-hoops-load-failure`.
- [x] 0.3 Create OpenSpec scaffold and artifacts.
- [ ] 0.4 Commit OpenSpec scaffold before implementation.

## 1. Root-cause evidence

- [x] 1.1 Confirm `POST /api/external/ifc-ready` succeeded for `ifcready_1779433462219_1e2834ae`.
- [x] 1.2 Confirm IFC bytes were downloaded to shared volume and are a real IFC file.
- [x] 1.3 Confirm streaming conversion job `stream_conv_20260522070435_a1883f59` failed with `A3D_LOAD_CANNOT_LOAD_MODEL`.
- [x] 1.4 Confirm IfcOpenShell can parse the same IFC and produce geometry iterator output.

## 2. GitNexus pre-impact

- [ ] 2.1 Run impact analysis for `Ifc2UsdcPowershellConverterAdapter.convert`.
- [ ] 2.2 Run impact analysis for `_run_powershell_conversion`.
- [ ] 2.3 Run impact analysis for any new fallback helper before editing.
- [ ] 2.4 If any impact is HIGH/CRITICAL, stop and report before editing.

## 3. Failing tests first

- [ ] 3.1 Add unit test where primary converter failure containing `A3D_LOAD_CANNOT_LOAD_MODEL` triggers fallback.
- [ ] 3.2 Add unit test where fallback writes `model.usdc`, `element_mapping.json`, `entity_index.json`, `metadata.json`, and real quality metrics.
- [ ] 3.3 Add unit test where missing IfcOpenShell or OpenUSD fallback prerequisite remains non-ready and does not publish ready.
- [ ] 3.4 Add test guard that fallback output with no renderable mesh or placeholder marker is rejected.

## 4. Implement fallback converter

- [ ] 4.1 Add scoped fallback helper in `bim-streaming-server` messaging converter area.
- [ ] 4.2 Lazy import `ifcopenshell`, `ifcopenshell.geom`, and `pxr` only inside fallback path.
- [ ] 4.3 Convert IfcOpenShell geometry shapes into USD mesh prims under a stable root prim.
- [ ] 4.4 Preserve IFC GUID/name/class where available in mapping and metadata.
- [ ] 4.5 Write required sidecars and quality metrics.
- [ ] 4.6 Validate generated `model.usdc` with USD stage openability and mesh count.
- [ ] 4.7 Wire fallback into `Ifc2UsdcPowershellConverterAdapter.convert` only for primary import failure.

## 5. Local verification

- [ ] 5.1 `cd bim-streaming-server && python -m pytest tests -q`
- [ ] 5.2 `openspec validate fix-ifc-usdc-hoops-load-failure --strict`
- [ ] 5.3 `openspec validate --specs --strict`
- [ ] 5.4 `gitnexus detect-changes` or MCP equivalent for changed scope.

## 6. Real runtime verification

- [ ] 6.1 Restart host-native conversion service so it reads new code.
- [ ] 6.2 Submit a new B-scheme IFC-ready request with fresh correlation/idempotency.
- [ ] 6.3 Poll coordinator until terminal state.
- [ ] 6.4 Verify `conversion_status="ready"` for the new `ifc_ready_job_id`.
- [ ] 6.5 Verify streaming result has ready `model_usdc` artifact and fallback quality metrics.
- [ ] 6.6 Verify produced `model.usdc` opens with USD runtime.
- [ ] 6.7 Verify coordinator produces `viewer_url`, or document a separate WebRTC/viewer blocker without treating conversion as failed.

## 7. Commit / PR / archive

- [ ] 7.1 Commit implementation and OpenSpec artifacts.
- [ ] 7.2 Push branch and open PR with Traditional Chinese title/body.
- [ ] 7.3 Wait for CI/review and merge.
- [ ] 7.4 Archive only after real runtime conversion success evidence exists.
- [ ] 7.5 Sync roadmap Markdown and HTML if archive is performed.
