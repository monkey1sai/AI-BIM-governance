# ADR: Deepen CFD Case Run

## Status

Proposed on 2026-09-23 from the architecture review of the same date. The repository owner pre-authorized the recommended answer to every question in the Grilling Record. Accepted when this document merges to `main`; implementation follows the tracer bullets in §5.

Relates to `docs/plans/building-energy-cfd-p2-contract.md` (S1, S5b, R-A4). No `cfd-run-*` contract schema changes.

## Context

Paths: `M` = `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging`.

The sequence *write case → containerised solve with one endTime extension → `run_summary.json` → sample → USD overlay → run record* is implemented four times: `OpenFoamCfdRunner.execute` (`M/cfd_job_service.py:452-605`), `run_batch` (`M/cfd_pipeline/batch.py:47-142`), `run_convergence_study` (`M/cfd_pipeline/cli.py:276-353`) and `run_aij_case_c` (`cli.py:374-443`); `cmd_run_case` (`cli.py:78-87`) writes the summary a fifth time. The artifact layout the sequence depends on lives in `cli.py`: `postprocess_case` (:99-145) knows `postProcessing/samples/<latest>/pedestrian_1p5m.vtk` and both streamline locations; `record_case` (:158-218) knows the log precedence and the sidecar names. So the production service imports a private CLI function (`cfd_job_service.py:453`), and `batch.py:70` / `cli.py:241` import each other lazily.

The copies have drifted:

- sealing: `run_preprocess` flags `sealing_suspect` at the profile limit 0.10 (`preprocess.py:144`, `profiles.py:28`) and persists it in `preprocess_stats.json`; the service recomputes it at the request limit, default 0.15 (`cfd_job_service.py:473-476`; `tests/contracts/cfd-run-request-v1.schema.json:33-39`). Two persisted documents of one run can disagree;
- `end_time`: 600 in the service, the schema default and the contract's R-A4 row; 300 in `CaseParams` (`openfoam_case.py:40`), `make-case`, `batch` and the `run-case` fallback;
- failure classification: only the service tells `mesh_failed` from `solver_failed` by the presence of `log.simpleFoam` (`cfd_job_service.py:532`); `batch` records "failed"; the CLI drivers raise;
- the CLI treats a non-watertight shell (exit 2) and record validation problems (exit 5) as failures; the service never reads either. The contract names neither as a failure condition.

No test executes `OpenFoamCfdRunner.execute`, `postprocess_case`, `record_case`, `run_convergence_study` or `run_aij_case_c`: `bim-streaming-server/tests/test_cfd_job_service.py` injects `FakeCfdRunner`; `tools/cfd/tests/test_batch.py` injects fake postprocess and record functions.

The authority boundary is unchanged: the streaming host's CFD job service owns run status, queueing and results; the coordinator keeps a ledger projection ([cfd-run-workflow-adr.md](cfd-run-workflow-adr.md)). Canonical terms are defined in [`../../CONTEXT.md`](../../CONTEXT.md).

## Grilling Record

The repository owner pre-authorized the recommended answer for each question (2026-09-23).

| Question | Recommended answer (adopted) | Strongest objection | Adjudication |
|---|---|---|---|
| One module for a whole run, or for one direction case? | Both in one module: `run_direction_case` (the unit all four drivers share) and `run_wind_directions` (the loop with cancellation and progress, shared by the service and `batch`). | Two entry points widen the interface. | Each passes the deletion test on its own (four and two callers). A single whole-run function would force the single-case drivers (convergence, AIJ) around it. |
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

Introduce one deep module named **CFD Case Run** (`M/cfd_pipeline/case_run.py`). For one wind direction it owns: writing the case from the sealed shell (`build_case`), the containerised solve with at most one automatic endTime extension (`run_case_with_extension`), writing `run_summary.json`, the container name, the mesh-vs-solver failure rule, sampling to the USD overlay layer and wrapper stage (`postprocess_case`), the run record (`record_case`), and the closed outcome. It also owns the direction loop: iteration order, cancellation checks between stages, per-direction progress and the collected per-direction records.

It does not own: preprocessing (`run_preprocess` stays a stage the driver calls once per run), the run-level documents (`result.json`, `run_record.json` assembly, `batch_summary.json`, convergence and AIJ documents), the job store, HTTP, Docker image preflight, or CLI parsing.

### 2. Public surface

```python
@dataclass(frozen=True)
class CaseRunSpec:
    run_id: str; tag: str; case_dir: Path; results_dir: Path
    params: CaseParams; image: str; cpus: float | None
    model_usdc: Path; conversion_dir: Path; preprocess_dir: Path
    operator: str; conversion_reference: str | None; source_ifc_sha256: str | None
    validation_level: str = "screening"; validation_evidence: Path | None = None

@dataclass(frozen=True)
class CaseRunPorts:
    run_case_fn: Callable[..., dict] = run_case          # Docker adapter; fake in tests
    on_progress: Callable[[CaseProgress], None] | None = None
    should_stop: Callable[[], bool] | None = None

def run_direction_case(spec: CaseRunSpec, ports: CaseRunPorts) -> CaseOutcome: ...
def run_wind_directions(specs: Sequence[CaseRunSpec], ports: CaseRunPorts) -> list[CaseOutcome]: ...
```

`CaseOutcome` is a closed union on `kind`: `ready` (case meta, run summary, postprocess summary, record, `record_problems`, overlay layer path), `mesh_failed`, `solver_failed`, `postprocess_failed`, `cancelled`. Failures carry the Docker exit code and a bounded message. `ready` never hides `record_problems`.

`run_preprocess` gains `leak_fraction_limit: float | None = None` (`None` = profile value) and writes the effective limit and verdict into `preprocess_stats.json`.

### 3. Single sources

- `CaseParams` defaults are the only defaults. `end_time` becomes 600. `cmd_make_case`, `cmd_batch`, `cmd_converge`, `cmd_aij_case_c` and `cmd_run_case` take defaults from the dataclass fields. `validate_run_request` keeps 600 and gains a test pinning it to `CaseParams.end_time`.
- `PreprocessProfile.sealing_leak_fraction_limit` becomes 0.15; the request schema default gains a test pinning it to the profile.
- `_true_north_from_geo` becomes public `true_north_from_geo` in `cfd_pipeline/wind.py`; the service imports nothing private.
- `batch.py` no longer imports `cli`; `cli.py` holds no composition functions.

### 4. Adapters

- `OpenFoamCfdRunner.execute` becomes: preprocess → one `CaseRunSpec` per direction → `run_wind_directions` → assemble `run_record.json` and the result document. Its `progress` and `is_cancelled` callbacks are wrapped into `CaseRunPorts`; `_StageFailure` and `_Cancelled` are raised from outcome kinds.
- `run_batch`, `run_convergence_study` and `run_aij_case_c` call `run_direction_case` (or the loop) and keep their documents and exceptions. `run_batch` loses `postprocess_fn` and `record_fn`.
- CLI exit codes are unchanged.

### 5. Incremental cutover

1. Add the module with tests: fake runner; real `postprocess_case` and `record_case` over fixture VTK and log files; cancellation between stages; the mesh-vs-solver rule; `record_problems` carried.
2. Cut the service over; add one test composing `CfdJobService` with `OpenFoamCfdRunner(run_case_fn=fake)` so `execute` runs under test.
3. Cut `batch`, convergence and AIJ over; delete the composition functions and the lazy imports.
4. Align defaults (`end_time`, sealing limit) with README updates, as its own PR because it changes tool behaviour.

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
