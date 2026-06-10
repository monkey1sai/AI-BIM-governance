---
name: scripts
description: "Skill for the Scripts area of AI-BIM-governance. 30 symbols across 4 files."
---

# Scripts

30 symbols | 4 files | Cohesion: 86%

## When to Use

- Working with code in `scripts/`
- Understanding how main work
- Modifying scripts-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `scripts/verify-runtime-e2e-cdp.mjs` | CdpPage, send, evaluate, screenshot, close (+11) |
| `bim-streaming-server/scripts/inspect-usd-stage-and-quit.py` | main, _inspect_attributes, _is_small_scalar_type, _json_safe, _unique (+4) |
| `web-viewer-sample/scripts/verify-conversion-summary-card.mjs` | json, compileToCjs, loadCard |
| `web-viewer-sample/scripts/verify-session-first-contract.mjs` | readSource, loadStreamMessageModule |

## Entry Points

Start here when exploring this area:

- **`main`** (Function) — `bim-streaming-server/scripts/inspect-usd-stage-and-quit.py:19`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `main` | Function | `bim-streaming-server/scripts/inspect-usd-stage-and-quit.py` | 19 |
| `CdpPage` | Class | `scripts/verify-runtime-e2e-cdp.mjs` | 90 |
| `createPage` | Function | `scripts/verify-runtime-e2e-cdp.mjs` | 169 |
| `consoleText` | Function | `scripts/verify-runtime-e2e-cdp.mjs` | 278 |
| `isReady` | Function | `scripts/verify-runtime-e2e-cdp.mjs` | 285 |
| `waitForRuntimeReady` | Function | `scripts/verify-runtime-e2e-cdp.mjs` | 323 |
| `videoClip` | Function | `scripts/verify-runtime-e2e-cdp.mjs` | 340 |
| `zoomViewport` | Function | `scripts/verify-runtime-e2e-cdp.mjs` | 354 |
| `captureScenario` | Function | `scripts/verify-runtime-e2e-cdp.mjs` | 388 |
| `_inspect_attributes` | Function | `bim-streaming-server/scripts/inspect-usd-stage-and-quit.py` | 73 |
| `_is_small_scalar_type` | Function | `bim-streaming-server/scripts/inspect-usd-stage-and-quit.py` | 142 |
| `_json_safe` | Function | `bim-streaming-server/scripts/inspect-usd-stage-and-quit.py` | 157 |
| `_unique` | Function | `bim-streaming-server/scripts/inspect-usd-stage-and-quit.py` | 173 |
| `waitForJson` | Function | `scripts/verify-runtime-e2e-cdp.mjs` | 72 |
| `scenarioProfileDir` | Function | `scripts/verify-runtime-e2e-cdp.mjs` | 417 |
| `launchChrome` | Function | `scripts/verify-runtime-e2e-cdp.mjs` | 422 |
| `captureScenarioInDedicatedBrowser` | Function | `scripts/verify-runtime-e2e-cdp.mjs` | 441 |
| `json` | Function | `web-viewer-sample/scripts/verify-conversion-summary-card.mjs` | 142 |
| `_identifier_candidates` | Function | `bim-streaming-server/scripts/inspect-usd-stage-and-quit.py` | 92 |
| `_candidate_values` | Function | `bim-streaming-server/scripts/inspect-usd-stage-and-quit.py` | 108 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `CaptureScenarioInDedicatedBrowser → Send` | cross_community | 6 |
| `CaptureScenarioInDedicatedBrowser → Json` | cross_community | 5 |
| `CaptureScenarioInDedicatedBrowser → ConsoleText` | cross_community | 5 |
| `CaptureScenarioInDedicatedBrowser → CdpPage` | cross_community | 4 |
| `Main → _is_candidate_key` | cross_community | 3 |
| `Main → _is_small_scalar_type` | intra_community | 3 |
| `Main → _json_safe` | intra_community | 3 |
| `Main → _flatten_candidate_values` | cross_community | 3 |

## How to Explore

1. `gitnexus_context({name: "main"})` — see callers and callees
2. `gitnexus_query({query: "scripts"})` — find related execution flows
3. Read key files listed above for implementation details
