---
name: python-module-path
description: "Skill for the {{python_module_path}} area of AI-BIM-governance. 66 symbols across 12 files."
---

# {{python_module_path}}

66 symbols | 12 files | Cohesion: 94%

## When to Use

- Working with code in `bim-streaming-server/`
- Understanding how add_layout_menu_entry, delay_set_tooltip, process_url work
- Modifying {{python_module_path}}-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/setup.py` | _load_layout_startup, _clear_startup_scene_edits, on_startup, _set_viewport_fill_on, _setup_ui_state_changes (+11) |
| `bim-streaming-server/templates/extensions/usd_composer.setup/template/{{python_module_path}}/extension.py` | on_startup, _toggle_present, _toggle_setting, _set_defaults, __new_stage (+8) |
| `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/ui_state_manager.py` | _on_modal_setting_changed, _hide_windows, _restore_windows, destroy, __del__ (+2) |
| `bim-streaming-server/templates/extensions/usd_viewer.messaging/template/{{python_module_path}}/stage_loading.py` | _on_open_stage, process_url, open_stage, _on_stage_event_assets_loaded, _evaluate_load_status (+1) |
| `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/navigation.py` | _on_application_mode_changed, _switch_by_mode, _delay_reset_tooltip, delay_set_tooltip, _on_showtips_click |
| `bim-streaming-server/templates/extensions/usd_viewer.setup/template/{{python_module_path}}/setup.py` | _load_layout, on_startup, _delayed_layout, __open_stage |
| `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/menu_helper.py` | __init__, _menu_hook, _on_application_mode_changed, _delayed_change_layout |
| `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/tests/test.py` | test_setup_clear_startup_scene_edits, test_navigation_invalid_dict, test_menubar_helper_menu |
| `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/menubar_helper.py` | destroy, _create_camera_speed |
| `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/stage_template.py` | get_usdlux_version, new_stage |

## Entry Points

Start here when exploring this area:

- **`add_layout_menu_entry`** (Function) — `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/setup.py:350`
- **`delay_set_tooltip`** (Function) — `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/navigation.py:184`
- **`process_url`** (Function) — `bim-streaming-server/templates/extensions/usd_viewer.messaging/template/{{python_module_path}}/stage_loading.py:137`
- **`open_stage`** (Function) — `bim-streaming-server/templates/extensions/usd_viewer.messaging/template/{{python_module_path}}/stage_loading.py:169`
- **`add_layout_menu_entry`** (Function) — `bim-streaming-server/templates/extensions/usd_composer.setup/template/{{python_module_path}}/extension.py:408`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `add_layout_menu_entry` | Function | `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/setup.py` | 350 |
| `delay_set_tooltip` | Function | `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/navigation.py` | 184 |
| `process_url` | Function | `bim-streaming-server/templates/extensions/usd_viewer.messaging/template/{{python_module_path}}/stage_loading.py` | 137 |
| `open_stage` | Function | `bim-streaming-server/templates/extensions/usd_viewer.messaging/template/{{python_module_path}}/stage_loading.py` | 169 |
| `add_layout_menu_entry` | Function | `bim-streaming-server/templates/extensions/usd_composer.setup/template/{{python_module_path}}/extension.py` | 408 |
| `on_reset` | Function | `bim-streaming-server/templates/extensions/python_ui/template/{{python_module_path}}/extension.py` | 47 |
| `on_startup` | Method | `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/setup.py` | 118 |
| `test_setup_clear_startup_scene_edits` | Method | `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/tests/test.py` | 193 |
| `defer_load_layout` | Method | `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/setup.py` | 297 |
| `test_navigation_invalid_dict` | Method | `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/tests/test.py` | 154 |
| `on_startup` | Method | `bim-streaming-server/templates/extensions/usd_composer.setup/template/{{python_module_path}}/extension.py` | 52 |
| `on_startup` | Method | `bim-streaming-server/templates/extensions/usd_viewer.setup/template/{{python_module_path}}/setup.py` | 40 |
| `destroy` | Method | `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/menubar_helper.py` | 91 |
| `test_menubar_helper_menu` | Method | `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/tests/test.py` | 66 |
| `destroy` | Method | `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/ui_state_manager.py` | 41 |
| `add_settings_dependency` | Method | `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/ui_state_manager.py` | 110 |
| `add_settings_copy_dependency` | Method | `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/ui_state_manager.py` | 126 |
| `get_usdlux_version` | Method | `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/stage_template.py` | 26 |
| `new_stage` | Method | `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/stage_template.py` | 36 |
| `get_children` | Method | `bim-streaming-server/templates/extensions/usd_viewer.messaging/template/{{python_module_path}}/stage_management.py` | 93 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `On_startup → _load_layout` | cross_community | 5 |
| `On_startup → _load_layout` | cross_community | 5 |
| `On_startup → _load_layout` | intra_community | 3 |

## How to Explore

1. `gitnexus_context({name: "add_layout_menu_entry"})` — see callers and callees
2. `gitnexus_query({query: "{{python_module_path}}"})` — find related execution flows
3. Read key files listed above for implementation details
