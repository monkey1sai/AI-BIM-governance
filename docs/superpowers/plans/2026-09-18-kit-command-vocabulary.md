# Kit Command Vocabulary 單一來源（PR1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 DataChannel 指令詞彙只在 `tests/contracts/kit-datachannel-v1.schema.json` 宣告一次，viewer、coordinator、Kit 三個 runtime 改讀產出的常數檔，行為完全不變。

**Architecture:** schema 的每個 viewer→Kit request 加上 `x-kit-command` 註記，共用的 payload 值加上 `x-kit-constant`。一支只用 Node 內建模組的 generator 產出三份只含資料的檔案，全部 commit 進 repo，檔頭帶 `source-sha256`。各 runtime 既有的 owner module 在內部 import 產出檔，對外名稱與呼叫點都不動；漂移由各 runtime 自己的測試抓。

**Tech Stack:** Node ESM（generator，只用 `node:` 內建模組）、TypeScript／Vitest（viewer、coordinator）、Zod 3.25（coordinator；repo 已有 `z.enum(常數 tuple)` 寫法，例如 `src/contract/schemas/lineage.ts:115`）、Python／pytest（Kit messaging extension）、JSON Schema 2020-12。

**Spec:** `docs/architecture/kit-command-vocabulary-adr.md`（由 Task 1 建立，內容全文寫在 Task 1）。決策來源是 2026-09-18 架構審查的 grilling 共識 11 項，已全部寫進該 ADR。

## Global Constraints

- 所有修改都在 worktree `C:\Repos\active\iot\AI-BIM-governance.worktrees\kit-command-vocabulary`（branch `chore/kit-command-vocabulary`）進行；主 checkout `C:\Repos\active\iot\AI-BIM-governance` 不得有任何 tracked 修改。
- 不新增任何 npm 或 Python 依賴（AGENTS.md：「不新增未要求的抽象、依賴或設定層」）。
- PR1 行為不變：除了本計畫明列要改的測試，其他既有測試一律不改、必須照樣通過。
- 產出檔一律不手改；檔頭固定為 `GENERATED FILE - DO NOT EDIT.` 並帶 `source-sha256: <64 hex>`，雜湊對象是換行統一成 LF 後的 schema 全文。
- Kit extension 內的 import 一律用既有寫法：`try: from .x import ...` / `except ImportError: from x import ...`（Kit 以套件載入，pytest 以頂層模組載入）。
- Python 測試使用主 checkout 的 venv：`C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe`（下文簡寫為 `$py`；PowerShell 先執行 `$py = "C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe"`）。
- 每次 commit 前執行 `git diff --cached --check`，輸出必須為空。commit 訊息結尾加 `-m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`。
- push、開 PR、merge、部署都需要 owner 當下明確授權；本計畫只到本機 commit 與本機驗收，Task 8 最後一步才詢問。
- 螢幕截圖、session ID、DataChannel 紀錄只存本機 `%USERPROFILE%\.codex\visualizations\2026\09\<dd>\kit-command-vocabulary\`，不進 repo（repo 是公開的）。

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `docs/architecture/kit-command-vocabulary-adr.md` | Create | 本次決策紀錄（spec） |
| `docs/architecture/runtime-mutation-authority-adr.md` | Modify | §10 與一條被否決方案加上 superseded 註記 |
| `CONTEXT.md` | Modify | 新增 **Kit Command Vocabulary** 詞條 |
| `tests/contracts/kit-datachannel-v1.schema.json` | Modify | 16 個 request 加 `x-kit-command`；4 個欄位加 `x-kit-constant`；`rejected_event_type` 補齊 5 個指令 |
| `tests/test_kit_command_vocabulary_contract.py` | Create | schema 層的詞彙契約測試 |
| `tests/test_runtime_command_contracts.py` | Modify | 刪除讀 fixture 的 `test_mutation_authority_vocabulary_lists_camera_commands` |
| `web-viewer-sample/scripts/generate-kit-command-vocabulary.mjs` | Create | generator（純函式 + CLI） |
| `web-viewer-sample/scripts/generate-kit-command-vocabulary.test.mjs` | Create | generator 行為測試 + 三份產出全文比對 |
| `web-viewer-sample/package.json` | Modify | 新增 `generate:kit-command-vocabulary` script |
| `web-viewer-sample/src/generated/kit-command-vocabulary.ts` | Create（產出） | viewer 端資料 |
| `bim-review-coordinator/src/generated/kit-command-vocabulary.ts` | Create（產出） | coordinator 端資料 |
| `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/kit_command_vocabulary.py` | Create（產出） | Kit 端資料 |
| `web-viewer-sample/src/viewer/core/runtimeEventCatalog.ts` | Modify | 事件清單與配對改讀產出檔 |
| `web-viewer-sample/src/viewer/core/runtimeCommandProtocol.ts` | Modify | mutator 清單與拒絕原因改讀產出檔 |
| `web-viewer-sample/src/console/cameraViewBridge.ts` | Modify | camera／fly 常數改讀產出檔 |
| `bim-review-coordinator/src/services/runtimeMutationAuthority/runtimeMutationAuthority.ts` | Modify | 詞彙與 camera／fly zod 常數改讀產出檔 |
| `bim-review-coordinator/tests/kit-command-vocabulary-drift.test.ts` | Create | coordinator 產出檔 sha 比對 |
| `bim-review-coordinator/tests/services/runtimeMutationAuthority.test.ts` | Modify | fixture 測試改為讀詞彙 |
| `.../messaging/runtime_authority.py` | Modify | 5 個 set 改由產出檔建立 |
| `.../messaging/camera_view.py` | Modify | `PROJECTIONS`、`SCOPES` 改讀產出檔 |
| `.../messaging/fly_navigation.py` | Modify | `MIN_SPEED`、`MAX_SPEED` 改讀產出檔 |
| `bim-streaming-server/tests/test_kit_command_vocabulary.py` | Create | Kit 產出檔 sha 比對 + preset 覆蓋 |
| `bim-streaming-server/tests/test_runtime_command_authority.py` | Modify | 刪除 fixture 對照測試與 3 個不再使用的 import |
| `tests/contracts/runtime-mutation-authority-v1.json` | Delete | 退役 |
| `docs/contracts/streaming-datachannel-events.md` | Modify | 手抄的 mutator 清單改為指向詞彙；記錄唯讀指令也會被拒 |

`...messaging/` 指 `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/`。

---

### Task 1：記錄決策（ADR 與領域詞條）

**Files:**
- Create: `docs/architecture/kit-command-vocabulary-adr.md`
- Modify: `docs/architecture/runtime-mutation-authority-adr.md`（§10 末段之後、「Share runtime code across TypeScript and Python」段落末）
- Modify: `CONTEXT.md`（檔尾 Coordinator Browser Contract 詞條之後）

**Interfaces:**
- Consumes: 無
- Produces: 之後各 task 引用的 ADR 路徑 `docs/architecture/kit-command-vocabulary-adr.md`；註記名稱 `x-kit-command`（欄位 `mutates`、`stageLoad`、`harnessOnly`、`results`）與 `x-kit-constant`。

- [ ] **Step 1：建立 ADR**

寫入 `docs/architecture/kit-command-vocabulary-adr.md`，全文如下：

```markdown
# ADR: Kit Command Vocabulary single source

## Status

Accepted on 2026-09-18. Supersedes §10 "Mutator catalog ownership" of
[runtime-mutation-authority-adr.md](runtime-mutation-authority-adr.md) for where
the command vocabulary is declared. Runtime Mutation Authority policy is unchanged.

## Context

The viewer, the coordinator and Kit each hand-maintained the DataChannel command
vocabulary: which commands exist, which mutate the stage, which are stage-load or
harness-only, which results answer which command, the rejection reasons, and payload
values such as camera presets and the fly-speed range. A tests-only fixture
(`tests/contracts/runtime-mutation-authority-v1.json`) guarded the coordinator and Kit
lists but not the viewer, and it recorded neither result pairing nor which commands
Kit may refuse. Adding camera view, camera state and fly speed touched about 24
production files across three runtimes, and the copies had drifted: the schema's
`commandRejected.rejected_event_type` omitted five commands that Kit does refuse, and
the contract document listed eight of thirteen mutators.

## Decision

1. `tests/contracts/kit-datachannel-v1.schema.json` is the single declaration. Every
   viewer→Kit request in `$defs` carries
   `x-kit-command: { mutates, stageLoad?, harnessOnly?, results[] }`, including
   read-only commands. Kit→viewer events are the remaining `oneOf` entries. Every
   command may be refused, so `commandRejected.rejected_event_type` lists them all.
   Payload values that other code must share carry `x-kit-constant` on a string enum
   or on a number with `minimum` and `maximum`; the annotation is opt-in.
2. `web-viewer-sample/scripts/generate-kit-command-vocabulary.mjs`, using Node built-ins
   only, writes committed data-only files for the viewer, the coordinator and the Kit
   messaging extension. Each starts with `source-sha256` of the LF-normalised schema.
   It refuses a schema whose rejection enum does not list every command.
3. Each runtime's existing owner imports the generated data internally and keeps its
   public names: the viewer's `runtimeCommandProtocol.ts` and `runtimeEventCatalog.ts`,
   the coordinator's Runtime Mutation Authority, and Kit's `runtime_authority.py`.
   Generated files are implementation detail behind those owners. The mutator catalog
   stays internal Runtime Mutation Authority policy; only its values come from here.
4. Drift is caught by each runtime's own tests. Viewer Vitest compares all three
   outputs with a fresh render; coordinator Vitest and Kit pytest compare the
   `source-sha256` header with the schema.
5. `tests/contracts/runtime-mutation-authority-v1.json` is retired.

Payload validators and payload types stay hand-written in each runtime, referencing
generated constants where a value is shared.

## Alternatives rejected

- Keep the tests-only fixture and add a viewer test: drift is found after the fact,
  every command still needs one hand edit per runtime list, and pairing and
  refusability stay unrecorded.
- Declare the vocabulary in coordinator TypeScript/Zod, like the Coordinator Browser
  Contract: the coordinator owns only the authorization policy for this contract, and
  Kit would need a TypeScript → JSON → Python chain.
- Generate payload types or cross-language validators: `oneOf`, `not` and
  `unevaluatedProperties` translate inconsistently between generators, and it would
  move Runtime Mutation Authority policy out of its module.
- Load one shared file at runtime from all three runtimes: this is the deployment
  coupling the Runtime Mutation Authority ADR rejected. Committed per-runtime output
  avoids it.

## Consequences

- A new command is declared once in the schema and then regenerated with
  `cd web-viewer-sample && npm run generate:kit-command-vocabulary`. Handlers, UI and
  validators are still written by hand.
- Editing a generated file by hand fails the viewer generator test. Changing the schema
  without regenerating fails every runtime's drift test.
- `pr-safety` does not run service tests, so drift is caught by each service's targeted
  tests, as with the Coordinator Browser Contract.
```

- [ ] **Step 2：在舊 ADR 標記 superseded**

在 `docs/architecture/runtime-mutation-authority-adr.md` 的 §10 段落
「…production code does not load it, and no cross-language code generation is added.」**之後**新增一段：

```markdown
> Superseded on 2026-09-18 by [kit-command-vocabulary-adr.md](kit-command-vocabulary-adr.md):
> the vocabulary values now come from `tests/contracts/kit-datachannel-v1.schema.json`
> through committed generated files, and the tests-only fixture is retired. The catalog
> remains internal Runtime Mutation Authority policy.
```

在「### Share runtime code across TypeScript and Python」段落
「…without becoming a runtime dependency.」**之後**新增一段：

```markdown
> Still rejected. Committed generated data is not shared runtime code; see
> [kit-command-vocabulary-adr.md](kit-command-vocabulary-adr.md).
```

- [ ] **Step 3：新增 CONTEXT.md 詞條**

在 `CONTEXT.md` 檔尾（`**Coordinator Browser Contract**:` 詞條的 `_Avoid_:` 行之後）空一行後加入：

```markdown
**Kit Command Vocabulary**:
The single declaration of every command a viewer can send to Kit over the DataChannel — its name, the results Kit answers with, and whether it changes the stage — which every runtime reads instead of restating. Any command in it, read-only ones included, may be refused by Kit.
_Avoid_: mutator catalog, runtime event catalog, command list, "the DataChannel schema"
```

- [ ] **Step 4：檢查並 commit**

Run: `git diff --check`
Expected: 無輸出。

```bash
git add docs/architecture/kit-command-vocabulary-adr.md docs/architecture/runtime-mutation-authority-adr.md CONTEXT.md
git diff --cached --check
git commit -m "docs(architecture): 記錄 Kit Command Vocabulary 單一來源決策" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2：在 schema 宣告詞彙並補齊 `rejected_event_type`

**Files:**
- Create: `tests/test_kit_command_vocabulary_contract.py`
- Modify: `tests/contracts/kit-datachannel-v1.schema.json`
- Modify: `tests/test_runtime_command_contracts.py`（刪除檔尾 `test_mutation_authority_vocabulary_lists_camera_commands`）

**Interfaces:**
- Consumes: Task 1 的註記格式。
- Produces: schema 內 16 個 `x-kit-command`、4 個 `x-kit-constant`（`CAMERA_VIEW_PRESETS`、`CAMERA_VIEW_SCOPES`、`CAMERA_PROJECTIONS`、`FLY_SPEED`），以及列滿 16 個指令的 `rejected_event_type`。Task 3 的 generator 讀這些資料。

- [ ] **Step 1：寫失敗的契約測試**

建立 `tests/test_kit_command_vocabulary_contract.py`：

```python
"""Kit Command Vocabulary 的 schema 層契約（決策見 docs/architecture/kit-command-vocabulary-adr.md）。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "tests" / "contracts" / "kit-datachannel-v1.schema.json").read_text(encoding="utf-8"))
DEFS = SCHEMA["$defs"]
EVENTS = [entry["$ref"].removeprefix("#/$defs/") for entry in SCHEMA["oneOf"]]
COMMANDS = [name for name in EVENTS if "x-kit-command" in DEFS[name]]
EXPECTED_COMMANDS = {
    "openStageRequest", "loadArtifactGroupRequest", "composeStageRequest", "highlightPrimsRequest",
    "focusPrimRequest", "clearHighlightRequest", "clipPlaneRequest", "measurementRequest",
    "selectPrimsRequest", "makePrimsPickable", "resetStage", "loadingStateQuery",
    "getChildrenRequest", "cameraViewRequest", "cameraStateRequest", "flyNavigationRequest",
}


def test_every_viewer_command_is_annotated():
    assert set(COMMANDS) == EXPECTED_COMMANDS
    assert len(COMMANDS) == len(EXPECTED_COMMANDS)


def test_command_rejected_names_every_command():
    enum = DEFS["commandRejected"]["properties"]["payload"]["properties"]["rejected_event_type"]["enum"]
    assert sorted(enum) == sorted(COMMANDS)


def test_command_results_are_kit_events():
    kit_events = {name for name in EVENTS if name not in COMMANDS}
    for name in COMMANDS:
        results = DEFS[name]["x-kit-command"]["results"]
        assert results, name
        assert set(results) <= kit_events, name


def test_camera_commands_are_classified():
    assert DEFS["cameraViewRequest"]["x-kit-command"]["mutates"] is True
    assert DEFS["flyNavigationRequest"]["x-kit-command"]["mutates"] is True
    assert DEFS["cameraStateRequest"]["x-kit-command"]["mutates"] is False
    assert DEFS["cameraStateRequest"]["x-kit-command"]["results"] == ["cameraStateResult"]
```

- [ ] **Step 2：確認測試失敗**

Run: `& $py -m pytest tests/test_kit_command_vocabulary_contract.py -p no:cacheprovider -q`
Expected: 3 failed、1 passed。`COMMANDS` 為空，所以 `test_every_viewer_command_is_annotated`、`test_command_rejected_names_every_command` 失敗，`test_camera_commands_are_classified` 以 `KeyError: 'x-kit-command'` 失敗；`test_command_results_are_kit_events` 因為沒有東西可檢查而空轉通過，Step 7 會在有資料後真正生效。

- [ ] **Step 3：在 16 個 request 加上 `x-kit-command`**

每個 request 的 `$defs` 項目格式都是：

```json
    "<name>": {
      "type": "object",
```

在 `"<name>": {` 那一行之後、`"type": "object",` 之前插入一行 `      "x-kit-command": <值>,`（6 個空白縮排）。例如 `openStageRequest` 改成：

```json
    "openStageRequest": {
      "x-kit-command": { "mutates": true, "stageLoad": true, "results": ["openedStageResult"] },
      "type": "object",
```

16 個指令的值逐一如下（照抄，順序不重要）：

| `$defs` 名稱 | 插入的 `x-kit-command` 值 |
|---|---|
| `openStageRequest` | `{ "mutates": true, "stageLoad": true, "results": ["openedStageResult"] }` |
| `loadArtifactGroupRequest` | `{ "mutates": true, "stageLoad": true, "results": ["openedStageResult", "loadArtifactGroupResult", "bindingApplied"] }` |
| `composeStageRequest` | `{ "mutates": true, "harnessOnly": true, "results": ["loadArtifactGroupResult", "bindingApplied"] }` |
| `highlightPrimsRequest` | `{ "mutates": true, "results": ["highlightPrimsResult"] }` |
| `focusPrimRequest` | `{ "mutates": true, "results": ["focusPrimResult"] }` |
| `clearHighlightRequest` | `{ "mutates": true, "results": ["clearHighlightResult"] }` |
| `clipPlaneRequest` | `{ "mutates": true, "results": ["clipPlaneResult"] }` |
| `measurementRequest` | `{ "mutates": true, "results": ["measurementResult"] }` |
| `selectPrimsRequest` | `{ "mutates": true, "results": ["selectPrimsResult"] }` |
| `makePrimsPickable` | `{ "mutates": true, "results": ["makePrimsPickableResponse"] }` |
| `resetStage` | `{ "mutates": true, "results": ["resetStageResponse", "cameraFrameResult"] }` |
| `loadingStateQuery` | `{ "mutates": false, "results": ["loadingStateResponse"] }` |
| `getChildrenRequest` | `{ "mutates": false, "results": ["getChildrenResponse"] }` |
| `cameraViewRequest` | `{ "mutates": true, "results": ["cameraViewResult"] }` |
| `cameraStateRequest` | `{ "mutates": false, "results": ["cameraStateResult"] }` |
| `flyNavigationRequest` | `{ "mutates": true, "results": ["flyNavigationResult"] }` |

這些配對與現行 `web-viewer-sample/src/viewer/core/runtimeEventCatalog.ts:55-70` 的手寫表完全相同，另外補上三個唯讀指令的配對。

- [ ] **Step 4：補齊 `rejected_event_type` enum**

`commandRejected` 內原本是：

```json
                "clipPlaneRequest",
                "measurementRequest"
              ]
            },
            "reason": {
```

改成：

```json
                "clipPlaneRequest",
                "measurementRequest",
                "loadingStateQuery",
                "getChildrenRequest",
                "cameraViewRequest",
                "cameraStateRequest",
                "flyNavigationRequest"
              ]
            },
            "reason": {
```

依據（已查證）：Kit 的唯讀與 mutator handler 都先經過 `_verify_datachannel_trace`，authority 不可用時送出 `commandRejected`（`stage_management.py:529-533, 709`、`stage_loading.py:359, 791`）。

- [ ] **Step 5：加上 4 個 `x-kit-constant`**

`cameraViewRequest` 的 payload 內原本是：

```json
            "view": { "enum": ["top", "front", "back", "left", "right", "iso"] },
            "scope": { "enum": ["building", "all"] },
            "projection": { "enum": ["perspective", "orthographic"] },
```

改成（三行一起替換，因為 `projection` 那行在 `cameraState` 也出現過一次）：

```json
            "view": { "enum": ["top", "front", "back", "left", "right", "iso"], "x-kit-constant": "CAMERA_VIEW_PRESETS" },
            "scope": { "enum": ["building", "all"], "x-kit-constant": "CAMERA_VIEW_SCOPES" },
            "projection": { "enum": ["perspective", "orthographic"], "x-kit-constant": "CAMERA_PROJECTIONS" },
```

`flyNavigationRequest` 的 payload 內原本是（結尾有逗號，這是唯一一處；`flyNavigationResult` 那行結尾沒有逗號，不要動）：

```json
            "speed": { "type": "number", "minimum": 0.01, "maximum": 1000 },
```

改成：

```json
            "speed": { "type": "number", "minimum": 0.01, "maximum": 1000, "x-kit-constant": "FLY_SPEED" },
```

- [ ] **Step 6：刪除讀 fixture 的舊測試**

刪除 `tests/test_runtime_command_contracts.py` 檔尾整個函式（它讀即將退役的 fixture；`test_camera_commands_are_classified` 已取代它）：

```python
def test_mutation_authority_vocabulary_lists_camera_commands():
    fixture = json.loads((CONTRACTS / "runtime-mutation-authority-v1.json").read_text(encoding="utf-8"))
    assert {"cameraViewRequest", "flyNavigationRequest"} <= set(fixture["mutatingEventTypes"])
    assert "cameraStateRequest" in fixture["readonlyEventTypes"]
    assert "cameraStateRequest" not in fixture["mutatingEventTypes"]
```

刪完後確認檔尾只留一個換行。

- [ ] **Step 7：確認通過，且既有 schema 測試不受影響**

Run: `& $py -m pytest tests/test_kit_command_vocabulary_contract.py tests/test_runtime_command_contracts.py -p no:cacheprovider -q`
Expected: 全部 passed。`test_runtime_command_contracts.py` 會以 `Draft202012Validator.check_schema` 驗證 schema，`x-` 開頭的關鍵字必須被接受。

Run: `& $py -c "import json; json.load(open('tests/contracts/kit-datachannel-v1.schema.json', encoding='utf-8'))"`
Expected: 無輸出（JSON 合法）。

- [ ] **Step 8：Commit**

```bash
git add tests/contracts/kit-datachannel-v1.schema.json tests/test_kit_command_vocabulary_contract.py tests/test_runtime_command_contracts.py
git diff --cached --check
git commit -m "fix(contracts): 在 DataChannel schema 宣告 Kit 指令詞彙並補齊可被拒的指令" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3：generator 與三份產出檔

**Files:**
- Create: `web-viewer-sample/scripts/generate-kit-command-vocabulary.mjs`
- Create: `web-viewer-sample/scripts/generate-kit-command-vocabulary.test.mjs`
- Modify: `web-viewer-sample/package.json`（`scripts` 內 `"generate:api-types"` 之後）
- Create（由 generator 寫出）：`web-viewer-sample/src/generated/kit-command-vocabulary.ts`、`bim-review-coordinator/src/generated/kit-command-vocabulary.ts`、`.../messaging/kit_command_vocabulary.py`

**Interfaces:**
- Consumes: Task 2 的 schema 註記。
- Produces（generator 模組匯出）：`SCHEMA_RELATIVE_PATH: string`、`OUTPUTS: {relativePath, language: "ts"|"py"}[]`、`lf(text): string`、`sha256(text): string`、`buildVocabulary(schema) → {commands: {name, mutates, stageLoad, harnessOnly, results}[], kitEvents: string[], rejectionReasons: string[], constants: ({name, kind:"enum", values} | {name, kind:"range", minimum, maximum})[]}`、`renderTypeScript(vocabulary, sha): string`、`renderPython(vocabulary, sha): string`、`renderAll(): {relativePath, language, content}[]`。
- Produces（TS 產出檔匯出，Task 4、5 使用）：`KIT_COMMANDS`、`KIT_MUTATING_COMMANDS`、`KIT_READONLY_COMMANDS`、`KIT_STAGE_LOAD_COMMANDS`、`KIT_HARNESS_ONLY_COMMANDS`、`KIT_EVENTS`、`KIT_COMMAND_REJECTION_REASONS`（皆為 `readonly` 字面值 tuple）、`type KitCommand`、`type KitEvent`、`KIT_COMMAND_RESULTS: { readonly [C in KitCommand]: readonly KitEvent[] }`、`CAMERA_VIEW_PRESETS`、`CAMERA_VIEW_SCOPES`、`CAMERA_PROJECTIONS`（tuple）、`FLY_SPEED: { minimum: 0.01, maximum: 1000 }`。
- Produces（Python 產出檔，Task 6 使用）：與 TS 同名的 tuple、`KIT_COMMAND_RESULTS` dict、`CAMERA_VIEW_PRESETS`／`CAMERA_VIEW_SCOPES`／`CAMERA_PROJECTIONS` tuple、`FLY_SPEED_MINIMUM = 0.01`、`FLY_SPEED_MAXIMUM = 1000.0`。

- [ ] **Step 1：安裝 viewer 相依**

新 worktree 沒有 `node_modules`。

Run: `cd web-viewer-sample && npm ci`
Expected: exit code 0。

- [ ] **Step 2：寫失敗的 generator 測試**

建立 `web-viewer-sample/scripts/generate-kit-command-vocabulary.test.mjs`：

```js
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCHEMA_RELATIVE_PATH, buildVocabulary, lf, renderAll } from "./generate-kit-command-vocabulary.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const loadSchema = () => JSON.parse(readFileSync(path.join(repoRoot, SCHEMA_RELATIVE_PATH), "utf8"));
const names = (vocabulary, predicate) => vocabulary.commands.filter(predicate).map((command) => command.name).sort();

describe("Kit Command Vocabulary generator", () => {
  // 舊的手寫清單就是 oracle：重構前後產出的值必須一模一樣。
  it("reproduces the hand-maintained vocabulary it replaces", () => {
    const vocabulary = buildVocabulary(loadSchema());
    expect(names(vocabulary, (command) => command.mutates)).toEqual([
      "cameraViewRequest", "clearHighlightRequest", "clipPlaneRequest", "composeStageRequest",
      "flyNavigationRequest", "focusPrimRequest", "highlightPrimsRequest", "loadArtifactGroupRequest",
      "makePrimsPickable", "measurementRequest", "openStageRequest", "resetStage", "selectPrimsRequest",
    ]);
    expect(names(vocabulary, (command) => !command.mutates)).toEqual([
      "cameraStateRequest", "getChildrenRequest", "loadingStateQuery",
    ]);
    expect(names(vocabulary, (command) => command.stageLoad)).toEqual(["loadArtifactGroupRequest", "openStageRequest"]);
    expect(names(vocabulary, (command) => command.harnessOnly)).toEqual(["composeStageRequest"]);
    expect([...vocabulary.kitEvents].sort()).toEqual([
      "bindingApplied", "cameraFrameResult", "cameraStateResult", "cameraViewResult", "clearHighlightResult",
      "clipPlaneResult", "commandRejected", "flyNavigationResult", "focusPrimResult", "getChildrenResponse",
      "highlightPrimsResult", "loadArtifactGroupResult", "loadingStateResponse", "makePrimsPickableResponse",
      "measurementResult", "openedStageResult", "resetStageResponse", "selectPrimsResult",
      "stageSelectionChanged", "updateProgressActivity", "updateProgressAmount",
    ]);
    const mutatorPairs = vocabulary.commands
      .filter((command) => command.mutates)
      .flatMap((command) => command.results.map((result) => `${result}<-${command.name}`))
      .sort();
    expect(mutatorPairs).toEqual([
      "bindingApplied<-composeStageRequest", "bindingApplied<-loadArtifactGroupRequest",
      "cameraFrameResult<-resetStage", "cameraViewResult<-cameraViewRequest",
      "clearHighlightResult<-clearHighlightRequest", "clipPlaneResult<-clipPlaneRequest",
      "flyNavigationResult<-flyNavigationRequest", "focusPrimResult<-focusPrimRequest",
      "highlightPrimsResult<-highlightPrimsRequest", "loadArtifactGroupResult<-composeStageRequest",
      "loadArtifactGroupResult<-loadArtifactGroupRequest", "makePrimsPickableResponse<-makePrimsPickable",
      "measurementResult<-measurementRequest", "openedStageResult<-loadArtifactGroupRequest",
      "openedStageResult<-openStageRequest", "resetStageResponse<-resetStage",
      "selectPrimsResult<-selectPrimsRequest",
    ]);
    expect(vocabulary.rejectionReasons).toEqual([
      "spectator_readonly", "lease_invalid", "session_lifecycle_blocked",
      "unauthorized_source_client", "unsupported_command", "invalid_payload",
    ]);
    expect(vocabulary.constants).toEqual([
      { name: "CAMERA_VIEW_PRESETS", kind: "enum", values: ["top", "front", "back", "left", "right", "iso"] },
      { name: "CAMERA_VIEW_SCOPES", kind: "enum", values: ["building", "all"] },
      { name: "CAMERA_PROJECTIONS", kind: "enum", values: ["perspective", "orthographic"] },
      { name: "FLY_SPEED", kind: "range", minimum: 0.01, maximum: 1000 },
    ]);
  });

  it("records the results of read-only commands too", () => {
    const results = Object.fromEntries(buildVocabulary(loadSchema()).commands.map((command) => [command.name, command.results]));
    expect(results.cameraStateRequest).toEqual(["cameraStateResult"]);
    expect(results.loadingStateQuery).toEqual(["loadingStateResponse"]);
    expect(results.getChildrenRequest).toEqual(["getChildrenResponse"]);
  });

  it("refuses a schema whose commandRejected does not name every command", () => {
    const schema = loadSchema();
    const rejected = schema.$defs.commandRejected.properties.payload.properties.rejected_event_type;
    rejected.enum = rejected.enum.filter((name) => name !== "cameraStateRequest");
    expect(() => buildVocabulary(schema)).toThrow(/missing: cameraStateRequest/);
  });

  it("refuses an annotated command that is not listed in oneOf", () => {
    const schema = loadSchema();
    schema.oneOf = schema.oneOf.filter((entry) => entry.$ref !== "#/$defs/cameraStateRequest");
    expect(() => buildVocabulary(schema)).toThrow(/cameraStateRequest has x-kit-command but is not listed in oneOf/);
  });

  it("refuses a result that is not a Kit to viewer event", () => {
    const schema = loadSchema();
    schema.$defs.cameraViewRequest["x-kit-command"].results = ["cameraStateRequest"];
    expect(() => buildVocabulary(schema)).toThrow(/result cameraStateRequest is not a Kit→viewer event/);
  });

  it("refuses a duplicate constant name", () => {
    const schema = loadSchema();
    schema.$defs.cameraViewRequest.properties.payload.properties.action["x-kit-constant"] = "FLY_SPEED";
    expect(() => buildVocabulary(schema)).toThrow(/duplicate x-kit-constant FLY_SPEED/);
  });

  it("keeps every committed output equal to a fresh render", () => {
    for (const output of renderAll()) {
      const committed = lf(readFileSync(path.join(repoRoot, output.relativePath), "utf8"));
      expect(committed, `${output.relativePath} is stale; run: cd web-viewer-sample && npm run generate:kit-command-vocabulary`)
        .toBe(output.content);
    }
  });
});
```

- [ ] **Step 3：確認測試失敗**

Run: `cd web-viewer-sample && npx vitest run scripts/generate-kit-command-vocabulary.test.mjs`
Expected: FAIL，錯誤為找不到 `./generate-kit-command-vocabulary.mjs`。

- [ ] **Step 4：實作 generator**

建立 `web-viewer-sample/scripts/generate-kit-command-vocabulary.mjs`：

```js
#!/usr/bin/env node
// Kit Command Vocabulary：tests/contracts/kit-datachannel-v1.schema.json 的 x-kit-command／x-kit-constant
// → viewer、coordinator、Kit 三份只含資料的產出檔（入版控，runtime 不讀 schema）。
// 決策紀錄：docs/architecture/kit-command-vocabulary-adr.md
//
// 再生成：cd web-viewer-sample && npm run generate:kit-command-vocabulary
// 只檢查：cd web-viewer-sample && npm run generate:kit-command-vocabulary -- --check
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGENERATE = "cd web-viewer-sample && npm run generate:kit-command-vocabulary";
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$/;
const COMMAND_KEYS = new Set(["mutates", "stageLoad", "harnessOnly", "results"]);

export const SCHEMA_RELATIVE_PATH = "tests/contracts/kit-datachannel-v1.schema.json";
export const OUTPUTS = [
  { relativePath: "web-viewer-sample/src/generated/kit-command-vocabulary.ts", language: "ts" },
  { relativePath: "bim-review-coordinator/src/generated/kit-command-vocabulary.ts", language: "ts" },
  {
    relativePath:
      "bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/kit_command_vocabulary.py",
    language: "py",
  },
];

export const lf = (text) => text.replace(/\r\n/g, "\n");
export const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

function fail(message) {
  throw new Error(`kit-command-vocabulary: ${message}`);
}

function eventNameOf(entry) {
  const ref = entry?.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/$defs/")) {
    fail(`oneOf entry ${JSON.stringify(entry)} is not a #/$defs reference`);
  }
  return ref.slice("#/$defs/".length);
}

function readCommand(name, annotation, kitEventSet) {
  if (!annotation || typeof annotation !== "object" || Array.isArray(annotation)) {
    fail(`$defs/${name} x-kit-command must be an object`);
  }
  for (const key of Object.keys(annotation)) {
    if (!COMMAND_KEYS.has(key)) fail(`$defs/${name} x-kit-command has unknown key ${key}`);
  }
  const { mutates, stageLoad = false, harnessOnly = false, results } = annotation;
  if (typeof mutates !== "boolean" || typeof stageLoad !== "boolean" || typeof harnessOnly !== "boolean") {
    fail(`$defs/${name} x-kit-command flags must be booleans`);
  }
  if ((stageLoad || harnessOnly) && !mutates) fail(`$defs/${name} stageLoad/harnessOnly requires mutates: true`);
  if (!Array.isArray(results) || results.length === 0) fail(`$defs/${name} x-kit-command.results must be a non-empty array`);
  if (new Set(results).size !== results.length) fail(`$defs/${name} x-kit-command.results has duplicates`);
  for (const result of results) {
    if (!kitEventSet.has(result)) fail(`$defs/${name} result ${result} is not a Kit→viewer event in oneOf`);
  }
  return { name, mutates, stageLoad, harnessOnly, results: [...results] };
}

function collectConstants(node, where, out) {
  if (Array.isArray(node)) {
    node.forEach((child, index) => collectConstants(child, `${where}/${index}`, out));
    return;
  }
  if (!node || typeof node !== "object") return;
  if (Object.hasOwn(node, "x-kit-constant")) {
    const name = node["x-kit-constant"];
    if (typeof name !== "string" || !CONSTANT_NAME.test(name)) fail(`${where} x-kit-constant must be UPPER_SNAKE_CASE`);
    if (out.some((constant) => constant.name === name)) fail(`duplicate x-kit-constant ${name}`);
    if (Array.isArray(node.enum) && node.enum.length > 0 && node.enum.every((value) => typeof value === "string")) {
      out.push({ name, kind: "enum", values: [...node.enum] });
    } else if (typeof node.minimum === "number" && typeof node.maximum === "number") {
      out.push({ name, kind: "range", minimum: node.minimum, maximum: node.maximum });
    } else {
      fail(`${where} x-kit-constant ${name} must sit on a string enum or on a number with minimum and maximum`);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key !== "x-kit-constant") collectConstants(value, `${where}/${key}`, out);
  }
}

export function buildVocabulary(schema) {
  const defs = schema?.$defs;
  if (!defs || typeof defs !== "object") fail("schema has no $defs");
  if (!Array.isArray(schema.oneOf)) fail("schema has no oneOf");
  const events = schema.oneOf.map(eventNameOf);
  for (const name of events) {
    if (!Object.hasOwn(defs, name)) fail(`oneOf references missing $defs/${name}`);
    if (defs[name]?.properties?.event_type?.const !== name) fail(`$defs/${name} event_type const must equal its name`);
  }
  const eventSet = new Set(events);
  for (const [name, def] of Object.entries(defs)) {
    if (def && typeof def === "object" && Object.hasOwn(def, "x-kit-command") && !eventSet.has(name)) {
      fail(`$defs/${name} has x-kit-command but is not listed in oneOf`);
    }
  }
  const isCommand = (name) => Object.hasOwn(defs[name], "x-kit-command");
  const kitEvents = events.filter((name) => !isCommand(name));
  const kitEventSet = new Set(kitEvents);
  const commands = events.filter(isCommand).map((name) => readCommand(name, defs[name]["x-kit-command"], kitEventSet));

  const rejection = defs.commandRejected?.properties?.payload?.properties;
  const rejectedEventTypes = rejection?.rejected_event_type?.enum;
  const reasons = rejection?.reason?.enum;
  if (!Array.isArray(rejectedEventTypes)) fail("commandRejected payload.rejected_event_type.enum is missing");
  if (!Array.isArray(reasons) || reasons.length === 0) fail("commandRejected payload.reason.enum is missing");
  const commandNames = commands.map((command) => command.name);
  const missing = commandNames.filter((name) => !rejectedEventTypes.includes(name));
  const extra = rejectedEventTypes.filter((name) => !commandNames.includes(name));
  if (missing.length > 0 || extra.length > 0) {
    fail(
      "commandRejected.rejected_event_type must list every command "
        + `(missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`,
    );
  }

  const constants = [];
  collectConstants(defs, "$defs", constants);
  return { commands, kitEvents, rejectionReasons: [...reasons], constants };
}

const quote = (value) => JSON.stringify(value);
const tsList = (values) => `[${values.map(quote).join(", ")}] as const`;
const pyTuple = (values) => (values.length === 1 ? `(${quote(values[0])},)` : `(${values.map(quote).join(", ")})`);
const pyNumber = (value) => (Number.isInteger(value) ? `${value}.0` : String(value));

function lists(vocabulary) {
  const pick = (predicate) => vocabulary.commands.filter(predicate).map((command) => command.name);
  return [
    ["KIT_COMMANDS", pick(() => true)],
    ["KIT_MUTATING_COMMANDS", pick((command) => command.mutates)],
    ["KIT_READONLY_COMMANDS", pick((command) => !command.mutates)],
    ["KIT_STAGE_LOAD_COMMANDS", pick((command) => command.stageLoad)],
    ["KIT_HARNESS_ONLY_COMMANDS", pick((command) => command.harnessOnly)],
    ["KIT_EVENTS", vocabulary.kitEvents],
    ["KIT_COMMAND_REJECTION_REASONS", vocabulary.rejectionReasons],
  ];
}

function header(comment, sourceSha) {
  return [
    `${comment} GENERATED FILE - DO NOT EDIT.`,
    `${comment} Kit Command Vocabulary，由 ${SCHEMA_RELATIVE_PATH} 的 x-kit-command／x-kit-constant 生成。`,
    `${comment} 再生成：${REGENERATE}`,
    `${comment} source-sha256: ${sourceSha}`,
  ];
}

export function renderTypeScript(vocabulary, sourceSha) {
  const lines = [...header("//", sourceSha), ""];
  for (const [name, values] of lists(vocabulary)) lines.push(`export const ${name} = ${tsList(values)};`);
  lines.push(
    "export type KitCommand = (typeof KIT_COMMANDS)[number];",
    "export type KitEvent = (typeof KIT_EVENTS)[number];",
    "",
    "export const KIT_COMMAND_RESULTS: { readonly [C in KitCommand]: readonly KitEvent[] } = {",
    ...vocabulary.commands.map((command) => `  ${command.name}: ${tsList(command.results)},`),
    "};",
  );
  if (vocabulary.constants.length > 0) lines.push("");
  for (const constant of vocabulary.constants) {
    lines.push(constant.kind === "enum"
      ? `export const ${constant.name} = ${tsList(constant.values)};`
      : `export const ${constant.name} = { minimum: ${constant.minimum}, maximum: ${constant.maximum} } as const;`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderPython(vocabulary, sourceSha) {
  const lines = [
    ...header("#", sourceSha),
    '"""Kit Command Vocabulary data; see docs/architecture/kit-command-vocabulary-adr.md."""',
    "",
  ];
  for (const [name, values] of lists(vocabulary)) lines.push(`${name} = ${pyTuple(values)}`);
  lines.push(
    "",
    "KIT_COMMAND_RESULTS = {",
    ...vocabulary.commands.map((command) => `    ${quote(command.name)}: ${pyTuple(command.results)},`),
    "}",
  );
  if (vocabulary.constants.length > 0) lines.push("");
  for (const constant of vocabulary.constants) {
    if (constant.kind === "enum") {
      lines.push(`${constant.name} = ${pyTuple(constant.values)}`);
    } else {
      lines.push(`${constant.name}_MINIMUM = ${pyNumber(constant.minimum)}`, `${constant.name}_MAXIMUM = ${pyNumber(constant.maximum)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderAll() {
  const schemaText = readFileSync(path.join(repoRoot, SCHEMA_RELATIVE_PATH), "utf8");
  const sourceSha = sha256(lf(schemaText));
  const vocabulary = buildVocabulary(JSON.parse(schemaText));
  return OUTPUTS.map((output) => ({
    ...output,
    content: output.language === "ts" ? renderTypeScript(vocabulary, sourceSha) : renderPython(vocabulary, sourceSha),
  }));
}

function main(argv) {
  const check = argv.includes("--check");
  const stale = [];
  for (const output of renderAll()) {
    const target = path.join(repoRoot, output.relativePath);
    const current = existsSync(target) ? lf(readFileSync(target, "utf8")) : null;
    if (current === output.content) continue;
    if (check) {
      stale.push(output.relativePath);
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, output.content, "utf8");
    console.log(`wrote ${output.relativePath}`);
  }
  if (stale.length > 0) {
    console.error(`stale generated files:\n  ${stale.join("\n  ")}\nrun: ${REGENERATE}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
```

- [ ] **Step 5：新增 npm script**

在 `web-viewer-sample/package.json` 的 `"generate:api-types": "node scripts/generate-api-types.mjs",` 那一行之後加入：

```json
        "generate:kit-command-vocabulary": "node scripts/generate-kit-command-vocabulary.mjs",
```

- [ ] **Step 6：產生三份檔案**

Run: `cd web-viewer-sample && npm run generate:kit-command-vocabulary`
Expected: 印出三行 `wrote ...`，分別是 viewer、coordinator、Kit 的產出檔。

Run: `head -12 web-viewer-sample/src/generated/kit-command-vocabulary.ts`
Expected: 第 1 行是 `// GENERATED FILE - DO NOT EDIT.`，第 4 行是 `// source-sha256: ` 加 64 位 hex，第 6 行開頭是 `export const KIT_COMMANDS = ["openStageRequest", "loadArtifactGroupRequest", "composeStageRequest",`。

Run: `tail -7 bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/kit_command_vocabulary.py`
Expected: 7 行依序是：

```python
}

CAMERA_VIEW_PRESETS = ("top", "front", "back", "left", "right", "iso")
CAMERA_VIEW_SCOPES = ("building", "all")
CAMERA_PROJECTIONS = ("perspective", "orthographic")
FLY_SPEED_MINIMUM = 0.01
FLY_SPEED_MAXIMUM = 1000.0
```

Run: `& $py -c "import runpy; runpy.run_path(r'bim-streaming-server\source\extensions\ezplus.bim_review_stream.messaging\ezplus\bim_review_stream\messaging\kit_command_vocabulary.py')"`
Expected: 無輸出（Python 語法合法）。

- [ ] **Step 7：確認測試通過，check 模式也通過**

Run: `cd web-viewer-sample && npx vitest run scripts/generate-kit-command-vocabulary.test.mjs`
Expected: 7 passed。

Run: `cd web-viewer-sample && npm run generate:kit-command-vocabulary -- --check`
Expected: exit code 0，無輸出。

Run: `cd web-viewer-sample && npm run typecheck`
Expected: exit code 0（產出的 TS 在 strict 模式下合法；此時還沒有任何檔案 import 它）。

- [ ] **Step 8：Commit**

```bash
git add web-viewer-sample/scripts/generate-kit-command-vocabulary.mjs web-viewer-sample/scripts/generate-kit-command-vocabulary.test.mjs web-viewer-sample/package.json web-viewer-sample/src/generated/kit-command-vocabulary.ts bim-review-coordinator/src/generated/kit-command-vocabulary.ts bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/kit_command_vocabulary.py
git diff --cached --check
git commit -m "feat(contracts): 由 DataChannel schema 產生三個 runtime 的 Kit 指令詞彙" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4：viewer 的 owner 改讀產出檔

**Files:**
- Modify: `web-viewer-sample/src/viewer/core/runtimeEventCatalog.ts:12-70`
- Modify: `web-viewer-sample/src/viewer/core/runtimeCommandProtocol.ts:12-43`
- Modify: `web-viewer-sample/src/console/cameraViewBridge.ts:1-3, 25-29`
- Test（不修改，作為等價 oracle）：`web-viewer-sample/src/viewer/core/runtimeEventCatalog.test.ts`、`web-viewer-sample/src/viewer/core/runtimeCommandProtocol.test.ts`、`web-viewer-sample/src/console/cameraViewBridge.test.ts`

**Interfaces:**
- Consumes: Task 3 TS 產出檔的 `KIT_COMMANDS`、`KIT_EVENTS`、`KIT_MUTATING_COMMANDS`、`KIT_COMMAND_RESULTS`、`KIT_COMMAND_REJECTION_REASONS`、`CAMERA_VIEW_PRESETS`、`CAMERA_VIEW_SCOPES`、`CAMERA_PROJECTIONS`、`FLY_SPEED`。
- Produces: 對外名稱全部不變：`isViewerToKitEventType`、`isKitToViewerEventType`、`isRuntimeResponseForRequest`、`isSimpleRuntimeTerminalEvent`、`isRuntimeMutator`、`parseRuntimeCommandRejection`、`type RuntimeRejectionReason`、`type CameraPreset`／`CameraProjection`／`CameraScope`、`FLY_SPEED_MIN`、`FLY_SPEED_MAX`。

這個 task 是純重構：現有測試就是規格，不新增、不修改任何測試。`runtimeEventCatalog.test.ts` 會窮舉所有 response／request 組合（含 `__proto__`、`constructor`），並斷言 `isRuntimeResponseForRequest("cameraStateResult", "cameraStateRequest")` 為 false，所以新實作必須只對 mutator 回答配對，且不能用 `物件[key]` 查表。

- [ ] **Step 1：記錄重構前的基準**

Run: `cd web-viewer-sample && npx vitest run src/viewer/core src/console/cameraViewBridge.test.ts src/console/unified`
Expected: 全部 passed。記下 passed 數量，Step 5 必須相同。

- [ ] **Step 2：改寫 `runtimeEventCatalog.ts`**

保留第 1–11 行授權標頭。把第 12–70 行（`viewerToKitEventTypes`、`kitToViewerEventTypes`、`runtimeResponseRequestTypes` 三個手寫表）換成：

```ts
import { KIT_COMMANDS, KIT_COMMAND_RESULTS, KIT_EVENTS, KIT_MUTATING_COMMANDS } from "../../generated/kit-command-vocabulary";

// 指令、事件與配對都來自 Kit Command Vocabulary（schema 的 x-kit-command），不在這裡手寫。
const viewerToKitEventTypes = new Set<string>(KIT_COMMANDS);
const kitToViewerEventTypes = new Set<string>(KIT_EVENTS);
const mutatingCommands = new Set<string>(KIT_MUTATING_COMMANDS);
const commandResults = new Map<string, ReadonlySet<string>>(
    KIT_COMMANDS.map((command): [string, ReadonlySet<string>] => [command, new Set<string>(KIT_COMMAND_RESULTS[command])]),
);
```

第 72–81 行 `simpleRuntimeTerminalEvents` 保留原樣，只在它上方加一行註解：

```ts
// 「result 到了就結束」是 Window 的處理方式，不是 Kit 的承諾，所以留在 viewer 手寫。
```

把 `isRuntimeResponseForRequest` 的函式本體換成：

```ts
export function isRuntimeResponseForRequest(responseEventType: string, requestEventType: string): boolean {
    // tracker 只登記 mutator（Window.tsx 送出時以 isRuntimeMutator 把關）。唯讀指令的配對記在詞彙裡，
    // 但這個判斷仍只回答 mutator，與舊的手寫表完全相同。
    return mutatingCommands.has(requestEventType)
        && commandResults.get(requestEventType)?.has(responseEventType) === true;
}
```

`isViewerToKitEventType`、`isKitToViewerEventType`、`isSimpleRuntimeTerminalEvent` 不動。

- [ ] **Step 3：改寫 `runtimeCommandProtocol.ts`**

保留第 1–11 行授權標頭。把第 12–35 行（`runtimeMutatingEvents` 與 `runtimeRejectionReasons` 兩個手寫 Set）換成：

```ts
import { KIT_COMMAND_REJECTION_REASONS, KIT_MUTATING_COMMANDS } from "../../generated/kit-command-vocabulary";

// mutator 清單與拒絕原因來自 Kit Command Vocabulary，不在這裡手寫。
const runtimeMutatingEvents = new Set<string>(KIT_MUTATING_COMMANDS);
const runtimeRejectionReasons = new Set<RuntimeRejectionReason>(KIT_COMMAND_REJECTION_REASONS);
```

把原本的：

```ts
export type RuntimeRejectionReason =
    | "spectator_readonly"
    | "lease_invalid"
    | "session_lifecycle_blocked"
    | "unauthorized_source_client"
    | "unsupported_command"
    | "invalid_payload";
```

換成：

```ts
export type RuntimeRejectionReason = (typeof KIT_COMMAND_REJECTION_REASONS)[number];
```

其餘（`RuntimeCommandRejection`、`isRuntimeMutator`、`getPayloadString`、`parseRuntimeCommandRejection`）不動。

- [ ] **Step 4：改寫 `cameraViewBridge.ts` 的常數**

把第 1–3 行：

```ts
export type CameraPreset = "top" | "front" | "back" | "left" | "right" | "iso";
export type CameraProjection = "perspective" | "orthographic";
export type CameraScope = "building" | "all";
```

換成：

```ts
import { CAMERA_PROJECTIONS, CAMERA_VIEW_PRESETS, CAMERA_VIEW_SCOPES, FLY_SPEED } from "../generated/kit-command-vocabulary";

// 值域來自 Kit Command Vocabulary（schema 的 x-kit-constant）；PRESET_FORWARD 以 Record<CameraPreset, …> 保證每個 preset 都有方向。
export type CameraPreset = (typeof CAMERA_VIEW_PRESETS)[number];
export type CameraProjection = (typeof CAMERA_PROJECTIONS)[number];
export type CameraScope = (typeof CAMERA_VIEW_SCOPES)[number];
```

把：

```ts
export const FLY_SPEED_MIN = 0.01;
export const FLY_SPEED_MAX = 1000;
```

換成：

```ts
export const FLY_SPEED_MIN = FLY_SPEED.minimum;
export const FLY_SPEED_MAX = FLY_SPEED.maximum;
```

把：

```ts
const PROJECTIONS: CameraProjection[] = ["perspective", "orthographic"];
const SCOPES: CameraScope[] = ["building", "all"];
```

換成：

```ts
const PROJECTIONS: readonly CameraProjection[] = CAMERA_PROJECTIONS;
const SCOPES: readonly CameraScope[] = CAMERA_VIEW_SCOPES;
```

- [ ] **Step 5：確認行為不變**

Run: `cd web-viewer-sample && npx vitest run src/viewer/core src/console/cameraViewBridge.test.ts src/console/unified`
Expected: 全部 passed，數量與 Step 1 相同。

Run: `cd web-viewer-sample && npm run typecheck`
Expected: exit code 0。

Run: `cd web-viewer-sample && npx eslint src/viewer/core/runtimeEventCatalog.ts src/viewer/core/runtimeCommandProtocol.ts src/console/cameraViewBridge.ts src/generated/kit-command-vocabulary.ts --max-warnings 0`
Expected: exit code 0。

Run: `git grep -n '"flyNavigationRequest"' -- 'web-viewer-sample/src/viewer/core/*.ts' ':!*.test.ts'`
Expected: 無輸出（viewer core 的 production 檔不再手寫指令名稱；重構前這裡會列出 `runtimeCommandProtocol.ts` 與 `runtimeEventCatalog.ts` 共 3 行）。

- [ ] **Step 6：Commit**

```bash
git add web-viewer-sample/src/viewer/core/runtimeEventCatalog.ts web-viewer-sample/src/viewer/core/runtimeCommandProtocol.ts web-viewer-sample/src/console/cameraViewBridge.ts
git diff --cached --check
git commit -m "refactor(viewer): 指令清單、配對與相機常數改讀 Kit 指令詞彙" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5：coordinator 改讀產出檔

**Files:**
- Modify: `bim-review-coordinator/src/services/runtimeMutationAuthority/runtimeMutationAuthority.ts:158-187`（詞彙）、`:310-321`（camera／fly zod）
- Create: `bim-review-coordinator/tests/kit-command-vocabulary-drift.test.ts`
- Modify: `bim-review-coordinator/tests/services/runtimeMutationAuthority.test.ts:1`、`:1033-1056`、`:1077`、`:1079`、`:1088`、`:1090`、`:1098`、`:1160`

**Interfaces:**
- Consumes: Task 3 coordinator 產出檔的 `KIT_MUTATING_COMMANDS`、`KIT_READONLY_COMMANDS`、`KIT_STAGE_LOAD_COMMANDS`、`KIT_HARNESS_ONLY_COMMANDS`、`KIT_COMMAND_REJECTION_REASONS`、`CAMERA_VIEW_PRESETS`、`CAMERA_VIEW_SCOPES`、`CAMERA_PROJECTIONS`、`FLY_SPEED`。
- Produces: `RUNTIME_MUTATION_AUTHORITY_VOCABULARY` 保留原名與五個欄位（移除已無意義的 `version`）；`type RuntimeCommandRejectionReason` 不變。

- [ ] **Step 1：安裝相依並記錄基準**

Run: `cd bim-review-coordinator && npm ci && npx vitest run tests/services/runtimeMutationAuthority.test.ts tests/runtime-command-authority.test.ts`
Expected: 全部 passed。記下 passed 數量。

- [ ] **Step 2：寫 drift 測試**

建立 `bim-review-coordinator/tests/kit-command-vocabulary-drift.test.ts`：

```ts
// Kit Command Vocabulary — drift guard（決策見 docs/architecture/kit-command-vocabulary-adr.md）。
// 產出檔的 source-sha256 必須等於現行 schema（LF 正規化後）的雜湊；不需網路、不需 Python。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const lf = (text: string) => text.replace(/\r\n/g, "\n");
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const regenerate = "run: cd web-viewer-sample && npm run generate:kit-command-vocabulary";

describe("Kit Command Vocabulary drift", () => {
  it("src/generated/kit-command-vocabulary.ts was generated from the committed schema", () => {
    const schema = lf(readFileSync(path.join(repoRoot, "tests", "contracts", "kit-datachannel-v1.schema.json"), "utf8"));
    const generated = lf(readFileSync(
      path.join(repoRoot, "bim-review-coordinator", "src", "generated", "kit-command-vocabulary.ts"),
      "utf8",
    ));
    const match = /^\/\/ source-sha256: ([0-9a-f]{64})$/m.exec(generated.split("\n").slice(0, 8).join("\n"));
    expect(match, regenerate).not.toBeNull();
    expect(match?.[1], regenerate).toBe(sha256(schema));
  });
});
```

Run: `cd bim-review-coordinator && npx vitest run tests/kit-command-vocabulary-drift.test.ts`
Expected: 1 passed（Task 3 已產出）。

再做一次反向確認：在 schema 任一行尾加一個空白後重跑，Expected: FAIL 並顯示 `run: cd web-viewer-sample && npm run generate:kit-command-vocabulary`。確認後用 `git checkout -- tests/contracts/kit-datachannel-v1.schema.json` 還原，再跑一次確認 passed。

- [ ] **Step 3：改寫詞彙常數**

在 `runtimeMutationAuthority.ts` 的 import 區（其他 import 之後）加入：

```ts
import {
  CAMERA_PROJECTIONS,
  CAMERA_VIEW_PRESETS,
  CAMERA_VIEW_SCOPES,
  FLY_SPEED,
  KIT_COMMAND_REJECTION_REASONS,
  KIT_HARNESS_ONLY_COMMANDS,
  KIT_MUTATING_COMMANDS,
  KIT_READONLY_COMMANDS,
  KIT_STAGE_LOAD_COMMANDS,
} from "../../generated/kit-command-vocabulary.js";
```

把第 158–187 行（從 `/** @internal Contract-test visibility; production code must not load the JSON fixture. */` 到 `} as const;`）整段換成：

```ts
/**
 * @internal Test visibility. Values come from the Kit Command Vocabulary
 * (docs/architecture/kit-command-vocabulary-adr.md); the catalog stays internal policy of this module.
 */
export const RUNTIME_MUTATION_AUTHORITY_VOCABULARY = {
  mutatingEventTypes: KIT_MUTATING_COMMANDS,
  readonlyEventTypes: KIT_READONLY_COMMANDS,
  stageLoadEventTypes: KIT_STAGE_LOAD_COMMANDS,
  harnessOnlyEventTypes: KIT_HARNESS_ONLY_COMMANDS,
  rejectionReasons: KIT_COMMAND_REJECTION_REASONS,
} as const;
```

第 272–280 行三個 `new Set(...)` 不動。`KIT_STAGE_LOAD_COMMANDS` 的型別是 `readonly ["openStageRequest", "loadArtifactGroupRequest"]`，與 `StageBindingAttempt["eventType"]`（`StageLoadEventType`）相容。

- [ ] **Step 4：camera／fly 的 zod 改用常數**

把：

```ts
      view: z.enum(["top", "front", "back", "left", "right", "iso"]),
      scope: z.enum(["building", "all"]),
```

換成：

```ts
      view: z.enum(CAMERA_VIEW_PRESETS),
      scope: z.enum(CAMERA_VIEW_SCOPES),
```

把：

```ts
      projection: z.enum(["perspective", "orthographic"]),
```

換成：

```ts
      projection: z.enum(CAMERA_PROJECTIONS),
```

把：

```ts
  flyNavigationRequest: z.object({ speed: z.number().finite().min(0.01).max(1000) }).strict(),
```

換成：

```ts
  flyNavigationRequest: z.object({ speed: z.number().finite().min(FLY_SPEED.minimum).max(FLY_SPEED.maximum) }).strict(),
```

`resetStage` 的 `z.enum(["building", "all"])` 不動（它沒有標 `x-kit-constant`，不在本次範圍）。

- [ ] **Step 5：fixture 測試改讀詞彙**

`tests/services/runtimeMutationAuthority.test.ts` 第 1 行 `import { readFileSync } from "node:fs";` 與其後的空行刪除（檔內只有 fixture 測試用到它）。

把第 1033–1056 行（從 `it("matches the tests-only cross-language runtime mutation vocabulary fixture", () => {` 到 `.toEqual(new Set(fixture.rejectionReasons));`）換成：

```ts
  it("authorizes every command exactly as the Kit Command Vocabulary classifies it", () => {
    const vocabulary: Record<
      "mutatingEventTypes" | "readonlyEventTypes" | "stageLoadEventTypes" | "harnessOnlyEventTypes" | "rejectionReasons",
      readonly string[]
    > = RUNTIME_MUTATION_AUTHORITY_VOCABULARY;
```

同一個 `it` 內其餘 6 處 `fixture.` 改成 `vocabulary.`：原第 1077、1079、1088、1090、1098、1160 行（刪除上面幾行後行號會前移，以內容比對：`[...fixture.mutatingEventTypes]`、`of fixture.mutatingEventTypes`、`fixture.harnessOnlyEventTypes.includes`、`fixture.stageLoadEventTypes.includes`、`of fixture.readonlyEventTypes`、`new Set(fixture.rejectionReasons)`）。

Run: `git grep -n "fixture" -- bim-review-coordinator/tests/services/runtimeMutationAuthority.test.ts`
Expected: 無輸出。

- [ ] **Step 6：確認行為不變**

Run: `cd bim-review-coordinator && npx vitest run tests/services/runtimeMutationAuthority.test.ts tests/runtime-command-authority.test.ts tests/kit-command-vocabulary-drift.test.ts`
Expected: 全部 passed；前兩個檔的數量與 Step 1 相同，另外多 1 個 drift 測試。

Run: `cd bim-review-coordinator && npm run build`
Expected: exit code 0。

- [ ] **Step 7：Commit**

```bash
git add bim-review-coordinator/src/services/runtimeMutationAuthority/runtimeMutationAuthority.ts bim-review-coordinator/tests/kit-command-vocabulary-drift.test.ts bim-review-coordinator/tests/services/runtimeMutationAuthority.test.ts
git diff --cached --check
git commit -m "refactor(coordinator): Runtime Mutation Authority 目錄與相機常數改讀 Kit 指令詞彙" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6：Kit 改讀產出檔

**Files:**
- Modify: `...messaging/runtime_authority.py:12-48`
- Modify: `...messaging/camera_view.py:21-22`
- Modify: `...messaging/fly_navigation.py:8-9`
- Create: `bim-streaming-server/tests/test_kit_command_vocabulary.py`
- Modify: `bim-streaming-server/tests/test_runtime_command_authority.py:20-28`（import）、`:97-113`（刪除 fixture 測試）

**Interfaces:**
- Consumes: Task 3 Python 產出檔的 `KIT_MUTATING_COMMANDS`、`KIT_READONLY_COMMANDS`、`KIT_STAGE_LOAD_COMMANDS`、`KIT_HARNESS_ONLY_COMMANDS`、`KIT_COMMAND_REJECTION_REASONS`、`CAMERA_VIEW_SCOPES`、`CAMERA_PROJECTIONS`、`CAMERA_VIEW_PRESETS`、`FLY_SPEED_MINIMUM`、`FLY_SPEED_MAXIMUM`。
- Produces: 對外名稱不變：`MUTATING_EVENTS`、`READONLY_EVENTS`、`STAGE_LOAD_EVENTS`、`HARNESS_ONLY_EVENTS`、`REJECTION_REASONS`（仍是 `set`）、`camera_view.PROJECTIONS`、`camera_view.SCOPES`（仍是 tuple）、`fly_navigation.MIN_SPEED`、`fly_navigation.MAX_SPEED`（仍是 float）。

- [ ] **Step 1：記錄基準**

```powershell
Push-Location bim-streaming-server
& $py -m pytest tests/test_runtime_command_authority.py tests/test_camera_view.py tests/test_fly_navigation.py tests/test_stage_management_runtime_authority.py tests/test_stage_loading_stage_composition.py tests/test_measurement_runtime.py -q -p no:cacheprovider
Pop-Location
```

Expected: 全部 passed。記下數量。

- [ ] **Step 2：寫 Kit 的 drift 測試**

建立 `bim-streaming-server/tests/test_kit_command_vocabulary.py`：

```python
"""Kit Command Vocabulary drift guard（決策見 docs/architecture/kit-command-vocabulary-adr.md）。"""
import hashlib
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_DIR = (
    Path(__file__).resolve().parents[1]
    / "source"
    / "extensions"
    / "ezplus.bim_review_stream.messaging"
    / "ezplus"
    / "bim_review_stream"
    / "messaging"
)
sys.path.insert(0, str(MODULE_DIR))

import camera_view  # noqa: E402
import kit_command_vocabulary  # noqa: E402

REGENERATE = "run: cd web-viewer-sample && npm run generate:kit-command-vocabulary"


def _lf_text(path: Path) -> str:
    return path.read_bytes().decode("utf-8").replace("\r\n", "\n")


def test_generated_vocabulary_matches_committed_schema():
    schema = _lf_text(REPO_ROOT / "tests" / "contracts" / "kit-datachannel-v1.schema.json")
    header = _lf_text(MODULE_DIR / "kit_command_vocabulary.py").split("\n")[:8]
    lines = [line for line in header if line.startswith("# source-sha256: ")]
    assert lines, REGENERATE
    assert lines[0].removeprefix("# source-sha256: ") == hashlib.sha256(schema.encode("utf-8")).hexdigest(), REGENERATE


def test_every_contract_camera_preset_has_a_forward_vector():
    assert set(camera_view.PRESET_FORWARD) == set(kit_command_vocabulary.CAMERA_VIEW_PRESETS)
```

Run: `Push-Location bim-streaming-server; & $py -m pytest tests/test_kit_command_vocabulary.py -q -p no:cacheprovider; Pop-Location`
Expected: 2 passed。

- [ ] **Step 3：改寫 `runtime_authority.py`**

把第 12–48 行（`MUTATING_EVENTS = {` 到 `REJECTION_REASONS` 的 `}`）換成：

```python
try:
    from .kit_command_vocabulary import (
        KIT_COMMAND_REJECTION_REASONS,
        KIT_HARNESS_ONLY_COMMANDS,
        KIT_MUTATING_COMMANDS,
        KIT_READONLY_COMMANDS,
        KIT_STAGE_LOAD_COMMANDS,
    )
except ImportError:  # pragma: no cover - test modules import this file directly.
    from kit_command_vocabulary import (
        KIT_COMMAND_REJECTION_REASONS,
        KIT_HARNESS_ONLY_COMMANDS,
        KIT_MUTATING_COMMANDS,
        KIT_READONLY_COMMANDS,
        KIT_STAGE_LOAD_COMMANDS,
    )

# Kit Command Vocabulary（docs/architecture/kit-command-vocabulary-adr.md）；本地 set 保留 fail-fast 與 defense-in-depth。
MUTATING_EVENTS = set(KIT_MUTATING_COMMANDS)
READONLY_EVENTS = set(KIT_READONLY_COMMANDS)
STAGE_LOAD_EVENTS = set(KIT_STAGE_LOAD_COMMANDS)
HARNESS_ONLY_EVENTS = set(KIT_HARNESS_ONLY_COMMANDS)
REJECTION_REASONS = set(KIT_COMMAND_REJECTION_REASONS)
```

- [ ] **Step 4：改寫 `camera_view.py` 與 `fly_navigation.py`**

`camera_view.py` 在第 6 行 `import math` 之後加入：

```python

try:
    from .kit_command_vocabulary import CAMERA_PROJECTIONS, CAMERA_VIEW_SCOPES
except ImportError:  # pragma: no cover - test modules import this file directly.
    from kit_command_vocabulary import CAMERA_PROJECTIONS, CAMERA_VIEW_SCOPES
```

並把：

```python
PROJECTIONS = ("perspective", "orthographic")
SCOPES = ("building", "all")
```

換成：

```python
PROJECTIONS = CAMERA_PROJECTIONS
SCOPES = CAMERA_VIEW_SCOPES
```

`fly_navigation.py` 在第 2 行 `import math` 之後加入：

```python

try:
    from .kit_command_vocabulary import FLY_SPEED_MAXIMUM, FLY_SPEED_MINIMUM
except ImportError:  # pragma: no cover - test modules import this file directly.
    from kit_command_vocabulary import FLY_SPEED_MAXIMUM, FLY_SPEED_MINIMUM
```

並把：

```python
MIN_SPEED = 0.01
MAX_SPEED = 1000.0
```

換成：

```python
MIN_SPEED = FLY_SPEED_MINIMUM
MAX_SPEED = FLY_SPEED_MAXIMUM
```

- [ ] **Step 5：刪除 fixture 對照測試**

`bim-streaming-server/tests/test_runtime_command_authority.py`：刪除整個 `test_runtime_command_catalogs_match_cross_language_fixture` 函式（從 `def test_runtime_command_catalogs_match_cross_language_fixture():` 到 `assert set(fixture["rejectionReasons"]) == REJECTION_REASONS`，以及其後多出的一個空行，保持函式之間兩個空行）。

同檔的 import 區把：

```python
from runtime_authority import (  # noqa: E402
    HARNESS_ONLY_EVENTS,
    MUTATING_EVENTS,
    READONLY_EVENTS,
    REJECTION_REASONS,
    STAGE_LOAD_EVENTS,
    RuntimeAuthorityClient,
    command_rejected_payload,
)
```

換成（這三個名稱只有被刪掉的測試用到）：

```python
from runtime_authority import (  # noqa: E402
    MUTATING_EVENTS,
    READONLY_EVENTS,
    RuntimeAuthorityClient,
    command_rejected_payload,
)
```

- [ ] **Step 6：確認行為不變**

```powershell
Push-Location bim-streaming-server
& $py -m pytest tests/test_kit_command_vocabulary.py tests/test_runtime_command_authority.py tests/test_camera_view.py tests/test_fly_navigation.py tests/test_stage_management_runtime_authority.py tests/test_stage_loading_stage_composition.py tests/test_measurement_runtime.py -q -p no:cacheprovider
Pop-Location
```

Expected: 全部 passed；數量 = Step 1 − 1（刪掉的 fixture 測試）+ 2（新的 drift 測試）。

Run: `& $py -m pytest tests/test_runtime_command_contracts.py tests/test_kit_command_vocabulary_contract.py -p no:cacheprovider -q`
Expected: 全部 passed（root 契約測試也會掃 Kit 的 `dispatch_event`）。

- [ ] **Step 7：Commit**

```bash
git add bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/runtime_authority.py bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/camera_view.py bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/fly_navigation.py bim-streaming-server/tests/test_kit_command_vocabulary.py bim-streaming-server/tests/test_runtime_command_authority.py
git diff --cached --check
git commit -m "refactor(kit): runtime authority 目錄與相機、飛行常數改讀 Kit 指令詞彙" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7：退役 fixture，契約文件改指向詞彙

**Files:**
- Delete: `tests/contracts/runtime-mutation-authority-v1.json`
- Modify: `docs/contracts/streaming-datachannel-events.md:241-252`（手抄 mutator 清單）、`:259-260` 之後（唯讀指令被拒的說明）

**Interfaces:**
- Consumes: Task 5、6 已不再讀 fixture。
- Produces: repo 內沒有任何 production 或測試程式讀 `runtime-mutation-authority-v1.json`。

- [ ] **Step 1：確認已無讀取者後刪除 fixture**

Run: `git grep -n "runtime-mutation-authority-v1" -- . ":!docs/architecture" ":!docs/plans" ":!docs/superpowers" ":!docs/evidence" ":!openspec"`
Expected: 無輸出。（計畫撰寫時這裡有 3 筆，正是 Task 2、5、6 已改掉的三支測試：`tests/test_runtime_command_contracts.py`、`bim-review-coordinator/tests/services/runtimeMutationAuthority.test.ts`、`bim-streaming-server/tests/test_runtime_command_authority.py`。）若仍有任何結果，停止並回報，不要刪除。

Run: `git rm tests/contracts/runtime-mutation-authority-v1.json`

- [ ] **Step 2：契約文件改指向詞彙**

`docs/contracts/streaming-datachannel-events.md` 的「## Runtime Mutation Authority and Terminal Rejection」段，把：

````markdown
The closed production mutator catalog is:

```txt
openStageRequest
loadArtifactGroupRequest
highlightPrimsRequest
focusPrimRequest
clearHighlightRequest
selectPrimsRequest
makePrimsPickable
resetStage
```
````

換成：

```markdown
The closed production mutator catalog is every command whose `x-kit-command.mutates`
is `true` in `tests/contracts/kit-datachannel-v1.schema.json` — the Kit Command
Vocabulary (`docs/architecture/kit-command-vocabulary-adr.md`). Do not copy the list
here; regenerate the runtime constants with
`cd web-viewer-sample && npm run generate:kit-command-vocabulary`.
```

在「When a mutator is denied, Kit emits exactly one terminal event …」那段與其後的 JSON 範例**之後**、「`reason` is one of …」那段**之前**，加入：

```markdown
Read-only commands are verified the same way. When the authority cannot be reached,
Kit refuses them with the same `commandRejected` shape (`lease_invalid`,
`retryable: true`, `detail_code: authority_unavailable`), so `rejected_event_type` may
name any command in the vocabulary.
```

- [ ] **Step 3：全部相關測試再跑一次**

Run: `& $py -m pytest tests/test_runtime_command_contracts.py tests/test_kit_command_vocabulary_contract.py -p no:cacheprovider -q`
Expected: 全部 passed。

Run: `cd bim-review-coordinator && npx vitest run tests/services/runtimeMutationAuthority.test.ts tests/kit-command-vocabulary-drift.test.ts`
Expected: 全部 passed。

Run: `Push-Location bim-streaming-server; & $py -m pytest tests/test_runtime_command_authority.py tests/test_kit_command_vocabulary.py -q -p no:cacheprovider; Pop-Location`
Expected: 全部 passed。

- [ ] **Step 4：Commit**

```bash
git add docs/contracts/streaming-datachannel-events.md
git diff --cached --check
git commit -m "chore(contracts): 退役 runtime-mutation-authority fixture，契約文件改指向 Kit 指令詞彙" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8：完整檢查與本機真 Kit、真實 Chrome 驗收

**Files:** 無程式修改。證據存本機 `%USERPROFILE%\.codex\visualizations\2026\09\<dd>\kit-command-vocabulary\`，不進 repo。

**Interfaces:**
- Consumes: Task 1–7 的全部 commit。
- Produces: 驗收證據與回報；owner 授權後才 push、開 PR。

- [ ] **Step 1：deterministic 檢查（全部要跑，任何失敗都停止並分類）**

```powershell
& $py -m pytest tests -p no:cacheprovider -q
Push-Location bim-review-coordinator; npm test; npm run build; Pop-Location
Push-Location web-viewer-sample; npm test; npm run typecheck; npm run build; npm run test:session-first; npm run generate:kit-command-vocabulary -- --check; Pop-Location
Push-Location bim-streaming-server; & $py -m pytest tests/test_kit_command_vocabulary.py tests/test_runtime_command_authority.py tests/test_camera_view.py tests/test_fly_navigation.py tests/test_stage_management_runtime_authority.py tests/test_stage_loading_stage_composition.py tests/test_measurement_runtime.py tests/test_conversion_authority_api.py -q -p no:cacheprovider; Pop-Location
pwsh -NoProfile -File scripts\deploy.ps1 -DryRun
node --test .github/scripts/pr-safety.test.mjs
node .github/scripts/pr-safety.mjs --base (git merge-base HEAD origin/main) --head (git rev-parse HEAD)
```

Expected: 每一項都是 exit code 0。任何失敗先依 AGENTS 的 Failure Classification 分類（`PRODUCT_FAILURE`／`TEST_FAILURE`／`ENVIRONMENT_FAILURE`…）再處理；不要為了讓檢查通過而修改本計畫沒列的測試。

- [ ] **Step 2：確認埠可用並建置 Kit**

Run: `pwsh -NoProfile -File scripts\dev\ensure-host-native-ports-free.ps1 -DetectOnly`
Expected: exit code 0。

Run: `Get-NetTCPConnection -State Listen -LocalPort 8004,5173 -ErrorAction SilentlyContinue`
Expected: 無輸出。任一項被占用：停止並回報，不要自行結束別人的程序。

```powershell
Push-Location web-viewer-sample; npm run build:ui; Pop-Location
Push-Location bim-streaming-server; .\repo.bat build; Pop-Location
```

Expected: 兩段都是 exit code 0；`bim-streaming-server\_build\windows-x86_64\release\kit\kit.exe` 存在。

- [ ] **Step 3：以 worktree 程式碼啟動本機服務**

```powershell
$env:CONSOLE_DIST_DIR = "$PWD\web-viewer-sample\dist-ui"
$env:BIM_FILE_LIBRARY_ROOT = "C:\Repos\active\iot\AI-BIM-governance\storage"
$env:STREAMING_CONVERSION_WORK_DIR = "C:\Repos\active\iot\AI-BIM-governance"
pwsh -NoProfile -File scripts\start-all.ps1
pwsh -NoProfile -Command ". scripts/lib/kit-signaling-probe.ps1; Test-KitSignalingOffer -HostName 127.0.0.1 -Port 49100"
```

Expected: coordinator、viewer、conversion service 健康檢查顯示 `[ok   ]`；signaling probe 收到含 `m=video` 的 SDP offer。Kit extension 若因 import 失敗而沒載入，這一步或下一步會看不到畫面；此時到 `scripts\.run\bim-streaming-server.log` 搜尋 `kit_command_vocabulary` 或 `ImportError`，分類為 `PRODUCT_FAILURE` 回報。若因缺少設定而失敗，分類為 `ENVIRONMENT_FAILURE` 回報；**不要讀取或複製設定檔**。

- [ ] **Step 4：真實 Chrome 驗收（逐項截圖）**

用真實 Chrome（Claude in Chrome 擴充功能，或以 CDP 啟動的本機 Chrome；Playwright 內建 Chromium 不支援 H.264，不算證據）開啟 `http://127.0.0.1:8004/ui#a1`，選擇本機建築 IFC → 建立審查 → 啟動 3D。

| # | 操作 | 通過條件 |
|---|---|---|
| K1 | 等待 3D 畫面 | 出現模型畫面（first frame）；Viewer 摘要的畫面、指令通道、模型相符三項都就緒 |
| K2 | 視角選「上」（top preset） | 畫面改為俯視；控制項顯示已套用；DevTools 看到 `cameraViewRequest` 與對應的 `cameraViewResult` |
| K3 | 按「讀取相機」 | 顯示相機狀態；看到 `cameraStateRequest` 與 `cameraStateResult` |
| K4 | 飛行速度設為 3 | 顯示已套用；看到 `flyNavigationResult` 且 `speed` 為 3 |
| K5 | 輸入飛行速度 2000 | 顯示「請輸入 0.01 到 1000 之間的數字。」，且沒有送出 `flyNavigationRequest`（值域來自產出常數） |
| K6 | 只停掉 coordinator（`Get-NetTCPConnection -State Listen -LocalPort 8004 \| Select-Object -ExpandProperty OwningProcess -Unique \| ForEach-Object { Stop-Process -Id $_ }`，這是本 task 自己啟動的程序），再選視角「前」 | 幾秒內顯示「被拒」類的錯誤，而不是等到逾時；DevTools 看到 `commandRejected`，`rejected_event_type` 為 `cameraViewRequest`、`detail_code` 為 `authority_unavailable` |

K6 驗的是 mutator 的拒絕路徑（本 PR 改了拒絕原因的來源）。唯讀指令被拒時 UI 仍會等到逾時，這是 PR2 要修的 bug，本 PR 不驗也不修。

- [ ] **Step 5：停止服務並寫證據說明**

Run: `pwsh -NoProfile -File scripts\stop-all.ps1`

在證據目錄寫 `README.md`：branch、HEAD commit、base commit、實際執行的命令與結果、各服務埠、K1–K6 的結論與截圖檔名、未驗證項目。

- [ ] **Step 6：回報並取得 push／PR 授權**

向 owner 回報：各 task 的 commit、Step 1 每項檢查的實際結果、K1–K6 結論、未驗證項目與風險。**等 owner 明確授權後**才 push 並開 PR；PR body 依 `.github/PULL_REQUEST_TEMPLATE.md` 的七個段落撰寫，並在測試段落列出本 task 的實際命令與結果。
