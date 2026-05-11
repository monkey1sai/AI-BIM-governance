# Worker Real Conversion Quality Evidence - 2026-05-11

## Scope

OpenSpec change: `worker-real-conversion-quality`

本紀錄只驗證 `_worker` 的 IFC -> USDC conversion quality 邊界，不宣稱
`bim-streaming-server` / browser viewport 已完成 single Kit render evidence。

## Fixture Inventory

Current Codex worktree:

- `storage/` 只有 `README.md`，沒有 tracked `.ifc` fixture。

User main checkout:

- `C:\Repos\active\iot\AI-BIM-governance\storage`
- 13 個 ignored repo-local IFC fixture。
- 每個 fixture 大小皆為 `89394282` bytes。
- 本次 spike 使用：`許良宇圖書館建築_2026 - 複製 (10).ifc`

Renderable but not worker-produced fixtures in user main checkout:

- `bim-streaming-server\bim-models\許良宇圖書館建築_2026.usd` (`27525126` bytes)
- `bim-streaming-server\bim-models\許良宇圖書館建築_2026.usdc` (`28458306` bytes)

這兩個 USD/USDC 可作 Kit/browser runtime fixture，但不能當成 `_worker`
real IFC conversion evidence。

## Converter Candidate Inventory

| Candidate | License / source observed | Windows support | Output shape | GPU / Kit SDK |
|---|---|---|---|---|
| IfcOpenShell + usd-core | `ifcopenshell 0.8.5` package classifier reports `LGPLv3+`; `usd-core 26.5` reports `LicenseRef-TOST-1.0` | Available in current Python 3.12 user site-packages | Worker-owned `.usdc`, `ifc_index.json`, `usd_index.json`, one-to-many `element_mapping.json` | No GPU / Kit SDK required |
| Kit / HOOPS CAD converter script | Repo script exists at `bim-streaming-server/scripts/convert-ifc-to-usdc.ps1`; current `_build/.../kit.exe` absent | Windows-oriented PowerShell + Kit build | External smoke output | Requires Kit build and converter extension; not available in this worktree |
| `IfcConvert` CLI | `Get-Command IfcConvert` returned no executable | Not available on PATH | Unknown | No Kit required if installed, but unavailable |
| Speckle / other service bridge | Not installed in repo or local environment | External service / SDK decision required | Not evaluated | Not selected for this P0 implementation |

Decision: implement the `_worker` production adapter boundary with
IfcOpenShell + OpenUSD (`usd-core`) as external prerequisites. Missing packages
or non-openable output fail the conversion job.

## Spike Evidence

### Read IFC

Command summary:

```txt
python -c "... ifcopenshell.open(<fixture>) ..."
```

Observed result:

```txt
schema: IFC4X3
products_with_guid: 7362
duration: 4.32 seconds
```

### Partial USDC Spike

Output:

```txt
C:\tmp\worker-real-conversion-spike-20.usdc
converted_shapes: 20
usd_prims: 21
duration: 0.17 seconds
output_size_bytes: 18434
```

The output was reopened with `Usd.Stage.Open`.

### Full 89 MB USDC Spike

Output:

```txt
C:\tmp\worker-real-conversion-spike-full.usdc
fixture_size_bytes: 89394282
source_ifc_products_with_guid: 7362
converted_shapes: 7000
skipped_shapes: 1
usd_prim_count: 6949
mapped_count: 6998
unmapped_count: 364
coverage_ratio: 0.950557
vertex_count: 676541
face_count: 1288782
duration_seconds: 189.15
output_size_bytes: 9831911
```

The output was reopened with `Usd.Stage.Open`, so the hard openability gate
passed for the spike. Coverage remains measure-first; no minimum baseline is
locked by this evidence.

## Implementation Evidence

The worker now:

- Uses `_worker/app/converters.py` as the adapter boundary.
- Writes `model.usdc`, `ifc_index.json`, `usd_index.json`, and optional
  `element_mapping.json` from real IFC geometry data.
- Emits `converter` and `quality_metrics` in conversion result payloads.
- Supports one IFC GUID -> many USD prim paths through
  `primary_usd_prim_path` and `usd_prim_paths`.
- Fails the job when converter prerequisites are missing, output is not
  openable, output contains placeholder markers, or mapping output is marked
  mock/fake.
- Leaves artifact group readiness at `missing_derived` on failure.

## Validation

Executed:

```txt
cd _worker
python -m pytest tests\test_worker_store.py -q --basetemp .pytest_tmp
```

Result:

```txt
45 passed in 0.66s
```

Executed with local validation-only Starlette target path because global
`fastapi 0.111.0` and `starlette 1.0.0` are incompatible:

```txt
cd _worker
$env:PYTHONPATH=(Resolve-Path .test-deps).Path
python -m pytest tests\test_worker_api.py -q --basetemp .pytest_tmp
```

Result:

```txt
32 passed, 1 skipped
```

The skipped test is the opt-in real converter smoke gated by
`WORKER_RUN_REAL_USDC_SMOKE=1`.

## Blocked / Not Claimed

- Single Kit/browser render evidence was not run in this worktree because
  `bim-streaming-server\_build\windows-x86_64\release\kit\kit.exe` was absent.
- Root smoke `scripts/smoke-worker-review-request.ps1` now requires a real dev
  IFC source and real converter prerequisites; it was not run here because the
  four local services were not started in this verification pass.
- The current worktree does not contain the ignored 89 MB IFC fixture; the
  spike used the user's main checkout fixture path as the repo-local ignored
  fixture source.
