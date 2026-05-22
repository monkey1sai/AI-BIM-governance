# Tasks — fix-ifc-usdc-hoops-load-failure

## 0. Setup

- [x] 0.1 Clean unrelated GitNexus statistic diffs from main.
- [x] 0.2 Create isolated worktree/branch `codex/openspec/fix-ifc-usdc-hoops-load-failure`.
- [x] 0.3 Create OpenSpec scaffold and artifacts.
- [x] 0.4 Commit OpenSpec scaffold before implementation.

## 1. Root-cause evidence

- [x] 1.1 Confirm `POST /api/external/ifc-ready` succeeded for `ifcready_1779433462219_1e2834ae`.
- [x] 1.2 Confirm IFC bytes were downloaded to shared volume and are a real IFC file.
- [x] 1.3 Confirm streaming conversion job `stream_conv_20260522070435_a1883f59` failed with `A3D_LOAD_CANNOT_LOAD_MODEL`.
- [x] 1.4 Confirm IfcOpenShell can parse the same IFC and produce geometry iterator output.

## 2. GitNexus pre-impact

- [x] 2.1 Run impact analysis for `Ifc2UsdcPowershellConverterAdapter.convert`.
- [x] 2.2 Run impact analysis for `_run_powershell_conversion`.
- [x] 2.3 Run impact analysis for fallback scope / adapter class.
- [x] 2.4 Impact remained LOW; no HIGH/CRITICAL stop condition.

## 3. Failing tests first

- [x] 3.1 Add unit test where primary converter failure containing `A3D_LOAD_CANNOT_LOAD_MODEL` triggers fallback.
- [x] 3.2 Add unit test where fallback writes `model.usdc`, `element_mapping.json`, `entity_index.json`, `metadata.json`, and real quality metrics.
- [x] 3.3 Add unit test where missing IfcOpenShell or OpenUSD fallback prerequisite remains non-ready and does not publish ready.
- [x] 3.4 Add test guard that fallback output with no renderable mesh or placeholder marker is rejected.

## 4. Implement fallback converter

- [x] 4.1 Add scoped fallback helper in `bim-streaming-server` messaging converter area.
- [x] 4.2 Lazy import `ifcopenshell`, `ifcopenshell.geom`, and `pxr` only inside fallback path.
- [x] 4.3 Convert IfcOpenShell geometry shapes into USD mesh prims under a stable root prim.
- [x] 4.4 Preserve IFC GUID/name/class where available in mapping and metadata.
- [x] 4.5 Write required sidecars and quality metrics.
- [x] 4.6 Validate generated `model.usdc` with USD stage openability and mesh count.
- [x] 4.7 Wire fallback into `Ifc2UsdcPowershellConverterAdapter.convert` only for primary import failure.

## 5. Local verification

- [x] 5.1 `cd bim-streaming-server && python -m pytest tests -q`
- [x] 5.2 `openspec validate fix-ifc-usdc-hoops-load-failure --strict`
- [x] 5.3 `openspec validate --specs --strict`
- [x] 5.4 GitNexus impact remained LOW; MCP detect-changes cannot see this `.worktrees/` checkout, so `git diff --stat` was used for changed-scope confirmation before commit.

## 6. Real runtime verification

- [x] 6.1 Run the fixed conversion API path via FastAPI `TestClient` using main Kit/HOOPS assets and cached target IFC.
- [x] 6.2 Verify API result `stream_conv_20260522074249_54684134` has `ready=true`, `model.status="ready"`, and fallback quality metrics.
- [x] 6.3 Verify produced `model.usdc` opens with USD runtime and contains 5128 mesh prims.
- [ ] 6.4 Restart live host-native conversion service on `49101` after this branch is merged/deployed.
- [ ] 6.5 Submit a new coordinator `POST /api/external/ifc-ready` request with fresh correlation/idempotency.
- [ ] 6.6 Poll coordinator until terminal state and verify `conversion_status="ready"` for the new `ifc_ready_job_id`.
- [ ] 6.7 Verify coordinator produces `viewer_url`, or document a separate WebRTC/viewer blocker without treating conversion as failed.

## 7. Commit / PR / archive

- [x] 7.1 Commit implementation and OpenSpec artifacts.
- [x] 7.2 Push branch and open PR with Traditional Chinese title/body: PR #101.
- [ ] 7.3 Wait for CI/review and merge.
- [ ] 7.4 Archive only after real runtime conversion success evidence exists.
- [ ] 7.5 Sync roadmap Markdown and HTML if archive is performed.
