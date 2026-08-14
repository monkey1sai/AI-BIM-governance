# Protected Blip approval broker source package

Status: **ACTIVATION = HELD**.

This directory persists the review broker source and offline regression tests. It is not an installed runtime and does not authorize live GitHub mutation, ProgramData writes, or credential access.

## Capabilities represented by source

- `run_codex_bound_ship_gate_once.ps1`: GitHub App `COMMENT` / `REQUEST_CHANGES` producer. A privileged collector exits before the token-free Codex model gate starts; a new privileged binder process re-fetches and verifies base/head/files/diff before `post_review.py` may post.
- `run_blip_live_approve_once.ps1`: deterministic fixed-User broker for a counted GitHub `APPROVE`. It remains separate from all model execution and requires an exact canonical SHIP attestation.
- `-TokenHealth`: token-only health parameter set. It is incompatible with PR/live parameters, does not require or inspect Codex `auth.json`, and exits before collector, model, binder, or post processes.
- `invoke_protected_blip_candidate_builder.ps1`: separately reviewed owner-side launcher. It pins a fixed PowerShell host, itself, the builder, and an explicitly authorized reviewed-manifest hash, then starts the builder with `-NoProfile -NonInteractive` and a minimal fixed environment.
- `build_blip_candidate.ps1`: deterministic candidate builder. Production requires an exact `blip-auto-approval-reviewed-build/v2` manifest that binds a clean source commit, distinct builder-launcher/builder/installer-launcher/verifier hashes, every candidate source/runtime hash, and every executable/DLL signer. Candidate output is inert data and deliberately excludes both launchers, the external verifier, builder, and tests.
- `invoke_protected_blip_installer_launcher.ps1`: the only public owner-side installer entrypoint. It accepts only an exact fixed-host `-NoProfile -NonInteractive -File` command line, pins its own and the internal verifier bytes, clears the process environment, then executes the strict-UTF-8 verifier bytes in that same process with a fresh reference-equal capability and exact launcher context.
- `invoke_protected_blip_installer.ps1`: internal verifier source. It refuses file-based execution, requires the process-local launcher proof plus the launcher's exact OS command line, validates the reviewed v2 manifest and installer-launcher/verifier/bootstrap tuple, and forwards pinned provenance streams to the in-memory bootstrap.
- `invoke_frozen_blip_installer.ps1`: candidate inner bootstrap, executed only as verified in-memory bytes by the external verifier.
- `install_blip_auto_approval.ps1`: owner-context ProgramData installer. It accepts only a production v3 freeze whose reviewed-manifest hash and locked stream match the owner-authorized outer verifier tuple, and never updates an existing `v1` runtime in place.

## Trust boundaries

1. GitHub App evidence never emits `APPROVE`; after a strict packet is accepted, SHIP maps to `COMMENT`, blockers map to `REQUEST_CHANGES`, and model/gate uncertainty maps to held `COMMENT`. Collection, packet/schema, integrity, token, or tuple failures abort without any GitHub mutation.
2. Counted `APPROVE` is a fixed GitHub User review, deterministic and model-free.
3. Candidate files cannot certify themselves. A separately reviewed manifest and protected launchers authorize the exact builder/source/runtime and installer-entrypoint provenance; the external verifier independently rechecks bootstrap authority, and the trusted bootstrap requires every freeze source/runtime hash to equal the reviewed manifest. The candidate contains neither launcher nor external verifier.
4. Token-bearing Python children are limited to collector, binder, and poster. The model-gate Python process receives no GitHub token/App identity environment variables.
5. Tests use synthetic tokens/keys and local fixtures only. Live GitHub mutation, real credential access, and ProgramData installation are outside the test contract.

The protected build/install schemas intentionally use fixed inventories. The offline suite compares these values independently across builder, verifier, and bootstrap source:

| Contract | Exact size |
|---|---:|
| reviewed-build v2 top-level fields | 9 |
| candidate source files | 12 |
| runtime inputs | 15 |
| runtime executable/DLL signers | 10 |
| candidate-freeze v3 fields | 7 |
| launcher-context v1 fields | 15 |
| internal verifier parameters | 8 |
| root-loader v4 fields | 17 |
| bootstrap-context v3 fields | 19 |

## Offline verification

Run from the repository root:

```powershell
& 'C:\Program Files\Python312\python.exe' -I -S -B scripts\agent-tooling\blip-approve\bot\scripts\test_ship_gate_packet.py
& 'C:\Program Files\Python312\python.exe' -I -S -B scripts\agent-tooling\blip-approve\bot\scripts\test_collect_ship_gate_packet.py
& 'C:\Program Files\Python312\python.exe' -I -S -B scripts\agent-tooling\blip-approve\bot\scripts\test_codex_ship_gate.py
& 'C:\Program Files\Python312\python.exe' -I -S -B scripts\agent-tooling\blip-approve\bot\scripts\test_bind_ship_attestation.py
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -NonInteractive -File scripts\agent-tooling\blip-approve\bot\scripts\test_run_codex_bound_ship_gate_once.ps1 -SafeOnly
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -NonInteractive -File scripts\agent-tooling\blip-approve\test_build_blip_candidate.ps1
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -NonInteractive -File scripts\agent-tooling\blip-approve\test_invoke_frozen_blip_installer.ps1 -SafeOnly
```

The full ACL/owner-context suites remain separate because they exercise identity and filesystem protection boundaries. They must not be run while credential access or ProgramData activity is prohibited.

## Activation gate

Activation remains HELD until a separate request explicitly authorizes all applicable operations: independent clean-commit source/runtime manifest review, protected builder-launcher publication, owner-context production candidate build/audit, protected installer-launcher/verifier publication, ProgramData installation, owner-provided GitHub App key/Codex login/reviewer credential handling, token-only health, and finally a named live PR mutation. Production build/install callers must supply the independently recorded reviewed-manifest SHA-256 and distinct installer-launcher/verifier hashes; builder stdout is not an approval authority. Source persistence alone grants none of those capabilities.
