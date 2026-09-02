# Blip protected review brokers

This source tree contains two deliberately separate review identities:

| Source path | Identity | Allowed review events |
|---|---|---|
| `scripts/run_codex_bound_ship_gate_once.ps1` | fixed GitHub App | `COMMENT`, `REQUEST_CHANGES` |
| `scripts/run_blip_live_approve_once.ps1` | fixed GitHub User `monkey1sai-blip` | counted `APPROVE` only |

Neither wrapper merges, pushes, changes protection, resolves conversations, dismisses reviews, or writes repository contents.

## App evidence pipeline

The App wrapper uses three process phases:

1. `collect_ship_gate_packet.py` receives a single-repository installation token, performs bounded read-only PR collection, writes a strict v1 packet, and exits.
2. `codex_ship_gate.py` reads that packet with no GitHub token/App identity variables in its process. Its Codex children require the reviewed `codex-cli 0.147.0`, use a minimal environment, disable every enumerated host/connector/browser/image/skill/memory/child-agent tool feature, disable web search, and retain a read-only sandbox as defense in depth. Any model output matching the outbound DLP policy is rejected and removed before it can become an artifact. Model- and PR-controlled display text is ASCII-escaped JSON inside canonical inert Markdown code blocks.
3. `bind_ship_attestation.py` receives a new short-lived token in a new process, re-fetches base/head/files/full patch evidence, rejects drift, active Markdown, non-canonical line controls, and ambiguous or non-terminal verdicts, then writes a verified report. `post_review.py` independently repeats those body checks, exact event mapping, outbound DLP, and full PR/head-bound attestation-footer grammar before its token-bearing phase.

The collector and binder use an immutable base/head compare plus PR metadata before/after reads. `.gitmodules`, gitlinks, symlinks, binary/non-UTF-8 blobs, and incomplete immutable evidence fail closed before model or review mutation. All author-controlled prompt evidence is JSON-encoded inside one untrusted envelope; a finder or aggregate finding-capacity boundary produces HELD instead of truncation. The binder and poster require one mutually exclusive canonical verdict at the terminal boundary; SHIP additionally requires the exact canonical footer as the final body suffix. `post_review.py` repeats the fail-closed outbound DLP check before token acquisition or HTTP. A protected per-PR lock serializes the single-host App pipeline. Multi-host uniqueness is not claimed.

The mapping is fixed:

| Gate result | App event |
|---|---|
| SHIP | `COMMENT` with canonical attestation footer |
| blocking Critical/High | `REQUEST_CHANGES` |
| incomplete or uncertain after strict packet acceptance | held `COMMENT` |

The App never sends `APPROVE`, because App approval does not satisfy the required fixed-User/code-owner review.
Pre-gate collection, packet/schema, integrity, token, or tuple failures exit fail-closed without posting a review; they cannot safely claim a tuple-bound HELD result.

`-TokenHealth` is a separate PowerShell parameter set. It cannot be combined with `-PrNumber` or `-Live`, does not require or inspect Codex `auth.json`, and exits after App-token validation without starting collector, model, binder, or post children.

## Counted approval broker

`run_blip_live_approve_once.ps1` is deterministic and model-free. It accepts only the fixed repository, exact PR/base/head tuple, a permitted review mode, a unique canonical SHIP footer, passing required checks, resolved threads, exact fixed-User identity/permission, and unchanged branch protection. High-risk paths remain `human_critical` and fail closed.

Branch protection is verified from two live sources because the least-privilege write reviewer receives HTTP 404 from GitHub's admin-only legacy protection endpoint (verified 2026-09-01 across ten failed vote attempts). Only after the installed wrapper validates its protected manifest, hashes, owner identity, and ACL chain does it open `<product root>\secrets\blip-protection-admin-token.v1.txt` with an owner-only ACL check and exclusive fixed handle. The owner provisions that file with `provision_blip_protection_admin_token.ps1` (package root), which writes it with the required protected owner-only security descriptor from creation; a normally created file inherits the directory's ACEs and is rejected by the broker. The PowerShell parent uses that distinct read-only credential for bounded active-rules and legacy-protection GETs immediately before and after the approval child. It canonicalizes both responses and requires the full post-operation snapshot to equal the pre-operation snapshot. The Python child receives only the non-secret snapshot and independently cross-checks the write-visible GraphQL `refUpdateRule`; it never receives the admin credential. Missing credentials, weak ACLs, reparse paths, shared reviewer/admin values, malformed responses, or any pre/post policy drift fail closed.

The submitted body uses the distinct `ai-bim-automated-approve-only` schema and truthfully records `automated=true` plus `action=approve-only`. Trusted-host merge evidence explicitly rejects that schema: a separately authorized exact-tuple `merge` or `merge-elevated` review remains mandatory.

The broker reads a replacement reviewer credential only through its protected owner prompt during separately authorized activation/live use. Editable source and offline tests never read either real credential. A successful live call must verify GitHub response plus readback parity for review ID/URL/User/state/body/commit. Before installation, the external protected verifier resolves the namespaced `heads/main` commit, proves that the reviewed `source_commit` is an ancestor of that exact protected-main SHA, and additionally proves that the commit is the merge product of exactly one merged `main` pull request whose latest decisive fixed-reviewer review is a counted `APPROVED` bound to that pull request's exact merged head, so an admin push or temporary protection bypass cannot activate broker code that skipped the counted review; the installed manifest preserves that commit, and the broker rejects any vote whose expected PR head equals it. A candidate runtime may be activated only after its source has merged through an independent counted approval; it cannot approve the PR that introduced itself.

The shared protected HTTP helper contains no PEM/JWT/dotenv/token-printing path. The fixed App poster has no `APPROVE` event, generic bot identity, or ambient live-submit mode.

## Runtime protection

The installer publishes a manifest-bound runtime under the protected product root. Runtime code/state is read/execute-only to the sandbox with write/delete/ACL/ownership denied; Codex login state and secrets are owner-only with sandbox access denied. The installer is initial-only and never replaces an existing `v1` runtime.

Candidate output is inert data. Production construction starts only through the separately protected builder launcher and an independently authorized reviewed-manifest hash. The v3 freeze binds a reviewed-build v2 manifest and clean source commit; the candidate excludes the builder, both launchers, tests, and `invoke_protected_blip_installer.ps1`. Installation starts only through the separately protected public installer launcher in an exact fixed-PowerShell `-NoProfile -NonInteractive -File` process. The internal verifier has no bypass phase, validates manifest authority and pinned launcher/verifier/bootstrap provenance, and proves through namespaced protected-main ancestry that the reviewed source is already merged before bootstrap. The bootstrap rejects any freeze source/runtime tuple or installer command outside the reviewed contracts, and the installer records the verified source commit in the installed manifest. Test-only freezes carry `build_profile=TEST_ONLY` plus zero provenance sentinels and are rejected by both bootstrap and installer.

## Current status

Source and offline tests are present, but activation remains HELD. No live GitHub mutation, ProgramData installation, token health, or real credential operation is implied by this source tree. See the package-level [`README.md`](../README.md) for offline checks and activation gates.
