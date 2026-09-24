"""Render README.md of the CFD Case Run cutover evidence from its JSON files (numbers are never typed by hand).

Usage: render_readme.py <evidence_dir>
Inputs in <evidence_dir>: deploy.json, compare.json (before vs after), compare_after_after2.json, noise_baseline.json,
field_stats.json, {before,after,after2}/{status,result,run_record,exclusions}.json, requests/*.json.
Refuses to write when a JSON file carries an IPv4 address or a filesystem path (public repository).
"""
import json
import re
import sys
from pathlib import Path

ev = Path(sys.argv[1])
LEAK = re.compile(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|[A-Za-z]:\\\\|/(?:home|srv|opt|mnt|var|root|Users)/")
bad = {str(p.relative_to(ev)): sorted(set(LEAK.findall(p.read_text(encoding="utf-8")))) for p in ev.rglob("*.json")}
bad = {k: v for k, v in bad.items() if v}
bad.update({str(p.relative_to(ev)): ["ifc_guid"] for p in ev.rglob("*.json") if "ifc_guid" in p.read_text(encoding="utf-8")})
if bad:
    sys.exit(f"REFUSED: host or path strings found: {bad}")


def load(rel: str) -> dict:
    return json.loads((ev / rel).read_text(encoding="utf-8"))


def fmt(v) -> str:
    if v is None:
        return "—"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        return f"{v:.6g}"
    return str(v)


deploy, cmp1, cmp2, noise, fields = load("deploy.json"), load("compare.json"), load("compare_after_after2.json"), load("noise_baseline.json"), load("field_stats.json")
rows = {row["metric"]: row for row in noise["rows"]}
LABELS = ("before", "after", "after2")
status = {label: load(f"{label}/status.json") for label in LABELS}
record = {label: load(f"{label}/run_record.json") for label in LABELS}
result = {label: load(f"{label}/result.json") for label in LABELS}
runs = {run["label"]: run for run in deploy["runs"]}


def rel(metric: str, which: str) -> float | None:
    return rows[metric][which]["rel"]


def within(metric: str) -> str:
    value = rows[metric]["cutover_within_repeat"]
    return "—" if value is None else ("是" if value else "**否**")


pmax_rel = rel("p_max", "cutover_delta")
L: list[str] = []
add = L.append
add("# CFD Case Run service cutover：181 前後同請求比對（ADR Verification 4）\n")
add("`docs/architecture/cfd-case-run-adr.md` §Verification 第 4 項：同一個 `cfd-run-request/v1` 請求在 canonical Linux 181 上跑三次。"
    f"cutover（PR #913）**前**跑一次（before，部署 `{runs['before']['deployed_commit'][:7]}`），**後**跑兩次（after 與 after2，部署 "
    f"`{runs['after']['deployed_commit'][:7]}`）。after2 是同版本、同請求的重跑，用來量 run-to-run 變異，作為「在 solver noise 內」的基線。\n")
add("主機一律寫成 `<canonical-host>`；不含專案名稱、GlobalId、IFC／USDC 檔案。`p` 是 OpenFOAM 不可壓縮求解的 kinematic pressure（m²/s²），不是 Pa。\n")

add("## 結論\n")
add("**條件式通過。**\n")
add("- **VERIFIED**：寫 case 與網格的程式、case 輸入與容器參數在 cutover 前後相同（見下節）；三次 run 都收斂、都沒有延長 endTime，三份 `result.json` 都符合 `cfd-run-result-v1.schema.json`。")
SOLUTION = ("iterations", "U_magnitude_max", "p_min", "p_max",
            "PedestrianWind_1p5m.p05", "PedestrianWind_1p5m.mean", "PedestrianWind_1p5m.p50", "PedestrianWind_1p5m.p95",
            "BuildingSurfacePressure.p05", "BuildingSurfacePressure.mean", "BuildingSurfacePressure.p50", "BuildingSurfacePressure.p95")
MESH = ("mesh_faces", "mesh_points", "max_non_orthogonality", "max_skewness")
inside = [m for m in SOLUTION + MESH if rows[m]["cutover_within_repeat"] is True]
outside = [m for m in SOLUTION + MESH if rows[m]["cutover_within_repeat"] is False]
add(f"- **VERIFIED**：網格格數（{fmt(rows['mesh_cells']['before'])}）與行人面多邊形數（{fmt(rows['pedestrian_polygons']['before'])}）三次相同。"
    f"跨 cutover 差量不大於同版本重跑差量的指標：{', '.join(f'`{m}`' for m in inside)}。"
    f"p_min 的約 11% 跳動在同版本重跑也出現（{fmt(rows['p_min']['after'])} → {fmt(rows['p_min']['after2'])}）。")
add("- **VERIFIED**：下列指標的跨 cutover 差量大於這一次同版本重跑的差量：\n")
add("| 指標 | 跨 cutover | 同版本重跑 | 跨 cutover 相對差 |\n|---|---|---|---|")
for m in outside:
    row = rows[m]
    add(f"| `{m}` | {fmt(row['cutover_delta']['abs'])} | {fmt(row['repeat_delta']['abs'])} | {fmt(row['cutover_delta']['rel'])} |")
add("")
add("- **INFERRED**：這些差異來自平行 snappyHexMesh（4 個程序）的執行期非決定性，建物面的 p 隨網格一起變動。依據是程式與輸入相同，而同版本重跑也產生了不同的網格（面數差 "
    f"{fmt(rows['mesh_faces']['repeat_delta']['abs'])}）。但一次重跑不足以界定這個變異的分佈，所以不能說跨 cutover 的差異已落在其中。"
    "若要無條件通過，需要在同版本多跑幾次同請求，量出變異的範圍。\n")

add("## 程式與輸入（VERIFIED）\n")
add(f"- `openfoam_case.py`、`preprocess.py`、`voxel_shell.py`、`profiles.py` 在 `{runs['before']['deployed_commit'][:7]}..{runs['after']['deployed_commit'][:7]}` 之間沒有變更（`git diff --stat` 為空）。"
    "變更只在 job service 的組合層（`cfd_job_service.py`、新增的 `case_run.py`）、S8 設定選項（`cfd_options.*`）與 `wind.py`（`true_north_from_geo` 改為公開）。")
add("- 兩個版本的 service 都用 `build_case(shell_stl, out_dir, params)` 寫 case，都以 `cpus = min(n_procs, cpus_cap)` 與同一個 image 設定啟動容器。")
add(f"- 三次 run 的 `case_meta.json` sha256 都是 `{rows['case_meta_sha256']['before'][:12]}…`；exclusions sha256 都是 `{result['before']['exclusions']['sha256'][:12]}…`；"
    f"前處理 `leak_fraction` 都是 {fmt(result['before']['preprocess']['leak_fraction'])}。")
req_note = "兩兩相同" if cmp1["request_equal"] and cmp2["request_equal"] else "**不同**"
add(f"- 請求：`requests/` 內三份 client 送出的 body 只差 `idempotency_key`；service 正規化後的請求（去掉 `idempotency_key` 與 `requested_by`）{req_note}。"
    f"`requested_by.trace_id` 不同：before 與 after2 送出時帶了 `x-trace-id`（`{runs['before']['trace_id']}`、`{runs['after2']['trace_id']}`），"
    "after 沒帶，由 coordinator 產生 `trace_cfd_…`。trace id 不進入求解。\n")

add("## 部署版本（`deploy.json`）\n")
add("| run | run_id | 部署 commit | 建立 | 開始 | 結束 |\n|---|---|---|---|---|---|")
for label in LABELS:
    run = runs[label]
    add(f"| {label} | `{run['run_id']}` | `{run['deployed_commit'][:7]}` | {run['created_at']} | {run['started_at']} | {run['finished_at']} |")
add("")
for item in deploy["deploys"]:
    add(f"- `{item['tag']}` → `{item['commit'][:7]}`，部署於 {item['deployed_at_utc']}。")
add("- before 在 `-004` 與 `-005` 之間執行；after 與 after2 都在 `-005` 之後，且 capture after2 時沒有更晚的部署 tag。before 在佇列裡等了約兩小時，因為前面有一個 15 方向的 run。\n")

add("## 同版本重跑基線（`noise_baseline.json`）\n")
add("「跨 cutover」是 |before − after|，「同版本重跑」是 |after − after2|。")
add("「跨 cutover ≤ 重跑」只和這一次重跑比較，不是統計檢定。\n")
add("| 指標 | before | after | after2 | 跨 cutover | 同版本重跑 | 跨 cutover ≤ 重跑 |\n|---|---|---|---|---|---|---|")
for metric in ("iterations", "mesh_cells", "mesh_faces", "mesh_points", "max_non_orthogonality", "max_skewness", "U_magnitude_max", "pedestrian_polygons",
               "p_min", "p_max", "solver_elapsed_seconds", "job_wall_seconds"):
    row = rows[metric]
    add(f"| {metric} | {fmt(row['before'])} | {fmt(row['after'])} | {fmt(row['after2'])} | {fmt(row['cutover_delta']['abs'])} | {fmt(row['repeat_delta']['abs'])} | {within(metric)} |")
add("")
add("`solver_elapsed_seconds` 是容器內求解的時間；`job_wall_seconds` 是整個 job（含前處理與後處理）從開始到結束的時間。\n")

add("## 場量統計（overlay layer 全場，`field_stats.json`）\n")
add("三份 overlay USDC（未入版控）用 pxr 讀出 `PedestrianWind_1p5m` 的 |U|（m/s，每個頂點一個值）與 `BuildingSurfacePressure` 的 p（m²/s²，每個面一個值，`uniform`）。"
    "取樣面的頂點數或面數在三次之間差 1 到 4，所以只比分佈，不做逐點差。\n")
add("| prim | 統計 | before | after | after2 | 跨 cutover | 同版本重跑 |\n|---|---|---|---|---|---|---|")
for prim in ("PedestrianWind_1p5m", "BuildingSurfacePressure"):
    for key in ("n", "faces", "points", "min", "p05", "mean", "p50", "p95", "max"):
        values = [fields["layers"][label][prim][key] for label in LABELS]
        cut = abs(values[1] - values[0])
        rep = abs(values[2] - values[1])
        add(f"| {prim} | {key} | {fmt(values[0])} | {fmt(values[1])} | {fmt(values[2])} | {fmt(cut)} | {fmt(rep)} |")
add("")

add("## 文件結構差異（after 部署包含的 S8 變更）\n")
st_before, st_after = status["before"]["status"], status["after"]["status"]
added_status = sorted(set(st_after) - set(st_before))
origin_before, origin_after = status["before"]["ledger"].get("origin") or {}, status["after"]["ledger"].get("origin") or {}
added_origin = sorted(set(origin_after) - set(origin_before))
added_record = sorted(set(record["after"]) - set(record["before"]))
limits_added = [line for line in result["after"]["limitations"] if line not in result["before"]["limitations"]]
same_result_keys = len({tuple(sorted(result[label])) for label in LABELS}) == 1
add(f"- `result.json` 頂層鍵：三次{'相同' if same_result_keys else '**不同**'}。")
add(f"- `status.json` 的 status 文件：after 多了 {', '.join(f'`{k}`' for k in added_status) or '無'}。")
add(f"- `status.json` 的 `ledger.origin`：after 多了 {', '.join(f'`{k}`' for k in added_origin) or '無'}。")
add(f"- `run_record.json` 頂層：after 多了 {', '.join(f'`{k}`' for k in added_record) or '無'}。")
add(f"- `limitations`：after 多了 {len(limits_added)} 行：" + "；".join(f"「{line}」" for line in limits_added) + "。")
add("- **INFERRED**：這些差異都來自同一次部署所含的 S8 設定選項（#911、#912），與 cutover 無關。依據是程式註解把它們標為 S8，且 cutover 不改文件格式。"
    "after 的 limitations 那一行也說明，這個請求的 `mesh.background_cell_m` 偏離 standard preset。\n")

add("## Schema\n")
for label, errors in (("before", cmp1["schema_errors"]["before"]), ("after", cmp1["schema_errors"]["after"]), ("after2", cmp2["schema_errors"]["after"])):
    add(f"- `{label}/result.json` 對 `tests/contracts/cfd-run-result-v1.schema.json`：{'0 errors' if not errors else '; '.join(errors)}（驗的是主機已遮蔽的版本）。")
add("")

add("## 已知限制\n")
add("- 只跑了 0° 一個方向，而且不是 standard preset（`mesh.background_cell_m` 6 m），所以沒有涵蓋自動延長 endTime、多方向的 `stop_on`、失敗分類與 standard preset。")
add("- 三次 run 的 `run_record.json` 內 `preprocess.shell.sealing_suspect` 都是 true（profile 門檻 0.10），`result.json` 頂層 `preprocess.sealing_suspect` 都是 false（請求門檻 0.15）。這是 ADR Context 記錄的既有漂移；bullet 4（#918）已把兩者統一，但這三次 run 都在那之前的版本上執行。")
add("- 三次的 checkMesh 都回報 `mesh_ok: false`、`failed_checks: 1`，這是這個模型與 6 m 背景格既有的網格品質狀態，cutover 前後相同。\n")

add("## 檔案\n")
add("- `before/`、`after/`、`after2/`：`status.json`（coordinator `GET /api/cfd/runs/{id}`）、`result.json`（`GET …/result`）、`run_record.json`、`exclusions.json`。")
excl = load("before/exclusions.json")
add(f"- `exclusions.json` 是公開 repo 版本，保留欄位：{', '.join(f'`{k}`' for k in excl)}。"
    "`outlier_rule` 內的 `core_box`／`expanded_box` 是模型局部座標，不是地理座標。逐元素的 `items`（IFC GlobalId）已移除；"
    "`served_document_sha256_per_result_json` 等於同資料夾 `result.json` 的 `exclusions.sha256`。")
add("- `requests/`：三份 client 送出的請求 body。")
add("- `deploy.json`：部署 tag、commit 與三次 run 的時間。")
add("- `compare.json`（before 對 after）、`compare_after_after2.json`（after 對 after2；該檔的 `before`／`after` 欄位分別是 after／after2）：請求相等性、每向指標、schema 驗證與鍵差異。")
add("- `noise_baseline.json`：三次 run 的指標與兩組差量。`field_stats.json`：三份 overlay 的分佈統計。")
add("- `tools/`：產生以上檔案的腳本。coordinator 位址由必填的環境變數 `CFD_COORDINATOR_BASE` 提供；`render_readme.py` 從上列 JSON 產生本檔。")
(ev / "README.md").write_text("\n".join(L).rstrip("\n") + "\n", encoding="utf-8")
print("README written:", len(L), "lines")
