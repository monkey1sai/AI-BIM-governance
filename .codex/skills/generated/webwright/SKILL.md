---
name: webwright
description: "Skill for the Webwright area of AI-BIM-governance. 20 symbols across 1 files."
---

# Webwright

20 symbols | 1 files | Cohesion: 100%

## When to Use

- Working with code in `docs/`
- Understanding how find_repo_root, next_run_dir, write_log work
- Modifying webwright-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | find_repo_root, next_run_dir, write_log, npm_command, repo_relative (+15) |

## Entry Points

Start here when exploring this area:

- **`find_repo_root`** (Function) — `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py:20`
- **`next_run_dir`** (Function) — `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py:28`
- **`write_log`** (Function) — `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py:43`
- **`npm_command`** (Function) — `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py:49`
- **`repo_relative`** (Function) — `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py:53`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `find_repo_root` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 20 |
| `next_run_dir` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 28 |
| `write_log` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 43 |
| `npm_command` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 49 |
| `repo_relative` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 53 |
| `free_port` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 60 |
| `detect_lan_ipv4` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 66 |
| `http_json` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 93 |
| `redirect_location` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 109 |
| `wait_http` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 118 |
| `wait_participants` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 133 |
| `append_query` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 144 |
| `start_process` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 157 |
| `stop_process` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 182 |
| `session_payload` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 193 |
| `inspect_video` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 226 |
| `wait_for_video_frame` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 241 |
| `attach_page_diagnostics` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 258 |
| `run` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 275 |
| `main` | Function | `docs/evidence/fix-lan-webrtc-multi-viewer-handoff/webwright/final_script.py` | 481 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Main → Find_repo_root` | intra_community | 3 |
| `Main → Next_run_dir` | intra_community | 3 |
| `Main → Write_log` | intra_community | 3 |
| `Main → Detect_lan_ipv4` | intra_community | 3 |

## How to Explore

1. `gitnexus_context({name: "find_repo_root"})` — see callers and callees
2. `gitnexus_query({query: "webwright"})` — find related execution flows
3. Read key files listed above for implementation details
