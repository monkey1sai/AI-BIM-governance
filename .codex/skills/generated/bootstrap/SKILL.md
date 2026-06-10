---
name: bootstrap
description: "Skill for the Bootstrap area of AI-BIM-governance. 9 symbols across 1 files."
---

# Bootstrap

9 symbols | 1 files | Cohesion: 100%

## When to Use

- Working with code in `bim-streaming-server/`
- Understanding how rename_folder, call_with_retry, rename_folder_with_retry work
- Modifying bootstrap-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `bim-streaming-server/tools/packman/bootstrap/install_package.py` | get_temp_folder_path, promote_and_rename, rename_folder, call_with_retry, rename_folder_with_retry (+4) |

## Entry Points

Start here when exploring this area:

- **`rename_folder`** (Function) — `bim-streaming-server/tools/packman/bootstrap/install_package.py:86`
- **`call_with_retry`** (Function) — `bim-streaming-server/tools/packman/bootstrap/install_package.py:101`
- **`rename_folder_with_retry`** (Function) — `bim-streaming-server/tools/packman/bootstrap/install_package.py:123`
- **`generate_sha256_for_file`** (Function) — `bim-streaming-server/tools/packman/bootstrap/install_package.py:133`
- **`install_common_module`** (Function) — `bim-streaming-server/tools/packman/bootstrap/install_package.py:143`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `rename_folder` | Function | `bim-streaming-server/tools/packman/bootstrap/install_package.py` | 86 |
| `call_with_retry` | Function | `bim-streaming-server/tools/packman/bootstrap/install_package.py` | 101 |
| `rename_folder_with_retry` | Function | `bim-streaming-server/tools/packman/bootstrap/install_package.py` | 123 |
| `generate_sha256_for_file` | Function | `bim-streaming-server/tools/packman/bootstrap/install_package.py` | 133 |
| `install_common_module` | Function | `bim-streaming-server/tools/packman/bootstrap/install_package.py` | 143 |
| `remove_directory_item` | Function | `bim-streaming-server/tools/packman/bootstrap/install_package.py` | 32 |
| `get_temp_folder_path` | Method | `bim-streaming-server/tools/packman/bootstrap/install_package.py` | 71 |
| `promote_and_rename` | Method | `bim-streaming-server/tools/packman/bootstrap/install_package.py` | 75 |
| `__exit__` | Method | `bim-streaming-server/tools/packman/bootstrap/install_package.py` | 79 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Install_common_module → Promote_and_rename` | intra_community | 4 |
| `Install_common_module → Get_temp_folder_path` | intra_community | 3 |
| `Install_common_module → Call_with_retry` | intra_community | 3 |

## How to Explore

1. `gitnexus_context({name: "rename_folder"})` — see callers and callees
2. `gitnexus_query({query: "bootstrap"})` — find related execution flows
3. Read key files listed above for implementation details
