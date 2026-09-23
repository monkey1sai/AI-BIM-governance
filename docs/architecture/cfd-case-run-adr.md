# ADR: Deepen CFD Case Run

## Status

Proposed on 2026-09-23 from the architecture review of the same date. The repository owner pre-authorized the recommended answer to every question in the Grilling Record. Accepted when this document merges to `main`; implementation follows the tracer bullets in §5.

Relates to `docs/plans/building-energy-cfd-p2-contract.md` (S1, S5b, R-A4). No `cfd-run-*` contract schema changes.

Amended on 2026-09-23 while implementing tracer bullet 1 (§5): the §2 sketch now matches the implemented module (`shell_stl` on the spec, `case_run_id`, a `runner_failed` outcome kind, the progress-stage vocabulary, and a 500-character message bound with path redaction left to the adapters); §4 adds `runner_failed` to the service's `stop_on` set (mapped to today's `solver_failed` code) and notes the batch container naming. Decisions §1, §3 and §5 are unchanged.

## Context

Paths: `M` = `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging`.

The core sequence *write case → containerised solve with one endTime extension → `run_summary.json`* is implemented four times: `OpenFoamCfdRunner.execute` (`M/cfd_job_service.py:452-605`), `run_batch` (`M/cfd_pipeline/batch.py:47-142`), `run_convergence_study` (`M/cfd_pipeline/cli.py:276-353`) and `run_aij_case_c` (`cli.py:374-443`); `cmd_run_case` (`cli.py:78-87`) writes the summary a fifth time. The service and `batch` continue it with *sample → USD overlay → run record*; `run_convergence_study` records but does not export the overlay; `run_aij_case_c` neither samples through `postprocess_case` nor records (its signature at `cli.py:374-377` takes no conversion or preprocess inputs). The artifact layout the sequence depends on lives in `cli.py`: `postprocess_case` (:99-145) knows `postProcessing/samples/<latest>/pedestrian_1p5m.vtk` and both streamline locations; `record_case` (:158-218) knows the log precedence and the sidecar names. So the production service imports a private CLI function (`cfd_job_service.py:453`), and `batch.py:70` / `cli.py:241` import each other lazily.

The copies have drifted:

- sealing: `run_preprocess` flags `sealing_suspect` at the profile limit 0.10 (`preprocess.py:144`, `profiles.py:28`) and persists it in `preprocess_stats.json`; the service recomputes it at the request limit, default 0.15 (`cfd_job_service.py:473-476`; `tests/contracts/cfd-run-request-v1.schema.json:33-39`). Two persisted documents of one run can disagree;
- `end_time`: 600 in the service, the schema default and the contract's R-A4 row; 300 in `CaseParams` (`openfoam_case.py:40`), `make-case`, `batch` and the `run-case` fallback;
- failure classification: only the service tells `mesh_failed` from `solver_failed` by the presence of `log.simpleFoam` (`cfd_job_service.py:532`); `batch` records "failed"; the CLI drivers raise. A `build_case` exception aborts the whole service run as `mesh_failed` (:509-512) while `batch` records the direction and continues; a postprocess or record exception aborts the service run (:551-552) but not `batch` (`batch.py:121-123`);
- the CLI treats a non-watertight shell (exit 2) and record validation problems (exit 5) as failures; the service never reads either. The contract names neither as a failure condition.

No test executes `OpenFoamCfdRunner.execute`, `postprocess_case`, `record_case`, `run_convergence_study` or `run_aij_case_c`: `bim-streaming-server/tests/test_cfd_job_service.py` injects `FakeCfdRunner`; `tools/cfd/tests/test_batch.py` injects fake postprocess and record functions.

The authority boundary is unchanged: the streaming host's CFD job service owns run status, queueing and results; the coordinator keeps a ledger projection ([cfd-run-workflow-adr.md](cfd-run-workflow-adr.md)). Canonical terms are defined in [`../../CONTEXT.md`](../../CONTEXT.md).

## Grilling Record

The repository owner pre-authorized the recommended answer for each question (2026-09-23).

| Question | Recommended answer (adopted) | Strongest objection | Adjudication |
|---|---|---|---|
| One module for a whole run, or for one direction case? | Three entry points in one module: `solve_case` (write case → solve → summary; the unit all four drivers share), `run_direction_case` (`solve_case` plus postprocess and record; the service and `batch`) and `run_wind_directions` (the loop with cancellation, progress and a stop policy). | Three entry points widen the interface. | Each passes the deletion test on its own (`solve_case` has four callers; the loop has two, the service and `batch`, which reach `run_direction_case` through it). Forcing convergence and AIJ through `run_direction_case` would make them fabricate conversion inputs they do not have. |
| Loop failure policy? | `run_wind_directions` takes `stop_on`, the set of outcome kinds that abort the run. The service passes `{case_write_failed, postprocess_failed}` (today's aborts); `batch` passes the empty set (today's continue). | One more parameter. | The two callers disagree today; a hidden default would silently change one of them. |
| Where does it live? | `M/cfd_pipeline/case_run.py`, importable as `cfd_pipeline.case_run` and, through the existing shim, `bimcfd.case_run`. | The package was "stages only". | The composition already lives in the package (`cli.py`); naming it is the missing piece. Preprocessing stays a separate stage function. |
| Which policies move inside? | Artifact layout, `run_summary.json`, container naming, the mesh-vs-solver rule, cancellation between stages, the one-time extension call. | Convergence and AIJ read sampled VTK themselves. | They keep their own post-steps; they stop rebuilding the case/solve/summary part. |
| Who decides `sealing_suspect`? | `run_preprocess` gains `leak_fraction_limit`; callers pass the effective limit; nothing downstream recomputes it. The profile default becomes 0.15. | Raises the CLI exit-7 threshold from 0.10 to 0.15. | The owner accepted 12% (`building-energy-cfd-p2-contract.md:17,194`); a CLI that flags 12% contradicts that ruling. |
| Which `end_time` default wins? | 600, owned by `CaseParams`; CLI defaults read the dataclass field. | Silent default change for `make-case`/`batch`. | The contract schema default and R-A4 already say 600; the CLI is the drift. README rows change in the same PR. |
| Are watertight and record validation failures? | No. They are facts on the outcome (`watertight`, `record_problems`). CLI adapters keep exit codes 2 and 5 as tool strictness; the service keeps ignoring them. | The service accepts a shell the CLI refuses. | The contract says a sealing-suspect run is still a result. Changing that is a product decision; recorded as open. |
| Which ports? | One: the case runner (`run_case_fn`; Docker adapter in production, fake in tests). Progress and `should_stop` are callbacks on the ports value. Postprocess and record are implementation. | `test_batch` injects fake postprocess/record for speed. | The untested part today is exactly the wiring into the real postprocess/record; tests run them against fixture VTK and log files. |
| Exceptions or outcomes? | A closed outcome union; adapters raise or map codes as they do today. | Convergence/AIJ callers expect exceptions. | Adapters preserve their surface; the classification becomes one rule. |
| How is "behaviour preserved" proven? | Unit suites plus one real Docker run on canonical Linux 181 with the same request before and after the service cutover. | Costly. | The production path has never run under a test; one real run is the minimum honest evidence. |

## Decision

### 1. Responsibility boundary

Introduce one deep module named **CFD Case Run** (`M/cfd_pipeline/case_run.py`). For one wind direction it owns: writing the case from the sealed shell (`build_case`), the containerised solve with at most one automatic endTime extension (`run_case_with_extension`), writing `run_summary.json`, the container name and the mesh-vs-solver failure rule (`solve_case`); and, for the service and `batch`, sampling to the USD overlay layer and wrapper stage (`postprocess_case`) plus the run record (`record_case`) on top of that (`run_direction_case`). It also owns the direction loop: iteration order, cancellation checks between stages, per-direction progress, the stop policy and the collected per-direction outcomes.

It does not own: preprocessing (`run_preprocess` stays a stage the driver calls once per run), the run-level documents (`result.json`, `run_record.json` assembly, `batch_summary.json`, convergence and AIJ documents), the job store, HTTP, Docker image preflight, or CLI parsing.

### 2. Public surface

```python
@dataclass(frozen=True, kw_only=True)
class CaseSolveSpec:
    run_id: str; tag: str; case_dir: Path; shell_stl: Path
    params: CaseParams; image: str; cpus: float | None = None
    # case_run_id = "<run_id>_<tag>" (run_id alone when tag is ""); container_name = case_run_id with "-" -> "_"

@dataclass(frozen=True, kw_only=True)
class CaseRunSpec(CaseSolveSpec):
    results_dir: Path; model_usdc: Path; conversion_dir: Path; preprocess_dir: Path
    operator: str; conversion_reference: str | None = None; source_ifc_sha256: str | None = None
    validation_level: str = "screening"; validation_evidence: Path | None = None

@dataclass(frozen=True)
class CaseRunPorts:
    run_case_fn: Callable[..., dict] = run_case          # Docker adapter; fake in tests
    on_progress: Callable[[CaseProgress], None] | None = None
    should_stop: Callable[[], bool] | None = None

def solve_case(spec: CaseSolveSpec, ports: CaseRunPorts) -> SolveOutcome: ...
def run_direction_case(spec: CaseRunSpec, ports: CaseRunPorts) -> CaseOutcome: ...
def run_wind_directions(specs: Sequence[CaseRunSpec], ports: CaseRunPorts, *, stop_on: frozenset[str]) -> list[CaseOutcome]: ...
```

`case_run_id` is `<run_id>_<tag>` (the run id alone when the tag is empty) and names the record, the overlay layer and the container. `SolveOutcome` is a closed union on `kind`, checked at construction: `solved` (case meta, run summary), `case_write_failed` (a `build_case` exception), `mesh_failed` and `solver_failed` (container exit without or with `log.simpleFoam`), `runner_failed` (the runner port raised while starting, running or polling the container, which includes a supervisor callback raising during the solve; for example no Docker binary), `cancelled`. `CaseOutcome`, returned by `run_direction_case`, is `ready` (case meta, run summary, postprocess summary, record, `record_problems`, overlay layer path), `postprocess_failed`, or one of the `SolveOutcome` failure kinds; it never carries `solved`. Failures carry the Docker exit code, the original exception and a message capped at 500 characters; redacting host paths from that message is the adapter's job (the service keeps `_bounded_error`). `ready` never hides `record_problems`.

`CaseProgress.stage` is one of `meshing` (case being written), `solving` (container running; `container` names it and `extended_to` is set for the extension pass), `solver_finished`, `postprocessing` and `direction_done` (the event carries the direction's `CaseOutcome`, so a supervisor can update per-direction counters such as `converged_count` without reading files).

`run_preprocess` gains `leak_fraction_limit: float | None = None` (`None` = profile value) and writes the effective limit and verdict into `preprocess_stats.json`.

### 3. Single sources

- `CaseParams` defaults are the only defaults. `end_time` becomes 600. `build_parser` reads the `--end-time` and other `CaseParams` defaults from the dataclass fields instead of literals, and `cmd_run_case` falls back to the same field. `validate_run_request` keeps 600 and gains a test pinning it to `CaseParams.end_time`.
- `PreprocessProfile.sealing_leak_fraction_limit` becomes 0.15; the request schema default gains a test pinning it to the profile.
- `_true_north_from_geo` becomes public `true_north_from_geo` in `cfd_pipeline/wind.py`; the service imports nothing private.
- `batch.py` no longer imports `cli`; `cli.py` holds no composition functions.

### 4. Adapters

- `OpenFoamCfdRunner.execute` becomes: preprocess → one `CaseRunSpec` per direction → `run_wind_directions(stop_on={case_write_failed, runner_failed, postprocess_failed})` → assemble `run_record.json` and the result document. Its `progress` and `is_cancelled` callbacks are wrapped into `CaseRunPorts`; `_StageFailure` and `_Cancelled` are raised from outcome kinds (`case_write_failed` keeps today's `mesh_failed` failure code; `runner_failed` keeps today's `solver_failed`, which is what the generic handler produces for an exception during `solving`).
- `run_batch` calls `run_wind_directions` with an empty `stop_on` and keeps `batch_summary.json`; it loses `postprocess_fn` and `record_fn`. Its containers gain a `--name` (today it passes none), so two batches started in the same second with overlapping directions would collide on the timestamp-only run id; the batch adapter therefore appends a random suffix to its run id, as the service's `new_run_id` already does. `run_convergence_study` and `run_aij_case_c` call `solve_case` and keep their own sampling, record and document steps and their exceptions.
- CLI exit codes are unchanged.

### 5. Incremental cutover

1. Add the module with tests: fake runner; real `postprocess_case` and `record_case` over fixture VTK and log files; cancellation between stages; `case_write_failed` versus container `mesh_failed` versus `solver_failed`; `stop_on` aborting or continuing the loop; `record_problems` carried.
2. Cut the service over; add one test composing `CfdJobService` with `OpenFoamCfdRunner(run_case_fn=fake)` so `execute` runs under test.
3. Cut `batch`, convergence and AIJ over; delete the composition functions and the lazy imports.
4. Align defaults (`end_time`, sealing limit) together with the `tools/cfd/README.md` rows and the contract's §3.1.1 example (`building-energy-cfd-p2-contract.md:71`, still `300`), as its own PR because it changes tool behaviour.

## Considered Options

- Keep four drivers and add tests to each: rejected; it tests the drift instead of removing it.
- Make `OpenFoamCfdRunner` the shared implementation and have the CLI call the service: rejected; the CLI must run without the job store or FastAPI, and `tools/cfd` reaches the package only through the `bimcfd` shim.
- One whole-run function only: rejected (Grilling Record, row 1).
- Introduce CFD Case Run: accepted.

## Consequences

### Positive

- One place for artifact layout and failure classification; the production path becomes testable with a fake runner.
- `preprocess_stats.json` and `result.json` agree on sealing; CLI and service defaults cannot drift.
- `cli.py` shrinks to parsing and exit-code mapping.

### Negative

- `make-case` and `batch` defaults change (300 → 600 steps; sealing 0.10 → 0.15), which local tool users will notice.
- The service still drops `record_problems`; adding them to the run record is a contract change left open.
- `CaseRunSpec` is wide because the call sites had that many implicit inputs.

## Verification

1. `tools/cfd`: `pytest tests -q` plus the new module tests.
2. `bim-streaming-server`: `pytest tests/test_cfd_job_service.py -q` plus the composed-runner test.
3. `tests/test_cfd_contracts.py` passes; the schema examples still pass `validate_run_request`.
4. One real `POST /api/cfd-runs` on canonical Linux 181 before and after the service cutover with the same request body; `result.json` validates against `cfd-run-result-v1.schema.json` and direction metrics match within solver noise; recorded under `docs/evidence/`.
5. `git diff --check`; `scripts/deploy.ps1` unchanged.

## Rollback

Source-level revert of the affected tracer bullet; no persisted state or schema changes. Step 4 (defaults) reverts independently.
