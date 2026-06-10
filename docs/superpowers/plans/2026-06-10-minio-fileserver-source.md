# MinIO File-Server Source Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 把本機 `storage/{270,889,990}/{機電,水電,消防}/*.ifc` 兩層結構做成唯讀 file-library browse API，讓 `#/minio` 顯示真實檔案樹、`#/a1` 能用三層選擇器挑檔當 rule-run 來源。

**Architecture:** governance-service 新增獨立 `file_library/` APIRouter（鏡像既有 `diff_engine/` router 模式，`GET /api/files/tree` 讀 `BIM_FILE_LIBRARY_ROOT`，預設 repo `storage/`），coordinator 在 `governanceProxy.ts` 加一條逐 endpoint 白名單轉發 `GET /api/governance/files/tree`，前端 `governanceClient.ts` 加 `filesTree()` client method，`MinioDataPage`/`IssuesRuleCenterPage` 接真資料（樹 + 三層選擇器）。瀏覽器永不直連 governance-service（邊界 B1：只打 coordinator `:8004`）。

**Tech Stack:** Python 3.12 + FastAPI + ifcopenshell（governance-service `127.0.0.1:49102`，純 CPU、無 GPU）；TypeScript + Express（coordinator `:8004`）；React + Vite + vitest（web-viewer-sample EdgeConsole）；Playwright（browser E2E，port 5180 dev server）。

---

## 背景脈絡（執行者零脈絡前提，先讀這段）

四個服務分工（資料流一句話版見 spec §5）：

```
瀏覽器 #/minio、#/a1
  → coordinator :8004  GET /api/governance/files/tree   （governanceProxy.ts 透傳）
  → governance-service :49102  GET /api/files/tree       （file_library router，本 plan 新增）
  → 讀 BIM_FILE_LIBRARY_ROOT（預設 repo storage/）→ 樹 JSON
A1 選定的 version.path 直接當既有 POST /api/governance/rule-runs 的 ifc_source_path
```

既有可直接抄的模式（已逐一讀過，路徑為實證非臆測）：

- governance-service router 模板：`governance-service/diff_engine/api.py`（`router = APIRouter()` + `app.py` 一行 `include_router`）。
- governance-service router 測試模板：`governance-service/tests/test_diff_api.py` + `tests/test_element_semantics.py`（`TestClient` + `importlib.reload(app)` + `monkeypatch.setenv`）。
- coordinator proxy 模板：`bim-review-coordinator/src/routes/governanceProxy.ts`（既有 `app.get("/api/governance/diffs/:diffId", ...)` 走 `forward()` helper）。
- coordinator proxy 測試模板：`bim-review-coordinator/tests/governance-rule-run-for-session.test.ts`（`createCoordinatorApp` + `GOVERNANCE_API_BASE` stub server）。
- 前端 client 模板：`web-viewer-sample/src/console/governanceClient.ts`（`jsonFetch<T>` + `governanceClient` 物件）。**注意**：spec §4.3 寫「`data.ts` 的 client 加一個方法」，但 `data.ts` 是純資料模組、真正的 HTTP client 是 `governanceClient.ts`；本 plan 一律改 `governanceClient.ts`（spec 文字筆誤，code 為準）。
- 前端 page 模板：`web-viewer-sample/src/console/pages.tsx`（`MinioDataPage` @ L379、`IssuesRuleCenterPage` @ L467；UI 元件 `Panel`/`Field`/`Btn`/`Metric`/`ProvTag` 在 `components.tsx`；`Prov` 型別在 `data.ts`）。
- 前端 render 測試模板：`web-viewer-sample/src/console/console.test.tsx`（`renderToString` smoke，不需網路）。
- E2E 模板：`web-viewer-sample/e2e/issues-tab.spec.ts` + `playwright.config.ts`（dev server 自動起 `:5180`；coordinator `:8004` 另行啟動）。

實證資料（已 `Get-ChildItem` 確認，主 worktree `C:\Repos\active\iot\AI-BIM-governance\storage`）：

```
storage/270/機電/ver 000001.ifc (8155) … ver 000002.ifc (12661) … ver 000003.ifc (18330) … ver 竣工.ifc (22618)
storage/270/水電/{4 版本}、storage/270/消防/{4 版本}
storage/889/{機電,水電,消防}/{4 版本}、storage/990/{機電,水電,消防}/{4 版本}
頂層散檔（不入樹）：storage/fixture-bytes.ifc、demo_lib_2026.ifc、許良宇圖書館建築_2026*.ifc、270_*_model.ifc
```

### BLOCKER 等級的環境事實（執行 Task 5 前務必先處理，否則 E2E 必空樹）

**worktree `storage/` 不含 270/889/990 fixtures。** 本 plan 工作目錄是 git worktree
`C:\Repos\active\iot\AI-BIM-governance\.worktrees\minio-fileserver-source`，其 `storage/` 只有 `README.md`
（大型 IFC 被 git ignore、worktree 不帶 local artifact）。真實 fixtures 只在主 worktree
`C:\Repos\active\iot\AI-BIM-governance\storage`。

影響範圍與處置（**已在 plan 內消化，非未解 blocker**）：

- Task 1（pytest）：用 `tmp_path` 自建合成 `{p}/{m}/*.ifc`，完全自足、不依賴任何 worktree 的 storage → 不受影響。
- Task 2（coordinator vitest）：用 stub server，不讀真檔 → 不受影響。
- Task 4（前端 vitest）：`renderToString` 不發網路 → 不受影響。
- Task 5（browser E2E）：dev-server-run 的 governance-service **必須** 把 `BIM_FILE_LIBRARY_ROOT`
  指到主 worktree 的絕對路徑 `C:\Repos\active\iot\AI-BIM-governance\storage`（Task 5 步驟內明列啟動指令）。
  指揮官啟動 governance-service 時設此 env，不在 workflow 內自啟服務（spec §8 風險：governance-service
  是否在 deploy 腳本內由指揮官依 golden path 處理）。

### GitNexus impact 預掃（已跑，供執行者參考；改 code symbol 前仍須各自重跑 detect_changes）

- `registerGovernanceProxy`（coordinator）：**LOW**，d=1 僅 `createCoordinatorApp`。本 plan 是在函式內**新增**一條 `app.get`，不改既有路由簽章 → 加法安全。
- `IssuesRuleCenterPage`（前端）：**LOW**，無 upstream call-edge（presentational leaf，經 EdgeConsole `case "a1"` JSX dispatch）。
- `MinioDataPage`：index stale（33 commits behind）未收錄，但與 `IssuesRuleCenterPage` 同為 leaf render function，內部新增同屬低風險。
- `governanceClient`（前端物件）：新增 method 為加法，不動既有 method。

---

## Task 1: governance-service file_library router

唯讀 `GET /api/files/tree`：掃 `BIM_FILE_LIBRARY_ROOT`（預設 repo `storage/`）兩層 `{projectId}/{modelId}/*.ifc`，回 project→model→version 樹。防 path traversal、空 root 回 200 空樹、`ver 竣工.ifc` 排最後。

**Files:**
- Create: `governance-service/file_library/__init__.py`
- Create: `governance-service/file_library/api.py`
- Modify: `governance-service/app.py`（加一行 `include_router`）
- Test: `governance-service/tests/test_file_library.py`

**Steps:**

- [ ] 建空 package 初始檔，讓 `from file_library.api import router` 可 import。寫入 `governance-service/file_library/__init__.py`：

  ```python
  """A1 file-library browse（唯讀 local file-server 模擬層，獨立 router 模組）。"""
  ```

- [ ] 先寫失敗測試（TDD red）。寫入 `governance-service/tests/test_file_library.py`：

  ```python
  """file_library tree API（FastAPI TestClient，tmp root 造兩層 IFC 結構，CPU-only、毫秒級）。

  守 spec §4.1/§7：只列兩層 {projectId}/{modelId}/*.ifc、只收 .ifc（大小寫不敏感）、
  防 path traversal（root 外 symlink 不出現）、root 不存在/空 回 200 空 projects、
  ver 竣工.ifc 固定排最後。中文路徑（機電/水電/消防、竣工）全程 UTF-8。
  """
  from __future__ import annotations

  import importlib
  import os

  import pytest
  from fastapi.testclient import TestClient


  def _make_tree(root) -> None:
      # 兩層合法結構：2 專案 × 2 模型 × 多版本（含中文檔名 + 竣工）。
      for project in ("270", "889"):
          for model in ("機電", "水電"):
              d = root / project / model
              d.mkdir(parents=True)
              for ver in ("ver 000002.ifc", "ver 000001.ifc", "ver 竣工.ifc"):
                  (d / ver).write_text("ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;\n", encoding="utf-8")
              # 同層非 .ifc 應被忽略
              (d / "notes.txt").write_text("ignore me", encoding="utf-8")
      # 頂層散檔（一層）不入樹
      (root / "fixture-bytes.ifc").write_text("x", encoding="utf-8")
      # 三層（過深）不入樹
      deep = root / "270" / "機電" / "extra"
      deep.mkdir(parents=True, exist_ok=True)
      (deep / "deep.ifc").write_text("x", encoding="utf-8")


  @pytest.fixture()
  def client(tmp_path, monkeypatch):
      root = tmp_path / "lib"
      root.mkdir()
      _make_tree(root)
      monkeypatch.setenv("BIM_FILE_LIBRARY_ROOT", str(root))
      monkeypatch.setenv("GOV_DB_PATH", str(tmp_path / "gov.db"))
      import app as app_module

      importlib.reload(app_module)
      return TestClient(app_module.app), root


  def test_tree_lists_two_level_ifc_only(client):
      c, root = client
      resp = c.get("/api/files/tree")
      assert resp.status_code == 200
      body = resp.json()
      assert body["source_kind"] == "local_fs"
      assert os.path.realpath(body["root"]) == os.path.realpath(str(root))
      projects = {p["project_id"]: p for p in body["projects"]}
      assert set(projects) == {"270", "889"}
      models = {m["model_id"]: m for m in projects["270"]["models"]}
      assert set(models) == {"機電", "水電"}
      versions = models["機電"]["versions"]
      names = [v["name"] for v in versions]
      # 只收 .ifc（notes.txt 被忽略）、過深的 extra/deep.ifc 不出現
      assert "notes.txt" not in names
      assert "deep.ifc" not in names
      assert set(names) == {"ver 000001.ifc", "ver 000002.ifc", "ver 竣工.ifc"}
      # 每個 version 帶 path（絕對、可當 ifc_source_path）/size_bytes/mtime
      v0 = versions[0]
      assert os.path.isabs(v0["path"])
      assert os.path.exists(v0["path"])
      assert isinstance(v0["size_bytes"], int) and v0["size_bytes"] > 0
      assert isinstance(v0["mtime"], str) and v0["mtime"]


  def test_top_level_loose_files_excluded(client):
      c, _ = client
      body = c.get("/api/files/tree").json()
      # fixture-bytes.ifc 在 root 一層、不符兩層結構 → 不得出現為 project
      assert "fixture-bytes" not in {p["project_id"] for p in body["projects"]}


  def test_version_sort_natural_with_completion_last(client):
      c, _ = client
      body = c.get("/api/files/tree").json()
      projects = {p["project_id"]: p for p in body["projects"]}
      models = {m["model_id"]: m for m in projects["270"]["models"]}
      names = [v["name"] for v in models["機電"]["versions"]]
      # 自然排序 + ver 竣工.ifc 固定排最後（竣工是最終版語意）
      assert names == ["ver 000001.ifc", "ver 000002.ifc", "ver 竣工.ifc"]


  def test_missing_root_returns_empty_200(tmp_path, monkeypatch):
      monkeypatch.setenv("BIM_FILE_LIBRARY_ROOT", str(tmp_path / "does-not-exist"))
      monkeypatch.setenv("GOV_DB_PATH", str(tmp_path / "gov.db"))
      import app as app_module

      importlib.reload(app_module)
      c = TestClient(app_module.app)
      resp = c.get("/api/files/tree")
      assert resp.status_code == 200
      body = resp.json()
      assert body["projects"] == []
      assert body["source_kind"] == "local_fs"


  @pytest.mark.skipif(os.name == "nt" and not os.environ.get("CI"), reason="Windows symlink 需權限；local 跳過，CI/POSIX 驗 traversal")
  def test_symlink_escape_excluded(tmp_path, monkeypatch):
      root = tmp_path / "lib"
      (root / "270" / "機電").mkdir(parents=True)
      (root / "270" / "機電" / "ver 000001.ifc").write_text("x", encoding="utf-8")
      # root 外的洩漏目標
      outside = tmp_path / "outside"
      (outside / "機電").mkdir(parents=True)
      (outside / "機電" / "secret.ifc").write_text("x", encoding="utf-8")
      # 在 root 下放一個指向 root 外的 project symlink
      os.symlink(str(outside), str(root / "999"), target_is_directory=True)
      monkeypatch.setenv("BIM_FILE_LIBRARY_ROOT", str(root))
      monkeypatch.setenv("GOV_DB_PATH", str(tmp_path / "gov.db"))
      import app as app_module

      importlib.reload(app_module)
      c = TestClient(app_module.app)
      body = c.get("/api/files/tree").json()
      # 逃逸到 root 外的 999 不得出現
      assert "999" not in {p["project_id"] for p in body["projects"]}
  ```

- [ ] 跑測試確認 red（router 尚未存在，import / 404 失敗）。執行：

  ```bash
  "/c/Program Files/Python312/python.exe" -m pytest governance-service/tests/test_file_library.py -v
  ```

  預期：collection error（`ModuleNotFoundError: No module named 'file_library'`）或 `404`，測試 FAIL。

- [ ] 最小實作 router。寫入 `governance-service/file_library/api.py`：

  ```python
  """A1 file-library browse REST（APIRouter，掛入 governance-service app）。

  唯讀 local file-server 模擬層（spec §4.1）：掃 BIM_FILE_LIBRARY_ROOT（預設 repo storage/）下
  兩層 {projectId}/{modelId}/*.ifc，回 project→model→version 樹，比照真實 MinIO
  bim-control/{projectId}/{modelId}/version 語意。source_kind="local_fs" 是誠實標記，未來真
  MinIO 接上時改 "s3"，前端文案跟著翻。不做上傳/刪除/改名（唯讀）；不接真 S3 client。
  """
  from __future__ import annotations

  import os
  import re
  from datetime import datetime, timezone

  from fastapi import APIRouter

  router = APIRouter()

  _SERVICE_ROOT = os.path.dirname(os.path.dirname(__file__))
  _DEFAULT_ROOT = os.path.join(_SERVICE_ROOT, "storage")


  def _library_root() -> str:
      # 每次請求讀（而非 import 時固定），讓測試與 deploy 能以 env 覆寫。
      return os.environ.get("BIM_FILE_LIBRARY_ROOT", _DEFAULT_ROOT)


  def _is_within(root_real: str, candidate: str) -> bool:
      """realpath 後仍在 root 內才算合法（防 path traversal / symlink 逃逸）。"""
      cand_real = os.path.realpath(candidate)
      return cand_real == root_real or cand_real.startswith(root_real + os.sep)


  # 自然排序 key：把數字段轉 int 比較（ver 000002 < ver 000010）。
  def _natural_key(name: str):
      return [int(tok) if tok.isdigit() else tok.lower() for tok in re.split(r"(\d+)", name)]


  def _version_sort_key(name: str):
      # ver 竣工.ifc 固定排最後（竣工=最終版語意）：用 (is_completion, natural_key)。
      is_completion = "竣工" in name
      return (1 if is_completion else 0, _natural_key(name))


  def _iso_mtime(path: str) -> str:
      ts = os.path.getmtime(path)
      return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone().isoformat()


  def _list_versions(model_dir: str, root_real: str) -> list[dict]:
      versions: list[dict] = []
      for entry in os.scandir(model_dir):
          if not entry.is_file():
              continue
          if not entry.name.lower().endswith(".ifc"):
              continue
          if not _is_within(root_real, entry.path):
              continue
          versions.append(
              {
                  "name": entry.name,
                  "path": os.path.realpath(entry.path),
                  "size_bytes": entry.stat().st_size,
                  "mtime": _iso_mtime(entry.path),
              }
          )
      versions.sort(key=lambda v: _version_sort_key(v["name"]))
      return versions


  @router.get("/api/files/tree")
  def files_tree():
      root = _library_root()
      root_real = os.path.realpath(root)
      payload = {"root": root_real, "source_kind": "local_fs", "projects": []}
      if not os.path.isdir(root):
          # root 不存在/非目錄 → 空樹（200，不丟 500）。
          return payload

      projects: list[dict] = []
      for proj_entry in sorted(os.scandir(root), key=lambda e: _natural_key(e.name)):
          if not proj_entry.is_dir():
              continue
          if not _is_within(root_real, proj_entry.path):
              continue
          models: list[dict] = []
          for model_entry in sorted(os.scandir(proj_entry.path), key=lambda e: _natural_key(e.name)):
              if not model_entry.is_dir():
                  continue
              if not _is_within(root_real, model_entry.path):
                  continue
              versions = _list_versions(model_entry.path, root_real)
              if versions:
                  models.append({"model_id": model_entry.name, "versions": versions})
          if models:
              projects.append({"project_id": proj_entry.name, "models": models})
      payload["projects"] = projects
      return payload
  ```

- [ ] 掛進 app。在 `governance-service/app.py` 既有 `from bcf.api import router as bcf_router` / `app.include_router(bcf_router)` 區塊**之後**加入（沿用既有 noqa: E402 + include_router 模式）：

  ```python
  # A1 file-library browse（唯讀 local file-server 模擬層：storage/{projectId}/{modelId}/*.ifc 樹）。
  from file_library.api import router as file_library_router  # noqa: E402

  app.include_router(file_library_router)
  ```

- [ ] 跑測試確認 green。執行：

  ```bash
  "/c/Program Files/Python312/python.exe" -m pytest governance-service/tests/test_file_library.py -v
  ```

  預期：`test_tree_lists_two_level_ifc_only`、`test_top_level_loose_files_excluded`、`test_version_sort_natural_with_completion_last`、`test_missing_root_returns_empty_200` PASS；`test_symlink_escape_excluded` 在 Windows local SKIP（CI/POSIX PASS）。全綠或 4 passed 1 skipped。

- [ ] 回歸：確認沒弄壞既有 governance-service 測試（app.py 改動可能影響 import）。執行：

  ```bash
  "/c/Program Files/Python312/python.exe" -m pytest governance-service/tests/ -q
  ```

  預期：既有測試全數仍 PASS（新增為加法）。

- [ ] commit。執行：

  ```bash
  git -C "C:/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source" add governance-service/file_library/__init__.py governance-service/file_library/api.py governance-service/app.py governance-service/tests/test_file_library.py
  git -C "C:/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source" diff --cached --check
  git -C "C:/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source" commit -m "feat(governance): file_library 唯讀 tree API（storage 兩層 IFC 結構）

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

  預期：`diff --cached --check` 無輸出（無 trailing whitespace），commit 成功。

---

## Task 2: coordinator governanceProxy 白名單一條

在 `governanceProxy.ts` 的 `registerGovernanceProxy()` 內新增 `GET /api/governance/files/tree` → 透傳 governance-service `GET /api/files/tree`。照既有 `forward()` helper 模式，不改其他路由。

**Files:**
- Modify: `bim-review-coordinator/src/routes/governanceProxy.ts`（`registerGovernanceProxy` 內加一條 `app.get`）
- Test: `bim-review-coordinator/tests/governance-files-tree.test.ts`

**Steps:**

- [ ] 先寫失敗測試（TDD red）。寫入 `bim-review-coordinator/tests/governance-files-tree.test.ts`：

  ```typescript
  import fs from "node:fs";
  import http from "node:http";
  import os from "node:os";
  import path from "node:path";
  import { type AddressInfo } from "node:net";
  import request from "supertest";
  import { afterEach, beforeEach, describe, expect, it } from "vitest";
  import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
  import type { CoordinatorConfig } from "../src/config.js";

  // GET /api/governance/files/tree：coordinator 逐 endpoint 白名單透傳 governance-service
  // GET /api/files/tree（瀏覽器只打 :8004，不直連 governance loopback）。誠實：governance
  // 不可達回 502（forward helper 既有行為），不偽造資料。

  let active: CoordinatorApp | null = null;
  let governanceStub: http.Server | null = null;
  let savedGovBase: string | undefined;

  beforeEach(() => {
    savedGovBase = process.env.GOVERNANCE_API_BASE;
  });

  afterEach(async () => {
    if (active) {
      active.io.close();
      await new Promise<void>((resolve) => active?.server.close(() => resolve()));
      active = null;
    }
    if (governanceStub) {
      await new Promise<void>((resolve) => governanceStub?.close(() => resolve()));
      governanceStub = null;
    }
    if (savedGovBase === undefined) {
      delete process.env.GOVERNANCE_API_BASE;
    } else {
      process.env.GOVERNANCE_API_BASE = savedGovBase;
    }
  });

  function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-files-tree-test-"));
    active = createCoordinatorApp({
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      storageRoot: path.join(root, "storage"),
      storageHostRoot: path.join(root, "storage"),
      corsOrigins: ["http://127.0.0.1:5173"],
      conversionPollEnabled: false,
      ...overrides,
    });
    return active;
  }

  async function startGovernanceTreeStub(): Promise<{ baseUrl: string; urls: string[] }> {
    const urls: string[] = [];
    const tree = {
      root: "C:/Repos/active/iot/AI-BIM-governance/storage",
      source_kind: "local_fs",
      projects: [
        {
          project_id: "270",
          models: [
            { model_id: "機電", versions: [{ name: "ver 竣工.ifc", path: "C:/x/ver 竣工.ifc", size_bytes: 22618, mtime: "2026-06-10T17:17:00+08:00" }] },
          ],
        },
      ],
    };
    governanceStub = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/api/files/tree") {
        urls.push(req.url);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(tree));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "not found" }));
    });
    await new Promise<void>((resolve) => governanceStub?.listen(0, "127.0.0.1", () => resolve()));
    const address = governanceStub.address() as AddressInfo;
    return { baseUrl: `http://127.0.0.1:${address.port}`, urls };
  }

  describe("GET /api/governance/files/tree", () => {
    it("透傳 governance-service /api/files/tree 並回原樣樹 JSON", async () => {
      const gov = await startGovernanceTreeStub();
      process.env.GOVERNANCE_API_BASE = gov.baseUrl;
      const app = makeApp();

      const res = await request(app.app).get("/api/governance/files/tree");

      expect(res.status).toBe(200);
      expect(res.body.source_kind).toBe("local_fs");
      expect(res.body.projects[0].project_id).toBe("270");
      expect(res.body.projects[0].models[0].versions[0].name).toBe("ver 竣工.ifc");
      expect(gov.urls).toEqual(["/api/files/tree"]);
    });

    it("governance-service 不可達 → 502（誠實，不偽造）", async () => {
      process.env.GOVERNANCE_API_BASE = "http://127.0.0.1:1";
      const app = makeApp();
      const res = await request(app.app).get("/api/governance/files/tree");
      expect(res.status).toBe(502);
      expect(typeof res.body.detail).toBe("string");
    });
  });
  ```

- [ ] 跑測試確認 red。執行：

  ```bash
  cd /c/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source/bim-review-coordinator && npm test -- governance-files-tree
  ```

  預期：第一個 it FAIL（route 未註冊 → 404，`gov.urls` 為空）。

- [ ] 最小實作。在 `bim-review-coordinator/src/routes/governanceProxy.ts` 的 `registerGovernanceProxy()` 內，既有 `app.post("/api/governance/rule-runs", ...)`（約 L91）**之前**或 `// A2 model-version diff proxy` 區塊**之前**插入：

  ```typescript
  // A1 file-library browse proxy（唯讀 local file-server tree，透傳 governance-service /api/files/tree）。
  // 瀏覽器只打 :8004；樹 JSON 原樣透傳，coordinator 不解讀 / 不保存。
  app.get("/api/governance/files/tree", (_request, response) => {
    void forward(response, "GET", "/api/files/tree");
  });
  ```

- [ ] 跑測試確認 green。執行：

  ```bash
  cd /c/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source/bim-review-coordinator && npm test -- governance-files-tree
  ```

  預期：兩個 it 皆 PASS（透傳 200 + 502 誠實）。

- [ ] commit。執行：

  ```bash
  git -C "C:/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source" add bim-review-coordinator/src/routes/governanceProxy.ts bim-review-coordinator/tests/governance-files-tree.test.ts
  git -C "C:/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source" diff --cached --check
  git -C "C:/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source" commit -m "feat(coordinator): governance proxy 加 files/tree 白名單一條

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

  預期：commit 成功。

---

## Task 3: governanceClient.filesTree() client method + 型別

在 `governanceClient.ts` 加 `filesTree()`（走 `/api/governance/files/tree`）與 `FilesTreeResponse` 型別樹，供 `MinioDataPage`/`IssuesRuleCenterPage` 共用。

**Files:**
- Modify: `web-viewer-sample/src/console/governanceClient.ts`（`governanceClient` 物件加 method + export interface）
- Test: `web-viewer-sample/src/console/governanceClient.test.ts`

**Steps:**

- [ ] 先寫失敗測試（TDD red），用 mock `fetch` 驗 client 打對 path 並解析回傳。寫入 `web-viewer-sample/src/console/governanceClient.test.ts`：

  ```typescript
  // governanceClient.filesTree()：驗證打 /api/governance/files/tree（coordinator proxy）並回傳樹。
  import { afterEach, describe, expect, it, vi } from "vitest";
  import { governanceClient } from "./governanceClient";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("governanceClient.filesTree", () => {
    it("GET /api/governance/files/tree 並回傳解析後的樹", async () => {
      const tree = {
        root: "C:/Repos/active/iot/AI-BIM-governance/storage",
        source_kind: "local_fs",
        projects: [
          {
            project_id: "270",
            models: [
              { model_id: "機電", versions: [{ name: "ver 竣工.ifc", path: "C:/x/ver 竣工.ifc", size_bytes: 22618, mtime: "2026-06-10T17:17:00+08:00" }] },
            ],
          },
        ],
      };
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(tree), { status: 200, headers: { "Content-Type": "application/json" } }),
      );

      const result = await governanceClient.filesTree();

      expect(spy).toHaveBeenCalledTimes(1);
      const calledUrl = String(spy.mock.calls[0][0]);
      expect(calledUrl).toContain("/api/governance/files/tree");
      expect(result.source_kind).toBe("local_fs");
      expect(result.projects[0].project_id).toBe("270");
      expect(result.projects[0].models[0].versions[0].name).toBe("ver 竣工.ifc");
    });

    it("proxy 回非 2xx → 拋錯（誠實，不吞）", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 502 }));
      await expect(governanceClient.filesTree()).rejects.toThrow();
    });
  });
  ```

- [ ] 跑測試確認 red。執行：

  ```bash
  cd /c/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source/web-viewer-sample && npm test -- governanceClient
  ```

  預期：`filesTree is not a function` 類型錯誤，FAIL。

- [ ] 最小實作。在 `web-viewer-sample/src/console/governanceClient.ts` 的 `governanceClient` 物件內（建議放在 `base:` 之後、`createRuleRun` 之前，或任一處）加入 method：

  ```typescript
    // A1 file-library browse：唯讀 local file-server tree（storage/{projectId}/{modelId}/*.ifc）。
    // 經 coordinator :8004 proxy → governance-service /api/files/tree。source_kind 為誠實標記
    // （local_fs；未來真 MinIO 接上改 s3）。
    filesTree: () => jsonFetch<FilesTreeResponse>("/api/governance/files/tree"),
  ```

  並在檔案末端（既有 `export interface FederatedBuildResult { ... }` 之後）加入型別樹：

  ```typescript
  export interface FileVersionRow {
    name: string;
    path: string; // 絕對路徑，給 rule-run ifc_source_path 用
    size_bytes: number;
    mtime: string; // ISO8601
  }
  export interface FileModelRow {
    model_id: string;
    versions: FileVersionRow[];
  }
  export interface FileProjectRow {
    project_id: string;
    models: FileModelRow[];
  }
  export interface FilesTreeResponse {
    root: string;
    source_kind: "local_fs" | "s3"; // 誠實標記：目前 local_fs；未來真 MinIO 改 s3
    projects: FileProjectRow[];
  }
  ```

- [ ] 跑測試確認 green。執行：

  ```bash
  cd /c/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source/web-viewer-sample && npm test -- governanceClient
  ```

  預期：兩個 it 皆 PASS。

- [ ] commit。執行：

  ```bash
  git -C "C:/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source" add web-viewer-sample/src/console/governanceClient.ts web-viewer-sample/src/console/governanceClient.test.ts
  git -C "C:/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source" diff --cached --check
  git -C "C:/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source" commit -m "feat(viewer): governanceClient.filesTree() + FilesTreeResponse 型別

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

  預期：commit 成功。

---

## Task 4: MinioDataPage 接真資料 + IssuesRuleCenterPage 檔案庫選擇器 + vitest

`MinioDataPage` 載入時呼叫 `filesTree()` 顯示真實樹（三態 loading/error/empty），原 bucket layout 縮為 `prov="demo"` 說明 Panel，`model.usdc` 仍標 `p1`。`IssuesRuleCenterPage` 新增「從檔案庫選擇」三層 `<select>`（project→model→version），選定後填入既有 `ifcPath`，手動輸入保留。前端 render 測試加 case。

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`MinioDataPage` @ L379、`IssuesRuleCenterPage` @ L467；檔頭 import 補 `useEffect`/`useState`/`governanceClient`/`FilesTreeResponse`/`FileProjectRow` 若未具備）
- Test: `web-viewer-sample/src/console/console.test.tsx`（加 MinioDataPage / A1 選擇器 render case）

**Steps:**

- [ ] 確認 `pages.tsx` 檔頭 import。讀檔頭（L1-L14 區），確認 React hooks 與 client 已 import；若缺則補（既有已 import `useState`/`useCallback`/`governanceClient`/`RuleRunStatus` 等；本 task 需 `useEffect` 與 `FilesTreeResponse`、`FileProjectRow` 型別）。在既有 governanceClient import 行加上型別：

  ```typescript
  import { governanceClient, type RuleRunStatus, type RuleResultRow, type IssueRow, type FilesTreeResponse, type FileProjectRow } from "./governanceClient";
  ```

  （以實際既有 import 行為準，只補缺的具名 export；`useEffect` 同理加進既有 `from "react"` 具名 import。）

- [ ] 先寫失敗測試（TDD red）。在 `web-viewer-sample/src/console/console.test.tsx` 的 `describe("edge console honesty smoke", ...)` 內加入兩個 it（`renderToString` 在無 fetch 環境下會走 loading 態，斷言誠實 UI 與 provenance 標記，不需網路）：

  ```typescript
    it("MinioData 接真檔案庫 API（loading 態 + 誠實 local_fs 文案 + usdc 仍 p1）", () => {
      const html = renderToString(<MinioDataPage />);
      // 載入態可見（renderToString 首幀無 fetch 結果 → loading）。
      expect(html).toContain("載入");
      // 誠實標記：local file-server 來源（比照 bim-control 規約）；真 S3/MinIO 待接。
      expect(html).toContain("local file-server");
      expect(html).toContain("bim-control");
      // bucket layout 規約示意仍標 demo（規約示意非實況）。
      expect(html).toContain("示範資料"); // PROV_LABEL.demo
      // model.usdc 轉檔產物仍 p1，不因本 spec 翻綠。
      expect(html).toContain("model.usdc");
      expect(html).toContain("後端待建 · P1"); // PROV_LABEL.p1
      // 無願景假數字。
      expect(html).not.toContain("99.1%");
    });

    it("A1 Rule Center 新增『從檔案庫選擇』三層選擇器（手動輸入保留）", () => {
      const html = renderToString(<IssuesRuleCenterPage />);
      // 檔案庫選擇器標題/說明可見。
      expect(html).toContain("從檔案庫選擇");
      // 三層選擇 select 存在（project / model / version）。
      expect(html).toContain("data-testid=\"a1-fs-project\"");
      expect(html).toContain("data-testid=\"a1-fs-model\"");
      expect(html).toContain("data-testid=\"a1-fs-version\"");
      // 既有手動輸入框與預設 fixture 仍在（向後相容 a1-real-ifc-slice E2E）。
      expect(html).toContain("fixture-bytes.ifc");
      expect(html).toContain("執行規則檢核");
      // live-run 記分板用獨立 data-testid 包裹（讓 E2E 能只斷言「真 run 後出現的區塊」，
      // 不被恆顯的 artifact-baseline / A1 workbench 記分板誤判通過）。renderToString 首幀
      // run=null → 此區塊不渲染，故 smoke 斷言「不存在」即可確認 gating 正確。
      expect(html).not.toContain("data-testid=\"a1-rulerun-scoreboard\"");
    });
  ```

- [ ] 跑測試確認 red。執行：

  ```bash
  cd /c/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source/web-viewer-sample && npm test -- console.test
  ```

  預期：新增兩個 it FAIL（頁面尚無檔案庫文案 / select）。

- [ ] 實作 `MinioDataPage`（替換 `web-viewer-sample/src/console/pages.tsx` 既有 `export function MinioDataPage() { ... }` 整段，L379-L409）。新版載入真實樹 + 三態 + 縮小 bucket layout 為 demo Panel：

  ```typescript
  export function MinioDataPage() {
    const [tree, setTree] = useState<FilesTreeResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
      let alive = true;
      governanceClient
        .filesTree()
        .then((t) => {
          if (alive) {
            setTree(t);
            setLoading(false);
          }
        })
        .catch((e) => {
          if (alive) {
            setErr(String(e));
            setLoading(false);
          }
        });
      return () => {
        alive = false;
      };
    }, []);

    const projectCount = tree?.projects.length ?? 0;

    return (
      <>
        <h1>MinIO 資料</h1>
        <p className="ec-lead">
          資料頁讓 operator 看懂 project / model / version / files 關係；它不是完整 S3 browser。
          目前為 local file-server 來源（比照 <code>bim-control/{"{projectId}"}/{"{modelId}"}</code> 規約）；真 S3/MinIO 待接。
        </p>

        <Panel
          title="檔案庫 · file library（真實樹）"
          sub={tree ? `source_kind=${tree.source_kind} · root=${tree.root}` : "local file-server 來源（比照 bim-control 規約）；真 S3/MinIO 待接"}
          prov="asbuilt"
        >
          {loading && <p className="ec-note">載入中…（GET /api/governance/files/tree）</p>}
          {err && <p className="ec-warn-note">未連線後端（coordinator / governance-service 需啟動）：{err}</p>}
          {!loading && !err && projectCount === 0 && (
            <p className="ec-note">檔案庫為空：未在 root 下找到 <code>{"{projectId}"}/{"{modelId}"}/*.ifc</code> 兩層結構（檢查 BIM_FILE_LIBRARY_ROOT）。</p>
          )}
          {tree && projectCount > 0 && (
            <div className="ec-tree">
              {tree.projects.map((p) => (
                <div key={p.project_id}>
                  <div><span className="ec-tree-file">{p.project_id}/</span> <ProvTag prov="asbuilt" /></div>
                  {p.models.map((m) => (
                    <div className="indent" key={m.model_id}>
                      <div>{m.model_id}/</div>
                      {m.versions.map((v) => (
                        <div className="indent two" key={v.name}>
                          <span className="ec-tree-file">{v.name}</span>{" "}
                          <span className="ec-note">{(v.size_bytes / 1024).toFixed(1)} KB · {v.mtime}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Bucket layout（規約示意）" sub="bim-control private bucket · project/model/version/files（示意，非實況）" prov="demo">
          <div className="ec-tree">
            <div>bim-control/</div>
            <div className="indent">{"{projectId}"}/</div>
            <div className="indent two">{"{modelId}"}/version/files/</div>
            <div className="indent three"><span className="ec-tree-file">model.usdc</span> <span className="ec-note">expected generated output after conversion</span> <ProvTag prov="p1" /></div>
          </div>
          <p className="ec-note">此 Panel 為 MinIO bucket 規約示意（示範資料）；<code>model.usdc</code> 為轉檔產物，後端待建（p1），不因本頁翻綠。</p>
        </Panel>

        <Panel title="與功能頁的關係" prov="asbuilt">
          <Field k="A1" v="rule-run 讀檔案庫選定的 IFC（version.path → ifc_source_path）" prov="asbuilt" />
          <Field k="A2" v="versions / diff compare 需要版本路徑與 model_version_id" prov="asbuilt" />
          <Field k="A3" v="federation 需要多專業 USD layer / stage paths" prov="asbuilt" />
          <Field k="3D Viewer" v="openStage 使用 generated model.usdc / model.usd URL" prov="asbuilt" />
        </Panel>
      </>
    );
  }
  ```

- [ ] 實作 `IssuesRuleCenterPage` 檔案庫選擇器。在 `web-viewer-sample/src/console/pages.tsx` 既有 `IssuesRuleCenterPage` 內，於既有 state 宣告區（`const [issues, setIssues] = ...` 之後）加入選擇器 state 與載入：

  ```typescript
    // A1 檔案庫選擇器：project → model → version 三層；選定填入 ifcPath（手動輸入保留）。
    const [fsTree, setFsTree] = useState<FileProjectRow[] | null>(null);
    const [fsErr, setFsErr] = useState<string | null>(null);
    const [selProject, setSelProject] = useState("");
    const [selModel, setSelModel] = useState("");

    useEffect(() => {
      let alive = true;
      governanceClient
        .filesTree()
        .then((t) => alive && setFsTree(t.projects))
        .catch((e) => alive && setFsErr(String(e)));
      return () => {
        alive = false;
      };
    }, []);

    const fsModels = fsTree?.find((p) => p.project_id === selProject)?.models ?? [];
    const fsVersions = fsModels.find((m) => m.model_id === selModel)?.versions ?? [];
  ```

  並在既有「rule-run authority」Panel 內、手動輸入框（`<input ... value={ifcPath} ...>`）**之前**插入選擇器 UI（檔案庫不可用時 graceful degrade，手動輸入照常）：

  ```typescript
        <div className="ec-field" style={{ flexDirection: "column", alignItems: "stretch", gap: 6, marginBottom: 8 }}>
          <span className="ec-k">從檔案庫選擇 <ProvTag prov="asbuilt" /></span>
          {fsErr && <span className="ec-warn-note">檔案庫不可用（{fsErr}）；可改用下方手動輸入路徑。</span>}
          {!fsErr && !fsTree && <span className="ec-s">載入檔案庫中…（GET /api/governance/files/tree）</span>}
          {fsTree && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select
                data-testid="a1-fs-project"
                className="ec-btn"
                value={selProject}
                onChange={(e) => { setSelProject(e.target.value); setSelModel(""); }}
              >
                <option value="">專案…</option>
                {fsTree.map((p) => <option key={p.project_id} value={p.project_id}>{p.project_id}</option>)}
              </select>
              <select
                data-testid="a1-fs-model"
                className="ec-btn"
                value={selModel}
                disabled={!selProject}
                onChange={(e) => setSelModel(e.target.value)}
              >
                <option value="">模型…</option>
                {fsModels.map((m) => <option key={m.model_id} value={m.model_id}>{m.model_id}</option>)}
              </select>
              <select
                data-testid="a1-fs-version"
                className="ec-btn"
                disabled={!selModel}
                value=""
                onChange={(e) => { if (e.target.value) setIfcPath(e.target.value); }}
              >
                <option value="">版本…（選定填入路徑）</option>
                {fsVersions.map((v) => <option key={v.name} value={v.path}>{v.name}</option>)}
              </select>
            </div>
          )}
        </div>
  ```

- [ ] 替 live-run 記分板加 `data-testid`（**這是 Task 5 E2E 能分辨「真 run 結果 vs baked baseline」的關鍵**）。在 `web-viewer-sample/src/console/pages.tsx` 既有 `IssuesRuleCenterPage` 內，找到只在成功 run 後才渲染的 `{run && (...)}` 記分板區塊（現況約 L530-537，內含 `<Metric ... label="評估構件" />` … `<Metric value={run.score ...} label="score" />`），把它外層 `<div className="ec-grid" style={{ marginTop: 12 }}>` 加上 `data-testid="a1-rulerun-scoreboard"`。改成：

  ```typescript
        {run && (
          <div className="ec-grid" data-testid="a1-rulerun-scoreboard" style={{ marginTop: 12 }}>
            <Metric value={run.summary?.total ?? "—"} label="評估構件" />
            <Metric value={run.summary?.passed ?? "—"} label="passed" />
            <Metric value={run.summary?.failed ?? "—"} label="failed" tone="warn" />
            <Metric value={run.score ?? "—"} label="score" />
          </div>
        )}
  ```

  說明：頁面同時存在兩個恆顯記分板（A1 workbench L210-216「結果記分板」、IssuesRuleCenterPage L582-588「語意驗收訊號 · 真實 IFC 實測」artifact baseline），兩者都帶 `label="score"` 且永遠渲染；只有這個 `{run && ...}` 區塊是「按下執行規則檢核、後端真的回 succeeded 後」才出現。Task 5 E2E 必須斷言**這個 testid**，而非 `getByText("評估構件"/"score")`，否則永遠假綠（baked panel 會滿足斷言）且觸發 Playwright strict-mode（同名文字多重命中）。此步**不得跳過**。

- [ ] 跑測試確認 green。執行：

  ```bash
  cd /c/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source/web-viewer-sample && npm test -- console.test
  ```

  預期：新增兩個 it PASS；既有 console.test smoke 全數仍 PASS（含 L40 `A1 顯示 7126 實測 artifact`、L51 匯出 Excel 等——選擇器為加法不破壞）。

- [ ] 型別/建置檢查（確認 import 與 JSX 正確）。執行：

  ```bash
  cd /c/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source/web-viewer-sample && npm run build
  ```

  預期：tsc + vite build 成功，無型別錯誤。

- [ ] commit。執行：

  ```bash
  git -C "C:/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source" add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/console.test.tsx
  git -C "C:/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source" diff --cached --check
  git -C "C:/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source" commit -m "feat(viewer): #/minio 接真檔案庫樹 + #/a1 三層選擇器（手動輸入保留）

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

  預期：commit 成功。

---

## Task 5: Browser E2E（Playwright，P4 硬 gate）

驗 vertical slice：`#/minio` 真樹可見 270/889/990；`#/a1` 由選擇器選 `270/機電/ver 竣工.ifc` → 跑 rule-run → 檢核結果出現。截圖 + trace 落 `artifacts/e2e/minio-fileserver-source-*`。

**前置（指揮官手動，非 workflow 自啟；spec §8）：** 三件事缺一不可——(A) 重建前端 console dist、(B) 啟動 governance-service 並指好檔案庫 root、(C) 啟動 coordinator 並把 `/ui` 指到新 dist。

**(A) 重建前端 console dist（關鍵；漏掉會打到陳舊 console、新 UI 元素永遠 FAIL）。** 本 plan 改的 `MinioDataPage`/`IssuesRuleCenterPage` 屬前端 console；coordinator `/ui` 服務的是**預先建置的靜態 dist**（實證 `bim-review-coordinator/src/app.ts` L1937 `express.static(consoleDist)`，`consoleDist=CONSOLE_DIST_DIR`；未設則 fallback 成 `dev-console.html`，新元件根本不存在）。Task 4 改完 source 後**必須**重建 `dist-ui`，否則 E2E beforeEach 的 API 守門會過（governance+proxy 起來即過），但接著斷言 `getByTestId("a1-fs-project")` 等新 UI 會直接 FAIL（這是本專案記載的 #1 陷阱「改 console 須 build:ui + 重啟 coordinator」「打到陳舊容器=改了沒效假象」）。兩條等價路徑擇一：

  - **路徑 1（dev，最短）：** 在 worktree 內重建 dist-ui 並讓 coordinator 指過去：

    ```powershell
    cd "C:\Repos\active\iot\AI-BIM-governance\.worktrees\minio-fileserver-source\web-viewer-sample"
    npm run build:ui   # 輸出 dist-ui（--base=/ui/ --outDir dist-ui，已存在於 package.json scripts）
    # 啟動 coordinator 時設此 env（見 (C)）：
    $env:CONSOLE_DIST_DIR = "C:\Repos\active\iot\AI-BIM-governance\.worktrees\minio-fileserver-source\web-viewer-sample\dist-ui"
    ```

  - **路徑 2（golden path，測試部署區）：** 走 `.\scripts\dev\rebuild-test-deploy.ps1 -Build` 從 freshly fetched `origin/main` 重建部署區（Docker image build 階段內含 `npm run build:ui` → `/workspace/console-dist`，`CONSOLE_DIST_DIR` 由 compose 設好），再對該部署區跑 E2E。此路徑須先把本 branch merge 或部署區指向本 branch。

  注意：`npm run build`（Task 4 既有型別/建置檢查那條）跑的是 viewer 主 bundle，**不等於** `build:ui`（console dist）；兩者輸出不同目錄，必須各自跑。

**(B) 啟動 governance-service 並把 `BIM_FILE_LIBRARY_ROOT` 指到主 worktree 的真實 storage**（worktree 自身無 fixtures，見上方 BLOCKER 段）：

```powershell
$env:BIM_FILE_LIBRARY_ROOT = "C:\Repos\active\iot\AI-BIM-governance\storage"
$env:GOV_PORT = "49102"
& "C:\Program Files\Python312\python.exe" "C:\Repos\active\iot\AI-BIM-governance\.worktrees\minio-fileserver-source\governance-service\app.py"
```

**(C) 啟動/重啟 coordinator `:8004`**，使其 `CONSOLE_DIST_DIR` 指向 (A) 重建的 `dist-ui`（dev 路徑），或走 golden path `scripts/deploy.ps1`（部署區路徑，dist 由 Docker image 內建）。**改 console 後務必重啟 coordinator**，讓新 dist 生效。E2E 用 `E2E_COORDINATOR_BASE_URL`（預設 `http://127.0.0.1:8004`）連 coordinator。

> 自我驗證（跑 E2E 前先確認 (A)+(C) 真生效，避免打到陳舊 console）：`curl http://127.0.0.1:8004/ui/#/minio` 後檢查回的 `index.html` 是 Vite shell（含 `/ui/assets/*` bundle 連結）而非 legacy `Review Coordinator` dev-console；或直接看 E2E 第一個斷言 `getByTestId("a1-fs-project")` 是否找得到。

**Files:**
- Create: `web-viewer-sample/e2e/minio-fileserver-source.spec.ts`

**Steps:**

- [ ] 寫 E2E spec（先驗 `#/minio` 真樹，再驗 `#/a1` 選擇器 → rule-run）。寫入 `web-viewer-sample/e2e/minio-fileserver-source.spec.ts`：

  ```typescript
  import { test, expect } from "@playwright/test";

  // MinIO file-server source（storage/{270,889,990}/{機電,水電,消防}/*.ifc）端到端：
  // #/minio 真樹可見三專案；#/a1 由選擇器選 270/機電/ver 竣工.ifc → rule-run → 檢核結果出現。
  // 需 coordinator :8004 + governance-service :49102（BIM_FILE_LIBRARY_ROOT 指主 worktree storage）。
  // 前置不滿足時 conditional skip（誠實：不假裝跑過）。
  const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

  test.describe("MinIO file-server source 端到端", () => {
    test.setTimeout(180_000);

    test.beforeEach(async ({ request }) => {
      // 前置守門：files/tree 必須回 270/889/990，否則 skip（環境未備妥）。
      let ok = false;
      try {
        const res = await request.get(`${COORDINATOR}/api/governance/files/tree`);
        if (res.ok()) {
          const body = await res.json();
          const ids = new Set((body.projects || []).map((p: { project_id: string }) => p.project_id));
          ok = ["270", "889", "990"].every((id) => ids.has(id));
        }
      } catch {
        ok = false;
      }
      test.skip(!ok, "檔案庫未備妥（需 governance-service + BIM_FILE_LIBRARY_ROOT 指主 worktree storage 含 270/889/990）");
    });

    test("#/minio 真樹可見 270/889/990 三專案與版本檔", async ({ page }) => {
      await page.goto(`${COORDINATOR}/ui/?route=minio`);
      // EdgeConsole 以 hash route 切頁；直接導 hash 確保到 minio 頁。
      await page.goto(`${COORDINATOR}/ui/#/minio`);

      // 檔案庫 Panel 載入真樹後，三個 project_id 應可見。
      // 注意：getByText 可能在頁面多處命中（樹節點 + 其他文案）→ 一律 .first() 避免
      // Playwright strict-mode（locator 解析到 >1 element 時 toBeVisible 會直接拋錯而非判可見）。
      // 樹節點實作為 <span className="ec-tree-file">{project_id}/</span>，故用 main .ec-tree 收斂範圍 + .first()。
      const tree = page.locator("main .ec-tree");
      await expect(tree.getByText("270/", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
      await expect(tree.getByText("889/", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
      await expect(tree.getByText("990/", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
      // 誠實標記：local file-server 文案存在（lead 段 + Panel 副標可能多重命中 → .first()）。
      await expect(page.getByText("local file-server", { exact: false }).first()).toBeVisible();
      // 版本檔（竣工）可見（多專案/多模型下「ver 竣工.ifc」會多重命中 → .first()）。
      await expect(tree.getByText("ver 竣工.ifc", { exact: false }).first()).toBeVisible({ timeout: 30_000 });

      await page.screenshot({ path: "../artifacts/e2e/minio-fileserver-source-minio-tree.png", fullPage: true });
    });

    test("#/a1 選擇器選 270/機電/ver 竣工.ifc → rule-run → 檢核結果出現", async ({ page }) => {
      await page.goto(`${COORDINATOR}/ui/#/a1`);

      // #/a1 是 A1GovernanceWorkbenchPage，內嵌兩個 a1-* slice（a1-real-ifc-slice +
      // a1-rule-center-slice）。選擇器與 live-run 記分板都在 a1-rule-center-slice 內，
      // 用 section 收斂範圍，避免與 a1-real-ifc-slice 的同名元素/文案衝突（strict-mode）。
      const ruleCenter = page.getByTestId("a1-rule-center-slice");

      // 三層選擇器可見並依序選擇。
      const projectSel = ruleCenter.getByTestId("a1-fs-project");
      await expect(projectSel).toBeVisible({ timeout: 30_000 });
      await projectSel.selectOption("270");
      await ruleCenter.getByTestId("a1-fs-model").selectOption("機電");
      // version 的 value 是絕對路徑；用 label（檔名）選。
      await ruleCenter.getByTestId("a1-fs-version").selectOption({ label: "ver 竣工.ifc" });

      // 選定後 ifcPath 受控輸入框應被填入該檔絕對路徑（controlled input → 讀 inputValue()，
      // 不靠 [value=...] attribute selector；React controlled input 不一定反映 value attribute）。
      // rule-run authority Panel 的第一個 <input> 即 ifcPath 框（見 pages.tsx L520）。
      const ifcInput = ruleCenter.locator("input").first();
      await expect(ifcInput).toHaveValue(/ver 竣工\.ifc$/, { timeout: 10_000 });

      // 跑 rule-run（rule-run authority Panel 內的「執行規則檢核」按鈕）。
      await ruleCenter.getByRole("button", { name: /執行規則檢核/ }).click();

      // *** 關鍵硬 gate：只斷言 live-run 記分板（data-testid="a1-rulerun-scoreboard"），
      //     此區塊僅在後端真的回 succeeded（run!=null）後才渲染（pages.tsx `{run && (...)}`）。
      //     絕對不可改用 getByText("評估構件"/"score")：頁面有兩個恆顯記分板（A1 workbench
      //     L210-216 + artifact baseline L582-588）都帶這些 label，會讓斷言永遠假綠且觸發
      //     strict-mode 多重命中。a1-rulerun-scoreboard 是「真 run vs baked baseline」的唯一判別。 ***
      const liveScoreboard = ruleCenter.getByTestId("a1-rulerun-scoreboard");
      await expect(liveScoreboard).toBeVisible({ timeout: 120_000 });
      // 區塊內含 score 指標 → 確認真結果而非空殼。
      await expect(liveScoreboard.getByText("score", { exact: false })).toBeVisible();
      // rule_run_status 翻成 succeeded（誠實：真的跑完，非只是出現空表）。
      await expect(ruleCenter.getByText("succeeded", { exact: false }).first()).toBeVisible({ timeout: 120_000 });

      await page.screenshot({ path: "../artifacts/e2e/minio-fileserver-source-a1-rulerun.png", fullPage: true });
    });
  });
  ```

  注意（**整段斷言的設計鐵律，執行者不得擅改弱化**）：
  - **硬 gate 必須是 `getByTestId("a1-rulerun-scoreboard")`**，因為 #/a1 同時渲染三組記分板：A1 workbench「結果記分板」（pages.tsx L210-216，恆顯，baked `A1_EVIDENCE`）、IssuesRuleCenterPage「語意驗收訊號·真實 IFC 實測」artifact baseline（L582-588，恆顯，baked），以及只有真 run 後才出現的 `{run && (...)}` 區塊（L530-537）。前兩者都帶 `label="評估構件"`/`label="score"` 且永遠在 DOM → 用 `getByText("評估構件"/"score")` 當 gate 會**永遠通過（假綠）**且因多重命中觸發 **Playwright strict-mode 直接報錯**。故 Task 4 已要求替 `{run && ...}` 區塊加 `data-testid="a1-rulerun-scoreboard"`，此處只斷言該 testid。
  - **所有 `getByText` 一律 `.first()` 或用 section/`main .ec-tree` 收斂**（既有 `product-console-integration.spec.ts` L43-46、`issues-tab.spec` 都這樣做），否則同名文字多重命中會 crash。
  - **不得**把硬 gate 退回 `getByText`、不得移除「rule-run 真的跑出 live 記分板」這條斷言；若 controlled input 的 `toHaveValue` 在實機因故不穩，可改讀 `inputValue()` 比較字串，但**不得**改成只斷言「選了 version」就算過（那證明不了 rule-run 真的執行）。

- [ ] 跑 E2E（前置服務已由指揮官啟動）。執行：

  ```bash
  cd /c/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source/web-viewer-sample && npx playwright test minio-fileserver-source --reporter=list
  ```

  預期（前置備妥時）：兩個 test PASS，截圖落 `artifacts/e2e/minio-fileserver-source-*.png`，trace 落 `artifacts/e2e/_output`。前置未備妥時 SKIP（誠實，不假綠）——此時須回報「E2E skipped：環境未備妥」而非宣告通過。

- [ ] 回歸：確認既有 A1 E2E（a1-real-ifc-slice / 手動輸入流程）未壞。執行：

  ```bash
  cd /c/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source/web-viewer-sample && npx playwright test unified-console-routes --reporter=list
  ```

  預期：既有 console route E2E 仍 PASS（或依其既有 skip 條件 skip），手動輸入框 + 預設 fixture 未被選擇器破壞。

- [ ] commit。執行：

  ```bash
  git -C "C:/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source" add web-viewer-sample/e2e/minio-fileserver-source.spec.ts
  git -C "C:/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source" diff --cached --check
  git -C "C:/Repos/active/iot/AI-BIM-governance/.worktrees/minio-fileserver-source" commit -m "test(e2e): MinIO file-server source 端到端（#/minio 真樹 + #/a1 選擇器→rule-run）

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

  預期：commit 成功。E2E 截圖/trace 為 artifacts（依既有慣例只存抽樣，不 commit 大檔）。

---

## 完成回報（四項，依根目錄 CLAUDE.md）

1. 改了哪些 tracked files：`governance-service/file_library/{__init__,api}.py`、`governance-service/app.py`、`governance-service/tests/test_file_library.py`、`bim-review-coordinator/src/routes/governanceProxy.ts`、`bim-review-coordinator/tests/governance-files-tree.test.ts`、`web-viewer-sample/src/console/{governanceClient,pages}.tsx?`、`web-viewer-sample/src/console/{governanceClient,console}.test.tsx`、`web-viewer-sample/e2e/minio-fileserver-source.spec.ts`。
2. 執行了哪些最小驗證：governance-service pytest（file_library + 全量回歸）、coordinator vitest（files-tree proxy）、前端 vitest（governanceClient + console smoke）、`npm run build`、Playwright E2E（minio-fileserver-source + 回歸 unified-console-routes）。
3. 哪些測試沒跑以及原因：若 E2E 前置（governance-service + BIM_FILE_LIBRARY_ROOT 指主 worktree storage、coordinator :8004）未由指揮官備妥 → E2E SKIP，須誠實回報「not observed」而非通過。
4. 已知風險或既有問題：(a) worktree storage 無 fixtures，E2E 仰賴 env 指向主 worktree 絕對路徑（部署到測試區時 root 改 deploy 區 storage）；(b) Windows local symlink traversal 測試 SKIP（權限），traversal 防護仍由 `os.path.realpath` + `_is_within` 保障、CI/POSIX 驗證；(c) `source_kind="local_fs"` 是誠實標記，未來真 MinIO 接上須改 `"s3"` 並翻前端文案（spec §4.1 已載明，非本 spec 範疇）。
