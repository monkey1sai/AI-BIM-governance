---
name: repoman
description: "Skill for the Repoman area of AI-BIM-governance. 37 symbols across 3 files."
---

# Repoman

37 symbols | 3 files | Cohesion: 77%

## When to Use

- Working with code in `bim-streaming-server/`
- Understanding how get_kit_images, get_image_template_mapping, nvidia_driver_check work
- Modifying repoman-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `bim-streaming-server/tools/repoman/launch.py` | _quiet_error, get_kit_images, get_image_template_mapping, nvidia_driver_check, launch_container (+16) |
| `bim-streaming-server/tools/repoman/package.py` | _get_repo_cmd, _run_command, package_container, _in_place_replace, package_name_check (+6) |
| `bim-streaming-server/tools/repoman/repoman_bootstrapper.py` | repoman_bootstrap, _pull_optional_deps, _path_checks, _prep_cache_paths, _opt_deps_suffix |

## Entry Points

Start here when exploring this area:

- **`get_kit_images`** (Function) — `bim-streaming-server/tools/repoman/launch.py:137`
- **`get_image_template_mapping`** (Function) — `bim-streaming-server/tools/repoman/launch.py:161`
- **`nvidia_driver_check`** (Function) — `bim-streaming-server/tools/repoman/launch.py:247`
- **`launch_container`** (Function) — `bim-streaming-server/tools/repoman/launch.py:267`
- **`select_container`** (Function) — `bim-streaming-server/tools/repoman/launch.py:303`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `get_kit_images` | Function | `bim-streaming-server/tools/repoman/launch.py` | 137 |
| `get_image_template_mapping` | Function | `bim-streaming-server/tools/repoman/launch.py` | 161 |
| `nvidia_driver_check` | Function | `bim-streaming-server/tools/repoman/launch.py` | 247 |
| `launch_container` | Function | `bim-streaming-server/tools/repoman/launch.py` | 267 |
| `select_container` | Function | `bim-streaming-server/tools/repoman/launch.py` | 303 |
| `expand_package` | Function | `bim-streaming-server/tools/repoman/launch.py` | 445 |
| `run_repo_tool` | Function | `bim-streaming-server/tools/repoman/launch.py` | 554 |
| `package_container` | Function | `bim-streaming-server/tools/repoman/package.py` | 72 |
| `package_name_check` | Function | `bim-streaming-server/tools/repoman/package.py` | 216 |
| `run_repo_tool` | Function | `bim-streaming-server/tools/repoman/package.py` | 226 |
| `repoman_bootstrap` | Function | `bim-streaming-server/tools/repoman/repoman_bootstrapper.py` | 24 |
| `discover_kit_files` | Function | `bim-streaming-server/tools/repoman/package.py` | 167 |
| `select_kit` | Function | `bim-streaming-server/tools/repoman/package.py` | 193 |
| `discover_kit_files` | Function | `bim-streaming-server/tools/repoman/launch.py` | 97 |
| `add_args` | Function | `bim-streaming-server/tools/repoman/launch.py` | 488 |
| `add_package_arg` | Function | `bim-streaming-server/tools/repoman/launch.py` | 512 |
| `add_name_arg` | Function | `bim-streaming-server/tools/repoman/launch.py` | 523 |
| `setup_repo_tool` | Function | `bim-streaming-server/tools/repoman/launch.py` | 533 |
| `run_selected_image` | Function | `bim-streaming-server/tools/repoman/launch.py` | 197 |
| `launch_kit` | Function | `bim-streaming-server/tools/repoman/launch.py` | 410 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Run_repo_tool → _apps_folder` | cross_community | 4 |
| `Run_repo_tool → Discover_kit_files` | cross_community | 4 |
| `Run_repo_tool → _get_repo_cmd` | cross_community | 4 |
| `Run_repo_tool → _quiet_error` | cross_community | 4 |
| `Run_repo_tool → Next` | cross_community | 4 |
| `Run_repo_tool → _get_repo_cmd` | cross_community | 4 |
| `Run_repo_tool → _quiet_error` | intra_community | 4 |
| `Run_repo_tool → _select` | cross_community | 4 |
| `Launch_kit → _quiet_error` | cross_community | 4 |
| `Run_repo_tool → _run_command` | intra_community | 3 |

## How to Explore

1. `gitnexus_context({name: "get_kit_images"})` — see callers and callees
2. `gitnexus_query({query: "repoman"})` — find related execution flows
3. Read key files listed above for implementation details
