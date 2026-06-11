# A2 Version Diff File-Library Selector + 三層版本目錄 Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 讓 `#/a2`（VersionDiffPage）能從檔案庫的版本目錄選 base/target 兩個 IFC 跑真差異，並讓 file_library 掃描支援第三層版本目錄（`{project}/{model}/{versionDir}/*.ifc`，如松風庵 `建築/v1/japanese_villa.ifc`）。

**Architecture:** 後端 governance-service `file_library/api.py` 的 `_list_versions` 擴充為「先收兩層直屬 `.ifc`，再下探一層 versionDir 收 `name="{versionDir}/{filename}"` 的三層 `.ifc`」，`GET /api/files/tree` 形狀不變（只是 version.name 多一種樣式）。前端 `VersionDiffPage` 複用 A1（`IssuesRuleCenterPage`）已驗證的「project→model→version 三層 `<select>` + 受控 input + graceful degradation」模式，做 base / target 各一組，選定即填路徑並帶出 `base_model_version_id` / `target_model_version_id` 隨既有 `createDiff` 送出。`DiffRequest` 型別與 `governanceClient.createDiff` 已內建這兩個欄位，前端型別層零變動。

**Tech Stack:** Python 3.12 + FastAPI（governance-service，純 CPU、`.venv\Scripts\python.exe` 跑 pytest）；React 18 + TypeScript + Vite（web-viewer-sample，vitest 用 `renderToString` / `createRoot`）；Playwright（`web-viewer-sample/e2e/`，打 coordinator `:8004/ui` 的 build:ui dist-ui）。

---

## 背景：執行者零脈絡導航（先讀這段，務必照精確路徑）

工作根目錄（worktree）：`C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector`

權威來源檔（GitNexus + Read 已確認，請在動手前各 Read 一次對應段落）：

- **後端掃描**：`governance-service/file_library/api.py`
  - `_list_versions(model_dir, root_real)`（L79-104）：目前只掃 model_dir 直屬 `.ifc`，回 `{name,path,size_bytes,mtime}` list，末尾 `versions.sort(key=lambda v: _version_sort_key(v["name"]))`。**這是本輪後端唯一要改的 function。**
  - `files_tree()`（L107-143）：組 project→model→version 樹；對每個 model_entry 呼 `_list_versions(model_entry.path, root_real)`，`if versions:` 才收。**不需改。**
  - helper：`_is_within`（L48-51）、`_iter_dir`（L70-77）、`_natural_key`（L55-56）、`_version_sort_key`（L59-62，`竣工` 排最後）、`_iso_mtime`（L65-67）。三層掃描沿用同一組 helper。
- **後端測試**：`governance-service/tests/test_file_library.py`
  - `_make_tree(root)`（L41-65）：造兩層 fixture（`270/機電`、`889/水電` 等），已含「三層 `extra/deep.ifc` 不入樹」的舊規則（L54-56，**本輪要改成第四層才忽略**）、保留目錄（`ifc-cache`/`coordinator`）。
  - `client` fixture（L68-78）：tmp root + `importlib.reload(app)`。新測試沿用。
- **前端頁面**：`web-viewer-sample/src/console/pages.tsx`
  - `IssuesRuleCenterPage`（L545-...）：**A1 檔案庫選擇器的權威範本**。state L556-562、`loadFsTree` L565-573、`resetVersionPick` L582-587、`fsModels`/`fsVersions` 衍生 L589-590、三層 `<select>` JSX L647-688（testid `a1-fs-project`/`a1-fs-model`/`a1-fs-version`，受控 `value=`，`disabled` 連鎖，graceful degradation 文案 L636-643）。
  - `VersionDiffPage`（L915-1028）：**本輪前端要改的頁面**。state L916-925、`run` callback L927-948（內含 `createDiff({ base_ifc_path, target_ifc_path, include_geometry })`）、JSX 兩個手填 `<input>` L960-961、counts 卡 L970-979。
- **前端 client**：`web-viewer-sample/src/console/governanceClient.ts`
  - `filesTree()`（L62）、`createDiff(req: DiffRequest)`（L94-98，已送 `body: JSON.stringify(req)`）。
  - `interface DiffRequest`（L175-181）**已含** `base_model_version_id?` / `target_model_version_id?` / `include_geometry?` — **本檔零變動**。
  - 型別樹 `FileVersionRow`/`FileModelRow`/`FileProjectRow`/`FilesTreeResponse`（L250-268）— 零變動。
- **前端測試**：`web-viewer-sample/src/console/console.test.tsx`
  - imports L7-32（已 import `VersionDiffPage`、`governanceClient`、`FilesTreeResponse`）。
  - 既有 A2 smoke `it("A2 補 apply-overlay…")` L68-...（renderToString）。
  - 既有 A1 selector client-render describe block L479-...（`VER_PATH` L481、`tree: FilesTreeResponse` fixture L482-..., data-binding 測試 L581-629、graceful degrade L634-665、受控持值 L670-...）。**A2 新測試比照這組寫。**
- **E2E 範本**：`web-viewer-sample/e2e/minio-fileserver-source.spec.ts`（守門 skip-gate 檔頭 L1-31、`beforeEach` 兩道 conditional skip L36-68、選擇器互動 `selectOption` + 受控 input `toHaveValue` + live scoreboard 硬 gate L91-129）。
- **route**：`web-viewer-sample/src/console/EdgeConsole.tsx` L56 `case "a2": return <VersionDiffPage />`（亦 L77 `case "version-diff"`）。E2E 用 `page.goto(.../ui/#/a2)`。

真實 fixture（已確認存在於主工作區 `storage/`，gitignored）：

- `storage/270/機電/ver 000001.ifc`（8155 bytes）、`ver 竣工.ifc`（22618 bytes）— A2 E2E 的 base/target。
- `storage/松風庵/建築/v1/japanese_villa.ifc`（三層，project=松風庵 / model=建築 / versionDir=v1）— 三層支援的 user-facing 證明。`松風庵/建築/version-info.md`、`松風庵/松風庵_聯合模型.blend`、`松風庵/建築/building-info.md` 為非 `.ifc`，既有規則本就不入樹。

GitNexus 紀律：本輪**修改的既有 symbol 僅 `_list_versions`（後端）與 `VersionDiffPage`（前端）**。動手前對 `_list_versions` 跑一次 `mcp__gitnexus__impact`，commit 前跑 `mcp__gitnexus__detect_changes`；HIGH/CRITICAL 先回報。

---

## Task 0: 後端三層版本目錄掃描（_list_versions 擴充）

修改 `_list_versions`：在現有「掃 model_dir 直屬 `.ifc`」之後，對 model_dir 下的**子目錄（versionDir）**再下探一層收 `.ifc`，三層檔 `name = f"{versionDir.name}/{filename}"`，第四層以下忽略。兩層行為與輸出完全不變。

**Files:**
- Modify: `C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\governance-service\file_library\api.py`（`_list_versions`，L79-104）
- Test: `C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\governance-service\tests\test_file_library.py`（先在 Task 1 寫；本 Task 先確認既有測試綠）

**Steps:**

- [ ] GitNexus impact（動 symbol 前必跑）。預期：`_list_versions` callers 僅 `files_tree`，risk LOW（單一內部 caller、回傳形狀不變）。
  ```
  mcp__gitnexus__impact  name="_list_versions"  repo="AI-BIM-governance"  file_path="governance-service/file_library/api.py"
  ```
  預期輸出：impacted 列出 `files_tree`；無跨服務 caller。若回 HIGH/CRITICAL 先停下回報。

- [ ] 跑既有後端測試拿 baseline（改之前先量）。
  ```powershell
  & "C:\Program Files\Python312\python.exe" -m pytest "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\governance-service\tests\test_file_library.py" -p no:cacheprovider -q
  ```
  預期輸出：現有 9 個測試全 pass（含 `test_tree_lists_two_level_ifc_only`、`test_version_sort_natural_with_completion_last` 等）。若 collection 失敗（缺 pytest），改用 worktree 內 `governance-service` 的 venv 或 `& "C:\Program Files\Python312\python.exe" -m pip install pytest fastapi` 後重跑（不寫進 requirements.txt）。

- [ ] 在 `api.py` 把 `_list_versions` 改為下列實作（兩層段落逐字保留，僅在 sort 前插入三層下探迴圈）。Read L79-104 後，將整個 function 取代為：
  ```python
  def _list_versions(model_dir: str, root_real: str) -> list[dict]:
      versions: list[dict] = []
      # 第一段（既有）：model_dir 直屬 *.ifc → name = filename（兩層形狀，逐字不變）。
      for entry in _iter_dir(model_dir):
          try:
              if not entry.is_file():
                  continue
              if not entry.name.lower().endswith(".ifc"):
                  continue
              if not _is_within(root_real, entry.path):
                  continue
              # stat / mtime 逐檔防護：單檔中途被刪/鎖（OSError）只跳過該檔，
              # 不讓掃描中斷導致端點整體 500。
              size_bytes = entry.stat().st_size
              mtime = _iso_mtime(entry.path)
          except OSError:
              continue
          versions.append(
              {
                  "name": entry.name,
                  "path": os.path.realpath(entry.path),
                  "size_bytes": size_bytes,
                  "mtime": mtime,
              }
          )
      # 第二段（新增）：再下探一層 versionDir → 收 *.ifc，name = "{versionDir}/{filename}"
      #（如松風庵 建築/v1/japanese_villa.ifc → "v1/japanese_villa.ifc"）。第四層以下忽略；
      # versionDir 內無 .ifc 則不產生條目。兩形狀混排走同一把 _version_sort_key。
      for ver_dir in _iter_dir(model_dir):
          try:
              if not ver_dir.is_dir():
                  continue
              if not _is_within(root_real, ver_dir.path):
                  continue
          except OSError:
              continue
          for entry in _iter_dir(ver_dir.path):
              try:
                  if not entry.is_file():
                      continue
                  if not entry.name.lower().endswith(".ifc"):
                      continue
                  if not _is_within(root_real, entry.path):
                      continue
                  size_bytes = entry.stat().st_size
                  mtime = _iso_mtime(entry.path)
              except OSError:
                  continue
              versions.append(
                  {
                      "name": f"{ver_dir.name}/{entry.name}",
                      "path": os.path.realpath(entry.path),
                      "size_bytes": size_bytes,
                      "mtime": mtime,
                  }
              )
      versions.sort(key=lambda v: _version_sort_key(v["name"]))
      return versions
  ```

- [ ] 跑既有後端測試確認兩層回歸未壞（三層測試在 Task 1 加）。
  ```powershell
  & "C:\Program Files\Python312\python.exe" -m pytest "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\governance-service\tests\test_file_library.py::test_tree_lists_two_level_ifc_only" "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\governance-service\tests\test_file_library.py::test_version_sort_natural_with_completion_last" -p no:cacheprovider -q
  ```
  預期輸出：2 passed。注意：`test_make_tree` 既有的 `extra/deep.ifc` 此時會以 `name="extra/deep.ifc"` 出現在 `機電` versions（因 `extra/` 是第三層含 `.ifc`）——這會讓 `test_tree_lists_two_level_ifc_only` 的 `assert set(names) == {...}` 失敗。**Task 1 先改 fixture 與斷言**，故本步驟僅單獨跑上面兩條不依賴 `extra/` 的斷言路徑；`test_version_sort_natural_with_completion_last` 斷言 `機電` 為 `["ver 000001.ifc","ver 000002.ifc","ver 竣工.ifc"]`，若加入 `extra/deep.ifc` 排序會插在前面而失敗 → 故 Task 1 與 Task 0 視為同一個 commit 單元，先做 Task 1 改 fixture 再一起驗。

- [ ] git add + commit（與 Task 1 合併為一個 commit；見 Task 1 末步）。

> 註：Task 0 與 Task 1 互相依賴（既有 `_make_tree` 的 `extra/deep.ifc` 三層檔在新掃描下會入樹），**請當成同一個 commit 單元連續執行**：先 Task 0 改實作、再 Task 1 改 fixture + 加三層測試，最後一起跑全綠再 commit。

---

## Task 1: 後端三層 pytest（fixture 改第四層忽略 + 三層案例 + 混排回歸）

擴充 `test_file_library.py`：`_make_tree` 把舊的「三層 `extra/deep.ifc` 不入樹」改為「第四層才忽略」並補一個合法三層 versionDir，更新既有斷言，新增三層專屬測試。

**Files:**
- Modify: `C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\governance-service\tests\test_file_library.py`（`_make_tree` L41-65、`test_tree_lists_two_level_ifc_only` L81-103）

**Steps:**

- [ ] Read `test_file_library.py` L41-103，將 `_make_tree` 內 L54-56 的三層 `extra/deep.ifc` 區塊替換為「合法三層 versionDir + 第四層忽略」：
  ```python
      # 三層版本目錄（新支援）：{project}/{model}/{versionDir}/*.ifc →
      # name = "{versionDir}/{filename}"。在 270/機電 下放 v1/villa.ifc 驗三層入樹。
      v1 = root / "270" / "機電" / "v1"
      v1.mkdir(parents=True, exist_ok=True)
      (v1 / "villa.ifc").write_text("x", encoding="utf-8")
      # 第四層（過深）忽略：270/機電/v1/sub/too_deep.ifc 不入樹。
      too_deep = root / "270" / "機電" / "v1" / "sub"
      too_deep.mkdir(parents=True, exist_ok=True)
      (too_deep / "too_deep.ifc").write_text("x", encoding="utf-8")
      # 空 versionDir（無 .ifc）不產生條目：270/機電/empty_ver/notes.txt。
      empty_ver = root / "270" / "機電" / "empty_ver"
      empty_ver.mkdir(parents=True, exist_ok=True)
      (empty_ver / "notes.txt").write_text("no ifc here", encoding="utf-8")
  ```
  （刪掉舊的 `deep = root / "270" / "機電" / "extra"` 三行；保留頂層散檔、保留目錄那兩段不動。）

- [ ] 更新 `test_tree_lists_two_level_ifc_only` 的 names 斷言（L94-97），把三層檔納入預期、第四層/空目錄排除：
  ```python
      # 只收 .ifc（notes.txt 被忽略）；三層 v1/villa.ifc 入樹（name 帶 versionDir 前綴）；
      # 第四層 v1/sub/too_deep.ifc 與空 versionDir(empty_ver) 不出現。
      assert "notes.txt" not in names
      assert "too_deep.ifc" not in names
      assert "v1/sub/too_deep.ifc" not in names
      assert set(names) == {"ver 000001.ifc", "ver 000002.ifc", "ver 竣工.ifc", "v1/villa.ifc"}
  ```

- [ ] 在檔尾新增三層專屬測試（沿用 `client` fixture）：
  ```python
  def test_three_level_version_dir_listed_with_prefixed_name(client):
      """三層 {project}/{model}/{versionDir}/*.ifc 入樹，name = "{versionDir}/{filename}"，path 絕對且存在。"""
      c, root = client
      body = c.get("/api/files/tree").json()
      projects = {p["project_id"]: p for p in body["projects"]}
      models = {m["model_id"]: m for m in projects["270"]["models"]}
      versions = {v["name"]: v for v in models["機電"]["versions"]}
      assert "v1/villa.ifc" in versions
      v = versions["v1/villa.ifc"]
      assert os.path.isabs(v["path"]) and os.path.exists(v["path"])
      assert v["path"].endswith(os.path.join("v1", "villa.ifc"))
      assert isinstance(v["size_bytes"], int) and v["size_bytes"] > 0


  def test_fourth_level_and_empty_version_dir_ignored(client):
      """第四層（versionDir/sub/*.ifc）忽略；versionDir 內無 .ifc 不產生條目。"""
      c, _ = client
      body = c.get("/api/files/tree").json()
      projects = {p["project_id"]: p for p in body["projects"]}
      names = [v["name"] for v in projects["270"]["models"]["機電"]["versions"]] if False else [
          v["name"] for m in projects["270"]["models"] if m["model_id"] == "機電" for v in m["versions"]
      ]
      assert all("too_deep" not in n for n in names)
      assert all("empty_ver" not in n for n in names)


  def test_two_and_three_level_mixed_sort_completion_last(client):
      """同 model 兩形狀混排：兩層檔 + 三層檔走同一把自然排序尺；ver 竣工.ifc 仍固定最後。"""
      c, _ = client
      body = c.get("/api/files/tree").json()
      projects = {p["project_id"]: p for p in body["projects"]}
      names = [
          v["name"] for m in projects["270"]["models"] if m["model_id"] == "機電" for v in m["versions"]
      ]
      # v1/villa.ifc（v 開頭，非數字、非竣工）與兩層檔混排；竣工固定最後。
      assert names[-1] == "ver 竣工.ifc"
      assert "v1/villa.ifc" in names
      assert set(names) == {"ver 000001.ifc", "ver 000002.ifc", "ver 竣工.ifc", "v1/villa.ifc"}
  ```

- [ ] 跑全後端 file_library 測試確認全綠（Task 0 + Task 1 一起驗）。
  ```powershell
  & "C:\Program Files\Python312\python.exe" -m pytest "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\governance-service\tests\test_file_library.py" -p no:cacheprovider -q
  ```
  預期輸出：原 9 + 新 3 = 12 passed（`test_tree_lists_two_level_ifc_only` 含 `v1/villa.ifc` 通過；traversal / 保留目錄 / runtime-root fallback 等回歸全綠）。

- [ ] GitNexus detect_changes（commit 前必跑）。
  ```
  mcp__gitnexus__detect_changes  repo="AI-BIM-governance"
  ```
  預期：列出 `file_library/api.py` 的 `_list_versions` 變更，scope 僅該 function；無預期外 symbol。

- [ ] git add + commit（Task 0 + Task 1 同一 commit）。
  ```powershell
  & "C:\Program Files\Git\bin\git.exe" -C "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector" add governance-service/file_library/api.py governance-service/tests/test_file_library.py
  & "C:\Program Files\Git\bin\git.exe" -C "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector" diff --cached --check
  ```
  預期 `--check`：無輸出（無 trailing whitespace）。再 commit：
  ```powershell
  & "C:\Program Files\Git\bin\git.exe" -C "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector" commit -m "feat(file-library): 支援第三層版本目錄掃描（{project}/{model}/{versionDir}/*.ifc）

name 帶 versionDir 前綴（如 v1/japanese_villa.ifc）；第四層以下忽略、空 versionDir 不產生條目；
兩層形狀與輸出完全不變，混排走同一把自然排序尺、竣工固定最後。pytest 擴充三層案例與回歸鎖。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 2: 前端 VersionDiffPage 雙組三層選擇器 + model_version_id 帶出

在 `VersionDiffPage` 加入 base 與 target 各一組「project→model→version」三層 `<select>`（複用 A1 模式），選定即填對應 `base`/`target` input 並記 `base_model_version_id`/`target_model_version_id`，隨 `createDiff` 送出；手動覆寫 input 時清空對應 model_version_id；fsErr 時 graceful degradation。

**Files:**
- Modify: `C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\web-viewer-sample\src\console\pages.tsx`（`VersionDiffPage`，L915-1028）
- Test: `C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\web-viewer-sample\src\console\console.test.tsx`（Task 3 寫）

**Steps:**

- [ ] GitNexus impact（動 `VersionDiffPage` 前必跑）。
  ```
  mcp__gitnexus__impact  name="VersionDiffPage"  repo="AI-BIM-governance"  file_path="web-viewer-sample/src/console/pages.tsx"
  ```
  預期：caller 僅 `EdgeConsole`（route case `a2`/`version-diff`），risk LOW（單一 route render，無其他組件 import）。HIGH/CRITICAL 先回報。

- [ ] 跑前端測試拿 baseline（改之前先量）。
  ```powershell
  & "C:\Program Files\nodejs\npm.cmd" --prefix "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\web-viewer-sample" test -- --run console.test.tsx
  ```
  預期輸出：現有 console.test.tsx 全 pass（含 `A2 補 apply-overlay…`、A1 selector 那組）。若 npm 路徑不同，用 `web-viewer-sample` 內 `package.json` 的 test script（vitest）。

- [ ] 確認 `pages.tsx` 頂部已 import `FileProjectRow`（L6 已 import；若無則補）。Read L6 確認 `FileProjectRow` 在 import 清單。預期：已存在（A1 已用同型別）。

- [ ] Read `VersionDiffPage` L915-948，在 state 區（L916-925 之後、`run` callback 之前）插入 A1 同款檔案庫 state，base/target 各一份：
  ```tsx
    // A2 檔案庫選擇器（複用 A1 IssuesRuleCenterPage 模式）：base / target 各一組
    // project→model→version 三層；選定填入對應路徑 input + 帶出 model_version_id。
    const [fsTree, setFsTree] = useState<FileProjectRow[] | null>(null);
    const [fsErr, setFsErr] = useState<string | null>(null);
    // model_version_id = "{project_id}/{model_id}/{version.name}"（供 /issue-impact 版本綁定）；
    // 手動覆寫路徑 input 後清空（誠實：手填路徑無版本綁定語意）。
    const [baseVerId, setBaseVerId] = useState("");
    const [targetVerId, setTargetVerId] = useState("");
    // 受控版本選擇（值 = version.path）；base / target 各一套 project/model/version 與「選擇器填入值」追蹤。
    const [baseSel, setBaseSel] = useState({ project: "", model: "", version: "" });
    const [targetSel, setTargetSel] = useState({ project: "", model: "", version: "" });

    const loadFsTree = useCallback(async () => {
      setFsErr(null);
      try {
        const t = await governanceClient.filesTree();
        setFsTree(t.projects);
      } catch (e) {
        setFsErr(String(e));
      }
    }, []);
    useEffect(() => { void loadFsTree(); }, [loadFsTree]);
  ```

- [ ] 在 state 之後加兩個 helper（base / target 各自的「選版本」與「換 project/model 重置」邏輯），避免重複貼：
  ```tsx
    // pickVersion：選定版本 path → 填路徑 input + 記 model_version_id；清 placeholder → 清掉「選擇器填入的」值。
    const pickBaseVersion = useCallback((projectId: string, modelId: string, ver?: FileVersionRow) => {
      if (ver) {
        setBase(ver.path);
        setBaseVerId(`${projectId}/${modelId}/${ver.name}`);
        setBaseSel({ project: projectId, model: modelId, version: ver.path });
      } else {
        setBaseSel((s) => ({ ...s, version: "" }));
        setBase((cur) => (cur === baseSel.version ? "" : cur));
        setBaseVerId("");
      }
    }, [baseSel.version]);
    const pickTargetVersion = useCallback((projectId: string, modelId: string, ver?: FileVersionRow) => {
      if (ver) {
        setTarget(ver.path);
        setTargetVerId(`${projectId}/${modelId}/${ver.name}`);
        setTargetSel({ project: projectId, model: modelId, version: ver.path });
      } else {
        setTargetSel((s) => ({ ...s, version: "" }));
        setTarget((cur) => (cur === targetSel.version ? "" : cur));
        setTargetVerId("");
      }
    }, [targetSel.version]);
    const baseModels = fsTree?.find((p) => p.project_id === baseSel.project)?.models ?? [];
    const baseVersions = baseModels.find((m) => m.model_id === baseSel.model)?.versions ?? [];
    const targetModels = fsTree?.find((p) => p.project_id === targetSel.project)?.models ?? [];
    const targetVersions = targetModels.find((m) => m.model_id === targetSel.model)?.versions ?? [];
  ```
  （`FileVersionRow` 也需在 L6 import 清單；Read L6 確認，若無則加入 import。）

- [ ] 在 `run` callback（L927-948）把 `createDiff` 呼叫補上 model_version_id（手填路徑時為空字串 → 轉 undefined，維持現行為）：
  ```tsx
        const { diff_id } = await governanceClient.createDiff({
          base_ifc_path: base,
          target_ifc_path: target,
          base_model_version_id: baseVerId || undefined,
          target_model_version_id: targetVerId || undefined,
          include_geometry: includeGeo,
        });
  ```
  並把 `run` 的 deps 由 `[base, target, includeGeo]` 改為 `[base, target, includeGeo, baseVerId, targetVerId]`。

- [ ] 在 JSX 兩個 input（L960-961）**之前**插入 base/target 兩組三層選擇器（testid `a2-base-project`/`a2-base-model`/`a2-base-version`、`a2-target-project`/`a2-target-model`/`a2-target-version`）。在 `<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>` 內、第一個 `<input>`（base）前加：
  ```tsx
            {fsErr && (
              <span className="ec-warn-note" data-testid="a2-fs-error" style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span>檔案庫不可用（{fsErr}）；可改用下方手動輸入路徑。</span>
                <Btn data-testid="a2-fs-retry" caption="GET /api/governance/files/tree" onClick={() => { void loadFsTree(); }}>重試載入檔案庫</Btn>
              </span>
            )}
            {!fsErr && !fsTree && <span className="ec-s">載入檔案庫中…（GET /api/governance/files/tree）</span>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="ec-k" style={{ minWidth: 48 }}>base</span>
              <select data-testid="a2-base-project" className="ec-btn" value={baseSel.project} disabled={!fsTree}
                onChange={(e) => { setBaseSel({ project: e.target.value, model: "", version: "" }); pickBaseVersion(e.target.value, "", undefined); }}>
                <option value="">專案…</option>
                {(fsTree ?? []).map((p) => <option key={p.project_id} value={p.project_id}>{p.project_id}</option>)}
              </select>
              <select data-testid="a2-base-model" className="ec-btn" value={baseSel.model} disabled={!baseSel.project}
                onChange={(e) => { setBaseSel((s) => ({ ...s, model: e.target.value, version: "" })); pickBaseVersion(baseSel.project, e.target.value, undefined); }}>
                <option value="">模型…</option>
                {baseModels.map((m) => <option key={m.model_id} value={m.model_id}>{m.model_id}</option>)}
              </select>
              <select data-testid="a2-base-version" className="ec-btn" value={baseSel.version} disabled={!baseSel.model}
                onChange={(e) => { const v = baseVersions.find((x) => x.path === e.target.value); pickBaseVersion(baseSel.project, baseSel.model, v); }}>
                <option value="">版本…（選定填入路徑）</option>
                {baseVersions.map((v) => <option key={v.name} value={v.path}>{v.name}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="ec-k" style={{ minWidth: 48 }}>target</span>
              <select data-testid="a2-target-project" className="ec-btn" value={targetSel.project} disabled={!fsTree}
                onChange={(e) => { setTargetSel({ project: e.target.value, model: "", version: "" }); pickTargetVersion(e.target.value, "", undefined); }}>
                <option value="">專案…</option>
                {(fsTree ?? []).map((p) => <option key={p.project_id} value={p.project_id}>{p.project_id}</option>)}
              </select>
              <select data-testid="a2-target-model" className="ec-btn" value={targetSel.model} disabled={!targetSel.project}
                onChange={(e) => { setTargetSel((s) => ({ ...s, model: e.target.value, version: "" })); pickTargetVersion(targetSel.project, e.target.value, undefined); }}>
                <option value="">模型…</option>
                {targetModels.map((m) => <option key={m.model_id} value={m.model_id}>{m.model_id}</option>)}
              </select>
              <select data-testid="a2-target-version" className="ec-btn" value={targetSel.version} disabled={!targetSel.model}
                onChange={(e) => { const v = targetVersions.find((x) => x.path === e.target.value); pickTargetVersion(targetSel.project, targetSel.model, v); }}>
                <option value="">版本…（選定填入路徑）</option>
                {targetVersions.map((v) => <option key={v.name} value={v.path}>{v.name}</option>)}
              </select>
            </div>
  ```

- [ ] 在 base/target input（L960-961）的 `onChange` 補上「手動覆寫清版本綁定」：把 `onChange={(e) => setBase(e.target.value)}` 改為 `onChange={(e) => { setBase(e.target.value); setBaseVerId(""); setBaseSel((s) => ({ ...s, version: "" })); }}`，target 同理改 `setTarget` / `setTargetVerId` / `setTargetSel`。並各加 `data-testid="a2-base-input"` / `data-testid="a2-target-input"` 方便 E2E/vitest 定位。

- [ ] 跑型別檢查 + build 確認無 TS 錯（受控 state 與 import 都對）。
  ```powershell
  & "C:\Program Files\nodejs\npm.cmd" --prefix "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\web-viewer-sample" run build
  ```
  預期輸出：vite build 成功（tsc 無 error）。若報 `FileVersionRow` 未 import → 回上面步驟把 `FileVersionRow` 加入 L6 import。

- [ ] commit（與 Task 3 vitest 合併為前端一個 commit；見 Task 3 末步）。

---

## Task 3: 前端 vitest（選擇器 render + 帶出 model_version_id + graceful degrade + 手動覆寫清綁定）

比照 console.test.tsx 既有 A1 selector client-render 模式，為 `VersionDiffPage` 加四條測試：選擇器 render、選定後 input 值更新 + `createDiff` 收到 model_version_id、fsErr graceful degradation、手動覆寫清空版本綁定。

**Files:**
- Modify: `C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\web-viewer-sample\src\console\console.test.tsx`（新增一個 describe block，沿用 L479-... 的 `tree` fixture 樣式）

**Steps:**

- [ ] Read console.test.tsx L479-510 確認既有 `tree` fixture 樣式（`VER_PATH`、`tree: FilesTreeResponse`、`beforeEach`/`afterEach` container 生命週期）。新 describe 自帶 fixture（含 270/機電 兩版 + 松風庵/建築 三層 `v1/japanese_villa.ifc`）。

- [ ] 在檔尾（最後一個 `});` 之後）新增 describe block：
  ```tsx
  describe("A2 VersionDiff 檔案庫選擇器 client-render（spec §4.2/§6.2：base/target 三層 + model_version_id）", () => {
    const BASE_PATH = "C:/Repos/active/iot/AI-BIM-governance/storage/270/機電/ver 000001.ifc";
    const TARGET_PATH = "C:/Repos/active/iot/AI-BIM-governance/storage/270/機電/ver 竣工.ifc";
    const VILLA_PATH = "C:/Repos/active/iot/AI-BIM-governance/storage/松風庵/建築/v1/japanese_villa.ifc";
    const a2tree: FilesTreeResponse = {
      root: "C:/Repos/active/iot/AI-BIM-governance/storage",
      source_kind: "local_fs",
      projects: [
        {
          project_id: "270",
          models: [
            {
              model_id: "機電",
              versions: [
                { name: "ver 000001.ifc", path: BASE_PATH, size_bytes: 8155, mtime: "2026-06-10T17:00:00+08:00" },
                { name: "ver 竣工.ifc", path: TARGET_PATH, size_bytes: 22618, mtime: "2026-06-10T17:17:00+08:00" },
              ],
            },
          ],
        },
        {
          project_id: "松風庵",
          models: [
            {
              model_id: "建築",
              versions: [
                { name: "v1/japanese_villa.ifc", path: VILLA_PATH, size_bytes: 12345, mtime: "2026-06-11T09:00:00+08:00" },
              ],
            },
          ],
        },
      ],
    };

    let container: HTMLDivElement;
    beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); });
    afterEach(() => { vi.restoreAllMocks(); container.remove(); });

    const sel = (testid: string) => container.querySelector<HTMLSelectElement>(`[data-testid="${testid}"]`)!;
    const inputByTestId = (testid: string) => container.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)!;

    it("base 選 270/機電/ver 000001.ifc + target 選 ver 竣工.ifc → input 值更新且 createDiff 收到 model_version_id", async () => {
      vi.spyOn(governanceClient, "filesTree").mockResolvedValue(a2tree);
      const createSpy = vi
        .spyOn(governanceClient, "createDiff")
        .mockResolvedValue({ diff_id: "d1", status: "queued" });
      // getDiff 一次回 succeeded 結束輪詢（避免測試等 120 秒）。
      vi.spyOn(governanceClient, "getDiff").mockResolvedValue({
        diff_id: "d1", status: "succeeded",
        summary: { matched: 3, counts: { added: 2, removed: 0, moved: 0, property_changed: 1 } },
      } as never);
      vi.spyOn(governanceClient, "getDiffItems").mockResolvedValue([]);
      vi.spyOn(governanceClient, "diffIssueImpact").mockRejectedValue(new Error("optional"));

      const root = createRoot(container);
      await act(async () => { root.render(<VersionDiffPage />); });
      await act(async () => { await Promise.resolve(); }); // 等 fsTree 入 state

      // base 三層
      await act(async () => { sel("a2-base-project").value = "270"; sel("a2-base-project").dispatchEvent(new Event("change", { bubbles: true })); });
      await act(async () => { sel("a2-base-model").value = "機電"; sel("a2-base-model").dispatchEvent(new Event("change", { bubbles: true })); });
      await act(async () => { sel("a2-base-version").value = BASE_PATH; sel("a2-base-version").dispatchEvent(new Event("change", { bubbles: true })); });
      // target 三層
      await act(async () => { sel("a2-target-project").value = "270"; sel("a2-target-project").dispatchEvent(new Event("change", { bubbles: true })); });
      await act(async () => { sel("a2-target-model").value = "機電"; sel("a2-target-model").dispatchEvent(new Event("change", { bubbles: true })); });
      await act(async () => { sel("a2-target-version").value = TARGET_PATH; sel("a2-target-version").dispatchEvent(new Event("change", { bubbles: true })); });

      // 受控 input 已被填入版本 path。
      expect(inputByTestId("a2-base-input").value).toBe(BASE_PATH);
      expect(inputByTestId("a2-target-input").value).toBe(TARGET_PATH);

      // Run Diff → createDiff 收到 base/target path + model_version_id（version 綁定 spec §4.2）。
      const runBtn = Array.from(container.querySelectorAll("button")).find((b) => /Run Diff|比對中/.test(b.textContent || ""))!;
      await act(async () => { runBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await act(async () => { await Promise.resolve(); });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          base_ifc_path: BASE_PATH,
          target_ifc_path: TARGET_PATH,
          base_model_version_id: "270/機電/ver 000001.ifc",
          target_model_version_id: "270/機電/ver 竣工.ifc",
        }),
      );
      await act(async () => { root.unmount(); });
    });

    it("project 下拉含松風庵；選建築 → 版本下拉含三層 v1/japanese_villa.ifc（三層支援 user-facing 證明）", async () => {
      vi.spyOn(governanceClient, "filesTree").mockResolvedValue(a2tree);
      const root = createRoot(container);
      await act(async () => { root.render(<VersionDiffPage />); });
      await act(async () => { await Promise.resolve(); });

      // base project 下拉含「松風庵」。
      const projOptions = Array.from(sel("a2-base-project").options).map((o) => o.value);
      expect(projOptions).toContain("松風庵");
      // 選松風庵/建築 → version option 含三層 name。
      await act(async () => { sel("a2-base-project").value = "松風庵"; sel("a2-base-project").dispatchEvent(new Event("change", { bubbles: true })); });
      await act(async () => { sel("a2-base-model").value = "建築"; sel("a2-base-model").dispatchEvent(new Event("change", { bubbles: true })); });
      const verLabels = Array.from(sel("a2-base-version").options).map((o) => o.textContent);
      expect(verLabels).toContain("v1/japanese_villa.ifc");
      await act(async () => { root.unmount(); });
    });

    it("filesTree() reject → 選擇器標「檔案庫不可用」graceful degrade，手動輸入照常可用", async () => {
      vi.spyOn(governanceClient, "filesTree").mockRejectedValue(new Error("proxy 502"));
      const root = createRoot(container);
      await act(async () => { root.render(<VersionDiffPage />); });
      await act(async () => { await Promise.resolve(); });

      const html = container.innerHTML;
      expect(html).toContain("檔案庫不可用");
      expect(html).toContain("可改用下方手動輸入路徑");
      expect(html).toContain("proxy 502");
      // 手動輸入框仍可用（保留預設路徑、可編輯）。
      const baseInput = inputByTestId("a2-base-input");
      expect(baseInput.disabled).toBe(false);
      await act(async () => { baseInput.value = "C:/manual/base.ifc"; baseInput.dispatchEvent(new Event("input", { bubbles: true })); });
      expect(inputByTestId("a2-base-input").value).toBe("C:/manual/base.ifc");
      await act(async () => { root.unmount(); });
    });

    it("選定版本後手動覆寫 base input → 清空 base_model_version_id（誠實：手填路徑無版本綁定）", async () => {
      vi.spyOn(governanceClient, "filesTree").mockResolvedValue(a2tree);
      const createSpy = vi.spyOn(governanceClient, "createDiff").mockResolvedValue({ diff_id: "d2", status: "queued" });
      vi.spyOn(governanceClient, "getDiff").mockResolvedValue({
        diff_id: "d2", status: "succeeded", summary: { matched: 0, counts: {} },
      } as never);
      vi.spyOn(governanceClient, "getDiffItems").mockResolvedValue([]);
      vi.spyOn(governanceClient, "diffIssueImpact").mockRejectedValue(new Error("optional"));
      const root = createRoot(container);
      await act(async () => { root.render(<VersionDiffPage />); });
      await act(async () => { await Promise.resolve(); });

      await act(async () => { sel("a2-base-project").value = "270"; sel("a2-base-project").dispatchEvent(new Event("change", { bubbles: true })); });
      await act(async () => { sel("a2-base-model").value = "機電"; sel("a2-base-model").dispatchEvent(new Event("change", { bubbles: true })); });
      await act(async () => { sel("a2-base-version").value = BASE_PATH; sel("a2-base-version").dispatchEvent(new Event("change", { bubbles: true })); });
      // 手動覆寫 base input → 版本綁定清空。
      await act(async () => { const el = inputByTestId("a2-base-input"); el.value = "C:/manual/override.ifc"; el.dispatchEvent(new Event("input", { bubbles: true })); });

      const runBtn = Array.from(container.querySelectorAll("button")).find((b) => /Run Diff|比對中/.test(b.textContent || ""))!;
      await act(async () => { runBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await act(async () => { await Promise.resolve(); });
      // base_model_version_id 應為 undefined（手填路徑無綁定）。
      const arg = createSpy.mock.calls[0][0];
      expect(arg.base_ifc_path).toBe("C:/manual/override.ifc");
      expect(arg.base_model_version_id).toBeUndefined();
      await act(async () => { root.unmount(); });
    });
  });
  ```

- [ ] 跑前端測試確認全綠（既有 + 新 4 條）。
  ```powershell
  & "C:\Program Files\nodejs\npm.cmd" --prefix "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\web-viewer-sample" test -- --run console.test.tsx
  ```
  預期輸出：所有 console.test.tsx 測試 pass，含新增的「A2 VersionDiff 檔案庫選擇器 client-render」4 條。若 `getDiff` mock 型別不合，沿用既有測試的 `as never` 斷言（fixture summary 形狀比照 DiffStatus）。

- [ ] GitNexus detect_changes（commit 前必跑）。
  ```
  mcp__gitnexus__detect_changes  repo="AI-BIM-governance"
  ```
  預期：列出 `pages.tsx` 的 `VersionDiffPage` 變更，scope 僅該 function + test 檔；無預期外 symbol。

- [ ] git add + commit（Task 2 + Task 3 前端一個 commit）。
  ```powershell
  & "C:\Program Files\Git\bin\git.exe" -C "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector" add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/console.test.tsx
  & "C:\Program Files\Git\bin\git.exe" -C "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector" diff --cached --check
  & "C:\Program Files\Git\bin\git.exe" -C "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector" commit -m "feat(a2): VersionDiffPage 加 base/target 檔案庫三層選擇器 + model_version_id 帶出

複用 A1 三層 select 模式；選定填路徑 input 並帶出 {project}/{model}/{version.name} 版本綁定，
隨既有 createDiff 送出；手動覆寫 input 清空綁定（誠實）；fsErr graceful degradation。
vitest 鎖：選定帶出 model_version_id、松風庵三層可見、graceful degrade、手填清綁定。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 4: Browser E2E（Playwright vertical slice：UI route → 選擇器 → 真 backend diff → succeeded → 非全零 counts）

新增 `e2e/a2-version-diff-selector.spec.ts`，比照 minio-fileserver-source.spec.ts 的守門 skip-gate，驗 `#/a2` 完整垂直切片：選 `270/機電` base/target 兩版 → Run Diff → 真 backend 回 succeeded → counts 卡顯示且 added+removed+moved+property_changed 總和 > 0；且 base project 下拉可見「松風庵」、選松風庵/建築版本下拉含 `v1/japanese_villa.ifc`。

**Files:**
- Create: `C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\web-viewer-sample\e2e\a2-version-diff-selector.spec.ts`
- Create（evidence，E2E 跑完落地）：`C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\docs\evidence\a2-version-diff-selector\`（截圖 + summary）

**Steps:**

- [ ] Read `web-viewer-sample/e2e/minio-fileserver-source.spec.ts` 全檔（已在 plan 背景列出 L1-130），照抄守門結構：檔頭限制揭露註解、`COORDINATOR` 常數、`beforeEach` 兩道 conditional skip（守門 (1) API files/tree 含 270；守門 (2) coordinator dist-ui 是本 branch — 改用 `a2-base-project` 當判據，因 main 無此 testid）。

- [ ] 建立 `e2e/a2-version-diff-selector.spec.ts`：
  ```ts
  import { test, expect } from "@playwright/test";

  // A2 版本 diff 檔案庫選擇器端到端：#/a2 由 base/target 三層選擇器選 270/機電 兩版 →
  // Run Diff → 真 backend 回 succeeded → counts 卡非全零；且 project 下拉含松風庵、
  // 松風庵/建築 版本下拉含三層 v1/japanese_villa.ifc（三層支援 user-facing 證明）。
  //
  // *** 服務這頁的是 COORDINATOR 已 build 的 dist-ui（npm run build:ui → dist-ui），
  //     不是 playwright.config.ts 的 fresh viewer。前置（乾淨環境必做）：
  //       1. cd web-viewer-sample && npm run build:ui   # 用本 branch 的碼重 build dist-ui
  //       2. 重啟 coordinator(:8004) 服務新 dist-ui；BIM_FILE_LIBRARY_ROOT 指主 worktree
  //          storage（含 270/889/990/松風庵）。docker 佔 :8004 時 build:ui 不會自動換容器內
  //          陳舊 dist-ui → 須重建/重啟該服務（已知 gotcha）。
  //       3. coordinator 跑別的 port 用 E2E_COORDINATOR_BASE_URL 覆寫。
  //     此前置靠人工/指揮官紀律；beforeEach 用「本 branch 才有的 a2-base-project」守門，
  //     環境沒對齊就 conditional skip（誠實：不假裝跑過，也不留誤導 timeout）。
  //
  // *** skip-gate 效力限制：beforeEach 兩道是 conditional skip（前置缺失 → skip → 計 pass）。
  //     本 repo .github/workflows 僅 pr-review-agent.yml、無 Playwright job，故不會 false-green
  //     任何既有自動化 gate；此 spec 純屬本機/指揮官手動 P4 硬 gate。***
  const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

  test.describe("A2 版本 diff 檔案庫選擇器端到端", () => {
    test.setTimeout(180_000);

    test.beforeEach(async ({ request, page }) => {
      // 守門 (1)：backend files/tree 必須含 270（A2 fixture 來源），否則 skip。
      let apiOk = false;
      try {
        const res = await request.get(`${COORDINATOR}/api/governance/files/tree`);
        if (res.ok()) {
          const body = await res.json();
          const ids = new Set((body.projects || []).map((p: { project_id: string }) => p.project_id));
          apiOk = ids.has("270");
        }
      } catch {
        apiOk = false;
      }
      test.skip(!apiOk, "檔案庫未備妥（需 governance-service + BIM_FILE_LIBRARY_ROOT 指主 worktree storage 含 270）");

      // 守門 (2)：coordinator dist-ui 是本 branch（#/a2 有 a2-base-project，main 不存在）。
      let uiOk = false;
      try {
        await page.goto(`${COORDINATOR}/ui/#/a2`);
        await page.getByTestId("a2-base-project").waitFor({ state: "visible", timeout: 15_000 });
        uiOk = true;
      } catch {
        uiOk = false;
      }
      test.skip(!uiOk, "coordinator dist-ui 非本 branch（#/a2 缺 a2-base-project 選擇器）：需 `npm run build:ui` 後重啟 :8004 dist-ui 的 coordinator（見檔頭前置）。");
    });

    test("#/a2 選 270/機電 base/target 兩版 → Run Diff → succeeded → counts 非全零", async ({ page }) => {
      await page.goto(`${COORDINATOR}/ui/#/a2`);

      // base：270 / 機電 / ver 000001.ifc（option value=絕對 path，用 label 選）。
      await page.getByTestId("a2-base-project").selectOption("270");
      await page.getByTestId("a2-base-model").selectOption("機電");
      await page.getByTestId("a2-base-version").selectOption({ label: "ver 000001.ifc" });
      // target：270 / 機電 / ver 竣工.ifc。
      await page.getByTestId("a2-target-project").selectOption("270");
      await page.getByTestId("a2-target-model").selectOption("機電");
      await page.getByTestId("a2-target-version").selectOption({ label: "ver 竣工.ifc" });

      // 受控 input 被填入版本路徑（controlled → 讀 inputValue，不靠 attribute）。
      await expect(page.getByTestId("a2-base-input")).toHaveValue(/ver 000001\.ifc$/, { timeout: 10_000 });
      await expect(page.getByTestId("a2-target-input")).toHaveValue(/ver 竣工\.ifc$/, { timeout: 10_000 });

      // Run Diff → 真 backend。
      await page.getByRole("button", { name: /Run Diff/ }).click();

      // counts 卡只在 diff!=null（後端回 succeeded/failed）才渲染（pages.tsx `{diff && (...)}`）；
      // 等 added/removed/moved/property changed 四個 Metric label 可見。
      await expect(page.getByText("matched", { exact: false }).first()).toBeVisible({ timeout: 120_000 });
      await expect(page.getByText("property changed", { exact: false }).first()).toBeVisible({ timeout: 120_000 });

      // 真實非全零：抓 added/removed/moved/property_changed 四個數字相加 > 0。
      // Metric 結構為 <div><big value></big><label></label></div>；用 evaluate 從 DOM 收 counts。
      const sum = await page.evaluate(() => {
        const labels = ["added", "removed", "moved", "property changed"];
        let total = 0;
        document.querySelectorAll("main .ec-grid > div").forEach((cell) => {
          const label = cell.querySelector("*:last-child")?.textContent?.trim() ?? "";
          if (labels.includes(label)) {
            const num = parseInt(cell.textContent?.replace(label, "").trim() ?? "0", 10);
            if (!Number.isNaN(num)) total += num;
          }
        });
        return total;
      });
      expect(sum).toBeGreaterThan(0); // 8KB vs 22KB 兩版 GlobalId 對齊必有差異（identity 才會全零）。

      await page.screenshot({ path: "../artifacts/e2e/a2-version-diff-selector-diff-counts.png", fullPage: true });
    });

    test("base project 下拉含松風庵；選松風庵/建築 → 版本下拉含三層 v1/japanese_villa.ifc", async ({ page }) => {
      await page.goto(`${COORDINATOR}/ui/#/a2`);

      // project 下拉含松風庵（三層 fixture 的 project；需 BIM_FILE_LIBRARY_ROOT 含 storage/松風庵/）。
      const baseProject = page.getByTestId("a2-base-project");
      await expect(baseProject).toBeVisible({ timeout: 30_000 });
      await expect(baseProject.locator("option", { hasText: "松風庵" })).toHaveCount(1);

      // 選松風庵/建築 → 版本下拉含三層 name "v1/japanese_villa.ifc"（三層掃描 user-facing 證明）。
      await baseProject.selectOption("松風庵");
      await page.getByTestId("a2-base-model").selectOption("建築");
      await expect(
        page.getByTestId("a2-base-version").locator("option", { hasText: "v1/japanese_villa.ifc" }),
      ).toHaveCount(1, { timeout: 10_000 });

      await page.screenshot({ path: "../artifacts/e2e/a2-version-diff-selector-matsu-three-level.png", fullPage: true });
    });
  });
  ```

- [ ] 確認 E2E 前置（指揮官紀律：build:ui + 重啟 coordinator + governance-service 起、BIM_FILE_LIBRARY_ROOT 指主 worktree storage）。先 build dist-ui：
  ```powershell
  & "C:\Program Files\nodejs\npm.cmd" --prefix "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\web-viewer-sample" run build:ui
  ```
  預期：dist-ui 產出更新。docker 佔 :8004 時須依 memory「docker 重建繞過被擋的 deploy.ps1」重建 coordinator image（`docker compose build coordinator` + `up -d`），否則打到陳舊容器（已知 gotcha：/ui 改了沒效）。

- [ ] 跑 A2 E2E spec。
  ```powershell
  & "C:\Program Files\nodejs\npm.cmd" --prefix "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\web-viewer-sample" exec -- playwright test e2e/a2-version-diff-selector.spec.ts --reporter=line
  ```
  預期輸出：2 passed（非 skipped）。**若全 skipped**：守門 (1)/(2) 未過 → 表示 backend files/tree 沒回 270 或 coordinator dist-ui 非本 branch；先補前置（build:ui + 重啟/重建 coordinator + governance-service 起 + env），再重跑，不可把 skip 當 pass（誠實鐵律）。

- [ ] 落 evidence（截圖 + summary）到 tracked 目錄。把 `artifacts/e2e/a2-version-diff-selector-*.png` 複製到 `docs/evidence/a2-version-diff-selector/`，並寫一份 `summary.md` 記：跑的 base/target 路徑、counts 實際數字（added/removed/moved/property_changed）、succeeded 與否、松風庵三層可見截圖。截圖檔大用抽樣（memory「real-ifc E2E fixtures」：evidence 只存抽樣，禁 commit IFC/usdc）。
  ```powershell
  & "C:\Program Files\Git\bin\git.exe" -C "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector" status --short docs/evidence/a2-version-diff-selector/
  ```
  預期：列出新 evidence 檔（spec §6.3 要求 evidence 落 `docs/evidence/a2-version-diff-selector/`）。

- [ ] GitNexus detect_changes（commit 前必跑）。
  ```
  mcp__gitnexus__detect_changes  repo="AI-BIM-governance"
  ```
  預期：列出新增 e2e spec（無 symbol 變更，純測試 + evidence）。

- [ ] git add + commit。
  ```powershell
  & "C:\Program Files\Git\bin\git.exe" -C "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector" add web-viewer-sample/e2e/a2-version-diff-selector.spec.ts docs/evidence/a2-version-diff-selector/
  & "C:\Program Files\Git\bin\git.exe" -C "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector" diff --cached --check
  & "C:\Program Files\Git\bin\git.exe" -C "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector" commit -m "test(a2): 加 version-diff 選擇器 Playwright E2E + evidence

#/a2 選 270/機電 base/target 兩版 → Run Diff → succeeded → counts 非全零（真 backend）；
松風庵/建築 版本下拉含三層 v1/japanese_villa.ifc（三層支援 user-facing 證明）。守門 skip-gate
比照 minio-fileserver-source 先例；evidence 抽樣落 docs/evidence/a2-version-diff-selector/。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 5: 全套回歸 + 既有 E2E 不壞驗收

確認 file_library 回歸（`#/minio` 與 `#/a1` 既有 E2E）與全前端/後端測試全綠，達 spec §6 驗收基準。

**Files:**（無新增，僅驗證既有）
- Verify: `governance-service/tests/test_file_library.py`、`web-viewer-sample/src/console/console.test.tsx`、`web-viewer-sample/e2e/minio-fileserver-source.spec.ts`

**Steps:**

- [ ] 後端全 file_library 測試（回歸鎖）。
  ```powershell
  & "C:\Program Files\Python312\python.exe" -m pytest "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\governance-service\tests\test_file_library.py" -p no:cacheprovider -q
  ```
  預期：12 passed（兩層回歸 9 + 三層新 3）。

- [ ] 前端全 console 測試（回歸鎖）。
  ```powershell
  & "C:\Program Files\nodejs\npm.cmd" --prefix "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\web-viewer-sample" test -- --run console.test.tsx
  ```
  預期：既有 A1/A2/Minio + 新 A2 selector 4 條全 pass。

- [ ] 既有 minio E2E 不壞（file_library 改動回歸 — 三層支援不得改變兩層 270/889/990 輸出）。
  ```powershell
  & "C:\Program Files\nodejs\npm.cmd" --prefix "C:\Repos\active\iot\AI-BIM-governance\.worktrees\a2-version-diff-selector\web-viewer-sample" exec -- playwright test e2e/minio-fileserver-source.spec.ts --reporter=line
  ```
  預期：2 passed（或前置未對齊則全 skip，與本輪改動無關 — 但若 #/minio 樹缺 270/889/990 或 #/a1 selector 壞掉則為回歸，須查）。

- [ ] 回報 spec §0 四件事：改了哪些 tracked files（api.py / test_file_library.py / pages.tsx / console.test.tsx / a2-version-diff-selector.spec.ts / docs/evidence/）、執行了哪些驗證（後端 pytest 12、前端 vitest、兩個 E2E spec）、哪些沒跑及原因（如 E2E 因環境前置 skip 須註明）、已知風險（松風庵 gitignored 依賴主工作區 storage；diff 引擎對小合成 IFC 行為）。

---

## 完成定義（Done）

- file_library 三層掃描落地，`GET /api/files/tree` projects 含 270/889/990/松風庵；兩層輸出零變化（pytest 12 綠）。
- `#/a2` 有 base/target 各一組三層選擇器，選定填路徑 + 帶出 model_version_id，手動覆寫清綁定，fsErr graceful degradation（vitest 4 條綠）。
- Browser E2E 全綠（非 skip）：270/機電 兩版真 diff succeeded + counts 非全零；松風庵三層 user-facing 可見；evidence 落 `docs/evidence/a2-version-diff-selector/`。
- 既有 `#/minio` / `#/a1` E2E 不壞。
- 每個 commit 前跑過 `git diff --cached --check` 與 GitNexus `detect_changes`。
