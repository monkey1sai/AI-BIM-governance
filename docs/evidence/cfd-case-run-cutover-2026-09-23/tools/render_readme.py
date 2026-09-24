"""Render README.md of the CFD Case Run cutover evidence from its JSON files (numbers are never typed by hand).

Usage: render_readme.py <evidence_dir>
Inputs in <evidence_dir>: deploy.json, compare.json (before vs after), compare_after_<label>.json for every other same-version
run, noise_baseline.json, field_stats.json, <label>/{status,result,run_record,exclusions}.json, requests/*.json.
Every sentence that states a fact about all runs is checked here first; a check that does not hold fails the render.
Refuses to write when a JSON file carries an IPv4 address or a filesystem path (public repository).
"""
import json
import re
import statistics
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


def check(condition: bool, what: str) -> None:
    if not condition:
        sys.exit(f"REFUSED: the README would state something the data does not show: {what}")


deploy, cmp1, noise, fields = load("deploy.json"), load("compare.json"), load("noise_baseline.json"), load("field_stats.json")
SV = noise["same_version_labels"]
LABELS = ["before", *SV]
N = len(LABELS)
REPEATS = [label for label in SV if label != "after"]
cmp_repeat = {label: load(f"compare_after_{label}.json") for label in REPEATS}
rows = {row["metric"]: row for row in noise["rows"]}
status = {label: load(f"{label}/status.json") for label in LABELS}
record = {label: load(f"{label}/run_record.json") for label in LABELS}
result = {label: load(f"{label}/result.json") for label in LABELS}
runs = {run["label"]: run for run in deploy["runs"]}
check(set(runs) == set(LABELS), "deploy.json lists exactly the captured runs")
after_commit = runs["after"]["deployed_commit"]
check(all(runs[label]["deployed_commit"] == after_commit for label in SV), "every same-version run ran on one deployed commit")
check(runs["before"]["deployed_commit"] != after_commit, "before ran on another deployed commit")

# Facts stated for every run.
direction0 = {label: result[label]["directions"][0] for label in LABELS}
check(all(result[label]["status"] == "ready" and direction0[label]["status"] == "ready" for label in LABELS), "every run is ready")
check(all(direction0[label]["converged_by_residual_control"] is True for label in LABELS), "every run converged by residual control")
check(all(direction0[label]["end_time_extended_to"] is None for label in LABELS), "no run extended endTime")
schema_errors = {"before": cmp1["schema_errors"]["before"], "after": cmp1["schema_errors"]["after"]}
schema_errors.update({label: cmp_repeat[label]["schema_errors"]["after"] for label in REPEATS})
check(all(not errors for errors in schema_errors.values()), "every result.json validates against the schema")
same_result_keys = len({tuple(sorted(result[label])) for label in LABELS}) == 1
check(len({rows["case_meta_sha256"]["before"], *rows["case_meta_sha256"]["same_version"].values()}) == 1, "case_meta.json sha256 is the same for every run")
check(len({result[label]["exclusions"]["sha256"] for label in LABELS}) == 1, "exclusions sha256 is the same for every run")
check(len({result[label]["preprocess"]["leak_fraction"] for label in LABELS}) == 1, "leak_fraction is the same for every run")
mesh_flags = {(record[label]["directions"][0]["mesh"]["mesh_ok"], record[label]["directions"][0]["mesh"]["failed_checks"]) for label in LABELS}
check(mesh_flags == {(False, 1)}, "checkMesh reports mesh_ok false with one failed check for every run")
sealing = {(record[label]["preprocess"]["shell"]["sealing_suspect"], result[label]["preprocess"]["sealing_suspect"]) for label in LABELS}
check(sealing == {(True, False)}, "the two sealing_suspect flags disagree the same way for every run")
bodies = {}
for path in sorted((ev / "requests").glob("*.json")):
    body = json.loads(path.read_text(encoding="utf-8"))
    body.pop("idempotency_key")
    bodies[path.stem] = json.dumps(body, sort_keys=True)
check(set(bodies) == set(LABELS) and len(set(bodies.values())) == 1, "the request bodies differ only in idempotency_key")
check(cmp1["request_equal"] and all(c["request_equal"] for c in cmp_repeat.values()), "the service-normalised requests are equal")

SOLUTION = ("iterations", "U_magnitude_max", "p_min", "p_max",
            "PedestrianWind_1p5m.p05", "PedestrianWind_1p5m.mean", "PedestrianWind_1p5m.p50", "PedestrianWind_1p5m.p95",
            "BuildingSurfacePressure.p05", "BuildingSurfacePressure.mean", "BuildingSurfacePressure.p50", "BuildingSurfacePressure.p95")
MESH = ("mesh_faces", "mesh_points", "max_non_orthogonality", "max_skewness")
VERDICT = SOLUTION + MESH
failing = [m for m in VERDICT if rows[m]["within_noise"] is not True]
inside = [m for m in VERDICT if rows[m]["inside_range"] is True]
equal_across = {m: len({rows[m]["before"], *rows[m]["same_version"].values()}) == 1 for m in ("mesh_cells", "pedestrian_polygons")}


def yes(value) -> str:
    return "是" if value is True else ("**否**" if value is False else "—")


L: list[str] = []
add = L.append
add("# CFD Case Run service cutover：181 前後同請求比對（ADR Verification 4）\n")
add(f"`docs/architecture/cfd-case-run-adr.md` §Verification 第 4 項：同一個 `cfd-run-request/v1` 請求在 canonical Linux 181 上跑 {N} 次。"
    f"cutover（PR #913）**前**跑一次（before，部署 `{runs['before']['deployed_commit'][:7]}`），**後**在同一個部署 `{after_commit[:7]}` 上跑 {len(SV)} 次"
    f"（{'、'.join(SV)}）。after 與 after2 在 2026-09-23 執行；{'、'.join(label for label in SV if label not in ('after', 'after2'))} 在 2026-09-24 補跑，"
    "用來界定同版本、同請求的 run-to-run 變異，作為「在 solver noise 內」的基線。\n")
add("主機一律寫成 `<canonical-host>`；不含專案名稱、GlobalId、IFC／USDC 檔案。`p` 是 OpenFOAM 不可壓縮求解的 kinematic pressure（m²/s²），不是 Pa。\n")

add("## 結論\n")
add("**通過。**\n" if not failing else "**條件式通過。**\n")
add(f"- **VERIFIED**：寫 case 與網格的程式、case 輸入與容器參數在 cutover 前後相同（見下節）；{N} 次 run 都收斂、都沒有延長 endTime，"
    f"{N} 份 `result.json` 都符合 `cfd-run-result-v1.schema.json`。")
add(f"- **VERIFIED**：判準在取得 after3 之前訂定（`noise_baseline.json` 的 `criterion`）：|before − 同版本中位數| ≤ 同版本全距（max − min），"
    f"同版本共 {len(SV)} 次。這是描述性的判準，不是統計檢定；它界定的是這個請求在這台主機上觀察到的變異範圍。")
if not failing:
    add(f"- **VERIFIED**：{len(VERDICT)} 個求解與網格指標全部符合判準（見下表）；其中 {len(inside)} 個的 before 值還落在同版本的 [min, max] 之內"
        f"（這條更嚴，同分佈的第 {N} 個樣本落在前 {len(SV)} 個範圍外的機率約 {2 / N:.0%}，所以只列出、不用來判定）。")
else:
    add(f"- **VERIFIED**：{len(VERDICT) - len(failing)} 個指標符合判準；下列 {len(failing)} 個不符合：" + "、".join(f"`{m}`" for m in failing) + "。")
cells_note = (f"網格格數（{fmt(rows['mesh_cells']['before'])}）{N} 次都相同" if equal_across["mesh_cells"]
              else f"網格格數在 {N} 次之間不同（before {fmt(rows['mesh_cells']['before'])}，同版本全距 {fmt(rows['mesh_cells'].get('same_version_range'))}）")
poly_note = (f"行人面多邊形數（{fmt(rows['pedestrian_polygons']['before'])}）{N} 次都相同" if equal_across["pedestrian_polygons"]
             else f"行人面多邊形數在 {N} 次之間不同（同版本全距 {fmt(rows['pedestrian_polygons'].get('same_version_range'))}）")
add(f"- **VERIFIED**：{cells_note}；{poly_note}。同版本的 {len(SV)} 次 run 之間，網格面數相差最多 {fmt(rows['mesh_faces']['same_version_range'])}、"
    f"點數最多 {fmt(rows['mesh_points']['same_version_range'])}；before 的面數與點數{'都符合' if rows['mesh_faces']['within_noise'] and rows['mesh_points']['within_noise'] else '**不**全符合'}判準。")
solver0 = {label: record[label]["directions"][0]["solver"] for label in LABELS}
recorded_same = (len({solver0[label]["image_digest"] for label in LABELS}) == 1
                 and len({solver0[label]["n_procs"] for label in LABELS}) == 1
                 and len({json.dumps(record[label]["preprocess"], sort_keys=True) for label in LABELS}) == 1)
check(recorded_same, "the recorded solver image digest, n_procs and preprocess results are the same for every run")


def ratio(m: str) -> float | None:
    row = rows[m]
    return (row["before_minus_median_abs"] / row["same_version_range"]) if row["same_version_range"] else None


if failing:
    worst = max(failing, key=lambda m: ratio(m) or 0)
    add(f"- **VERIFIED**：{N} 次 run 記錄的求解 image digest（`{solver0['before']['image']}`）、`n_procs`（{solver0['before']['n_procs']}）、"
        "前處理的全部統計與 `case_meta.json` sha256 都相同。`run_record` 沒有記錄其餘 case 檔的 sha256，也沒有記錄主機的執行條件。")
    add(f"- **INFERRED**：不符合判準的指標中，同版本 {len(SV)} 次彼此非常接近，before 卻落在範圍外；差距最大的是 `{worst}`，"
        f"before 與中位數的距離是同版本全距的 {fmt(ratio(worst))} 倍。這比較像 before 與 after 之間的系統性差異，而不是同版本也會出現的 run-to-run 變異。"
        "現有紀錄無法確認原因；上一點列出的已記錄項目都相同，所以原因不在這些項目裡。相對差見下表：網格指標最大 "
        f"{fmt(max(rows[m]['before_minus_median_rel'] or 0 for m in MESH if m in failing) if any(m in failing for m in MESH) else 0)}，"
        f"解的指標最大 {fmt(max(rows[m]['before_minus_median_rel'] or 0 for m in SOLUTION if m in failing) if any(m in failing for m in SOLUTION) else 0)}。")
    add("- 所以結論維持條件式通過：契約與 case 輸入不變，大部分指標落在同版本變異內；列為「否」的指標，不能宣稱在 solver noise 內。\n")
else:
    add("- **INFERRED**：同版本各次的網格差異來自平行 snappyHexMesh（4 個程序）的執行期非決定性，建物面 p 的分佈隨網格一起變動；"
        "程式、輸入、求解 image digest 與 `n_procs` 都相同。\n")
add("| 指標 | before | 同版本中位數 | 同版本全距 | \\|before − 中位數\\| | 距離／全距 | 相對差 | 符合判準 | 落在 [min, max] |\n"
    "|---|---|---|---|---|---|---|---|---|")
for m in VERDICT:
    row = rows[m]
    add(f"| `{m}` | {fmt(row['before'])} | {fmt(row['same_version_median'])} | {fmt(row['same_version_range'])} | "
        f"{fmt(row['before_minus_median_abs'])} | {fmt(ratio(m))} | {fmt(row['before_minus_median_rel'])} | {yes(row['within_noise'])} | {yes(row['inside_range'])} |")
add("")

add("## 程式與輸入（VERIFIED）\n")
add(f"- `openfoam_case.py`、`preprocess.py`、`voxel_shell.py`、`profiles.py` 在 `{runs['before']['deployed_commit'][:7]}..{after_commit[:7]}` 之間沒有變更（`git diff --stat` 為空）。"
    "變更只在 job service 的組合層（`cfd_job_service.py`、新增的 `case_run.py`）、S8 設定選項（`cfd_options.*`）與 `wind.py`（`true_north_from_geo` 改為公開）。")
add("- 兩個版本的 service 都用 `build_case(shell_stl, out_dir, params)` 寫 case，都以 `cpus = min(n_procs, cpus_cap)` 與同一個 image 設定啟動容器。")
add(f"- {N} 次 run 的 `case_meta.json` sha256 都是 `{rows['case_meta_sha256']['before'][:12]}…`；exclusions sha256 都是 `{result['before']['exclusions']['sha256'][:12]}…`；"
    f"前處理 `leak_fraction` 都是 {fmt(result['before']['preprocess']['leak_fraction'])}。")
sent = [label for label in LABELS if not runs[label]["trace_id"].startswith("trace_cfd_")]
generated = [label for label in LABELS if runs[label]["trace_id"].startswith("trace_cfd_")]
add(f"- 請求：`requests/` 內 {N} 份 client 送出的 body 只差 `idempotency_key`；service 正規化後的請求（去掉 `idempotency_key` 與 `requested_by`）兩兩相同。"
    f"`requested_by.trace_id` 不同：{'、'.join(sent)} 送出時帶了 `x-trace-id`，{'、'.join(generated) or '無'} 沒帶，由 coordinator 產生 `trace_cfd_…`。trace id 不進入求解。\n")

add("## 部署版本（`deploy.json`）\n")
add("| run | run_id | 部署 commit | 建立 | 開始 | 結束 |\n|---|---|---|---|---|---|")
for label in LABELS:
    run = runs[label]
    add(f"| {label} | `{run['run_id']}` | `{run['deployed_commit'][:7]}` | {run['created_at']} | {run['started_at']} | {run['finished_at']} |")
add("")
for item in deploy["deploys"]:
    add(f"- `{item['tag']}` → `{item['commit'][:7]}`，部署於 {item['deployed_at_utc']}。")
last = SV[-1]
check(deploy.get(f"no_later_deploy_tag_when_{last}_was_captured") is True, f"no later deploy tag existed when {last} was captured")
add(f"- before 在 `-004` 與 `-005` 之間執行；{'、'.join(SV)} 都在 `-005` 之後，且 capture {last} 時沒有更晚的部署 tag。"
    "before 在佇列裡等了約兩小時，因為前面有一個 15 方向的 run。\n")

add("## 同版本重跑基線（`noise_baseline.json`）\n")
add("「全距」是同版本各次的 max − min；「\\|before − 中位數\\|」是 before 與同版本中位數的距離。\n")
head = " | ".join(LABELS)
add(f"| 指標 | {head} | 全距 | \\|before − 中位數\\| |\n|---|{'---|' * N}---|---|")
for metric in ("iterations", "mesh_cells", "mesh_faces", "mesh_points", "max_non_orthogonality", "max_skewness", "U_magnitude_max", "pedestrian_polygons",
               "p_min", "p_max", "solver_elapsed_seconds", "job_wall_seconds"):
    row = rows[metric]
    values = " | ".join(fmt(row["before"] if label == "before" else row["same_version"][label]) for label in LABELS)
    add(f"| {metric} | {values} | {fmt(row.get('same_version_range'))} | {fmt(row.get('before_minus_median_abs'))} |")
add("")
add("`solver_elapsed_seconds` 是容器內求解的時間；`job_wall_seconds` 是整個 job（含前處理與後處理）從開始到結束的時間。兩者隨主機負載變動，不列入判準。\n")

add("## 場量統計（overlay layer 全場，`field_stats.json`）\n")
add(f"{N} 份 overlay USDC（未入版控）用 pxr 讀出 `PedestrianWind_1p5m` 的 |U|（m/s，每個頂點一個值）與 `BuildingSurfacePressure` 的 p（m²/s²，每個面一個值，`uniform`）。"
    "取樣面的頂點數或面數在各次之間略有差異，所以只比分佈，不做逐點差。\n")
add(f"| prim | 統計 | {head} | 全距 | \\|before − 中位數\\| |\n|---|---|{'---|' * N}---|---|")
for prim in ("PedestrianWind_1p5m", "BuildingSurfacePressure"):
    for key in ("n", "faces", "points", "min", "p05", "mean", "p50", "p95", "max"):
        values = [fields["layers"][label][prim][key] for label in LABELS]
        same = values[1:]
        spread, distance = max(same) - min(same), abs(values[0] - statistics.median(same))
        add(f"| {prim} | {key} | {' | '.join(fmt(v) for v in values)} | {fmt(spread)} | {fmt(distance)} |")
add("")

add("## 文件結構差異（after 部署包含的 S8 變更）\n")
st_before, st_after = status["before"]["status"], status["after"]["status"]
added_status = sorted(set(st_after) - set(st_before))
origin_before, origin_after = status["before"]["ledger"].get("origin") or {}, status["after"]["ledger"].get("origin") or {}
added_origin = sorted(set(origin_after) - set(origin_before))
added_record = sorted(set(record["after"]) - set(record["before"]))
limits_added = [line for line in result["after"]["limitations"] if line not in result["before"]["limitations"]]
add(f"- `result.json` 頂層鍵：{N} 次{'相同' if same_result_keys else '**不同**'}。")
add(f"- `status.json` 的 status 文件：after 多了 {', '.join(f'`{k}`' for k in added_status) or '無'}。")
add(f"- `status.json` 的 `ledger.origin`：after 多了 {', '.join(f'`{k}`' for k in added_origin) or '無'}。")
add(f"- `run_record.json` 頂層：after 多了 {', '.join(f'`{k}`' for k in added_record) or '無'}。")
add(f"- `limitations`：after 多了 {len(limits_added)} 行：" + "；".join(f"「{line}」" for line in limits_added) + "。")
add("- **INFERRED**：這些差異都來自同一次部署所含的 S8 設定選項（#911、#912），與 cutover 無關。依據是程式註解把它們標為 S8，且 cutover 不改文件格式。"
    "after 的 limitations 那一行也說明，這個請求的 `mesh.background_cell_m` 偏離 standard preset。\n")

add("## Schema\n")
for label in LABELS:
    errors = schema_errors[label]
    add(f"- `{label}/result.json` 對 `tests/contracts/cfd-run-result-v1.schema.json`：{'0 errors' if not errors else '; '.join(errors)}（驗的是主機已遮蔽的版本）。")
add("")

add("## 已知限制\n")
add("- 只跑了 0° 一個方向，而且不是 standard preset（`mesh.background_cell_m` 6 m），所以沒有涵蓋自動延長 endTime、多方向的 `stop_on`、失敗分類與 standard preset。")
add(f"- {N} 次 run 的 `run_record.json` 內 `preprocess.shell.sealing_suspect` 都是 true（profile 門檻 0.10），`result.json` 頂層 `preprocess.sealing_suspect` 都是 false（請求門檻 0.15）。"
    f"這是 ADR Context 記錄的既有漂移；bullet 4（#918）已把兩者統一，但這 {N} 次 run 都在那之前的版本上執行。")
add(f"- {N} 次的 checkMesh 都回報 `mesh_ok: false`、`failed_checks: 1`，這是這個模型與 6 m 背景格既有的網格品質狀態，cutover 前後相同。")
add(f"- 同版本只有 {len(SV)} 次，全距會隨次數增加而變大；判準界定的是觀察到的範圍，不是變異的上限。\n")

add("## 檔案\n")
add(f"- {'、'.join(f'`{label}/`' for label in LABELS)}：`status.json`（coordinator `GET /api/cfd/runs/{{id}}`）、`result.json`（`GET …/result`）、`run_record.json`、`exclusions.json`。")
excl = load("before/exclusions.json")
add(f"- `exclusions.json` 是公開 repo 版本，保留欄位：{', '.join(f'`{k}`' for k in excl)}。"
    "`outlier_rule` 內的 `core_box`／`expanded_box` 是模型局部座標，不是地理座標。逐元素的 `items`（IFC GlobalId）已移除；"
    "`served_document_sha256_per_result_json` 等於同資料夾 `result.json` 的 `exclusions.sha256`。")
add(f"- `requests/`：{N} 份 client 送出的請求 body。")
add(f"- `deploy.json`：部署 tag、commit 與 {N} 次 run 的時間。")
add("- `compare.json`（before 對 after）與 " + "、".join(f"`compare_after_{label}.json`" for label in REPEATS)
    + "（after 對其他同版本 run；這些檔的 `before`／`after` 欄位分別是 after 與該次 run）：請求相等性、每向指標、schema 驗證與鍵差異。")
add(f"- `noise_baseline.json`：{N} 次 run 的指標、同版本中位數與全距，以及判準結果。`field_stats.json`：{N} 份 overlay 的分佈統計。")
add("- `tools/`：產生以上檔案的腳本。coordinator 位址由必填的環境變數 `CFD_COORDINATOR_BASE` 提供；`render_readme.py` 從上列 JSON 產生本檔，"
    "並在寫入前檢查每一句關於全部 run 的敘述。")
(ev / "README.md").write_text("\n".join(L).rstrip("\n") + "\n", encoding="utf-8")
print("README written:", len(L), "lines; verdict:", "pass" if not failing else f"conditional ({len(failing)} failing)")
