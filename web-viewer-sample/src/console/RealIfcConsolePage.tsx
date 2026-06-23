// CH-E：真實 IFC fixture 垂直切片 React 頁（#/demo-control）。
// 由 vanilla dev-console 面板忠實移植：沿用相同 data-testid，改用「相對路徑」fetch（同源 :8004，無 CORS）。
// 誠實鐵律：runtime 狀態原樣顯示（converting/ready/runtime_blocked/conversion_timeout/download_failed），不偽造成功。
import { useEffect, useRef, useState } from "react";
import { t } from "./i18n";

interface IfcSource {
  source_id: string;
  filename: string;
  relative_path: string;
  size_bytes: number;
  modified_at: string;
}

type Lineage = Record<string, string>;

const DASH = "—";

export function RealIfcConsolePage() {
  const [sources, setSources] = useState<IfcSource[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [runtime, setRuntime] = useState<string>("runtime: idle");
  const [lin, setLin] = useState<Lineage>({});
  const [viewerUrl, setViewerUrl] = useState<string>("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const set = (k: string, v: unknown) => setLin((prev) => ({ ...prev, [k]: v == null || v === "" ? DASH : String(v) }));
  const stop = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => () => stop(), []);

  async function loadSources() {
    try {
      const r = await fetch("/api/dev/ifc-sources");
      const j = await r.json();
      const items: IfcSource[] = j.items ?? [];
      setSources(items);
      if (!items.length) {
        setRuntime("runtime: storage_empty (No real IFC files found under ./storage)");
        setSelected("");
        return;
      }
      const preferred =
        items.find((it) => it.filename === "許良宇圖書館建築_2026.ifc") ??
        items.slice().sort((a, b) => (b.size_bytes || 0) - (a.size_bytes || 0))[0];
      setSelected(preferred ? preferred.source_id : items[0].source_id);
      setRuntime("runtime: idle");
    } catch (e) {
      setRuntime("runtime: load_sources_failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }
  useEffect(() => { void loadSources(); }, []);

  async function enrich(job: Record<string, unknown>) {
    try {
      const sid = job.web_view_session_id as string | undefined;
      if (!sid) return;
      const r = await fetch("/api/review-sessions/" + encodeURIComponent(sid) + "/stream-config");
      if (!r.ok) return;
      const sc = await r.json();
      set("lin-artifact-id", sc.model?.artifact_id);
      set("lin-usdc-url", sc.model?.url);
      if (sc.model?.mapping_url) set("lin-mapping", "mapping_url: " + sc.model.mapping_url);
    } catch { /* 誠實：補欄失敗不偽造 */ }
  }

  function startPoll(jobId: string) {
    let n = 0;
    const tick = async () => {
      n++;
      try {
        const r = await fetch("/api/external/ifc-ready/" + encodeURIComponent(jobId));
        const j = await r.json();
        set("lin-download-status", j.download_status);
        set("lin-conversion-status", j.conversion_status);
        set("lin-conversion-job", j.conversion_job_id);
        set("lin-session-id", j.web_view_session_id);
        if (j.viewer_url) { set("lin-viewer-url", j.viewer_url); setViewerUrl(j.viewer_url); }
        const cs = String(j.conversion_status ?? "").toLowerCase();
        if (j.viewer_url) { setRuntime("runtime: ready"); await enrich(j); stop(); }
        else if (j.download_status === "failed") { setRuntime("runtime: download_failed"); stop(); }
        else if (cs === "failed") { setRuntime("runtime: conversion_failed"); stop(); }
        else if (cs.indexOf("block") >= 0) { setRuntime("runtime: runtime_blocked"); stop(); }
        else if (n >= 36) { setRuntime("runtime: conversion_timeout (still " + (j.conversion_status ?? "pending") + " after ~180s)"); stop(); }
        else { setRuntime("runtime: converting (" + (j.conversion_status ?? "queued") + ")"); }
      } catch (e) { setRuntime("runtime: poll_error: " + (e instanceof Error ? e.message : String(e))); }
    };
    pollRef.current = setInterval(() => void tick(), 5000);
    void tick();
  }

  async function register() {
    stop();
    const meta = sources.find((s) => s.source_id === selected);
    if (!selected || !meta) { setRuntime("runtime: no_fixture_selected"); return; }
    const mv = "mv_realifc_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
    set("lin-source-id", selected);
    set("lin-source-path", meta.relative_path);
    set("lin-source-filename", meta.filename);
    set("lin-source-size", (meta.size_bytes || 0) + " bytes");
    set("lin-model-version", mv);
    ["lin-conversion-job", "lin-artifact-id", "lin-usdc-url", "lin-mapping", "lin-session-id", "lin-viewer-url"].forEach((k) => set(k, ""));
    setViewerUrl("");
    setRuntime("runtime: registering");
    try {
      const r = await fetch("/api/dev/ifc-sources/" + encodeURIComponent(selected) + "/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_version_id: mv, project_id: "project_real_ifc_demo" }),
      });
      const j = await r.json().catch(() => ({}));
      set("lin-job-id", j.ifc_ready_job_id);
      if (j.external_model_version_id) set("lin-model-version", j.external_model_version_id);
      set("lin-download-status", j.download_status);
      set("lin-conversion-status", j.conversion_status || "(queued)");
      if (j.ifc_ready_job_id) {
        setRuntime(j.download_status === "failed" ? "runtime: download_failed" : "runtime: converting");
        if (j.download_status !== "failed") startPoll(j.ifc_ready_job_id);
      } else { setRuntime("runtime: register_rejected (" + r.status + ")"); }
    } catch (e) { setRuntime("runtime: register_error: " + (e instanceof Error ? e.message : String(e))); }
  }

  const rows: [string, string][] = [
    ["source_id", "lin-source-id"], ["source_ifc_relative_path", "lin-source-path"], ["source_ifc_filename", "lin-source-filename"],
    ["source_ifc_size_bytes", "lin-source-size"], ["ifc_ready_job_id", "lin-job-id"], ["model_version_id", "lin-model-version"],
    ["conversion_job_id", "lin-conversion-job"], ["conversion_status", "lin-conversion-status"], ["download_status", "lin-download-status"],
    ["artifact_id", "lin-artifact-id"], ["usdc_url / usd_stage_url", "lin-usdc-url"], ["mapping_summary", "lin-mapping"],
    ["review_session_id", "lin-session-id"], ["viewer_url（/ui/open）", "lin-viewer-url"],
  ];

  return (
    <section data-testid="real-ifc-demo-control" style={{ padding: 12 }}>
      <h2 style={{ marginTop: 0 }}>{t("真實 IFC Fixture 垂直切片（demo-control）", "Real IFC Fixture Vertical Slice (demo-control)")}</h2>
      <p style={{ color: "#94a3b8", fontSize: 13 }}>
        {t("從", "From")} <code>./storage</code> {t("選真實 IFC → 真 coordinator", "select a real IFC → real coordinator")} <code>register</code>{t("（內部 loopback）→ 真轉檔 → 審查 session → viewer。誠實顯示 runtime 狀態。", " (internal loopback) → real conversion → review session → viewer. Runtime state shown honestly.")}
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "10px 0" }}>
        <label htmlFor="ifcFixtureSelect">IFC fixture</label>
        <select id="ifcFixtureSelect" data-testid="ifc-fixture-select" value={selected} onChange={(e) => setSelected(e.target.value)} style={{ minWidth: 360 }}>
          {sources.length === 0 ? (
            <option value="">（No real IFC files found under ./storage）</option>
          ) : (
            sources.map((it) => (
              <option key={it.source_id} value={it.source_id}>
                {it.filename + " (" + Math.round((it.size_bytes || 0) / 1024) + " KB · " + String(it.modified_at || "").slice(0, 10) + ")"}
              </option>
            ))
          )}
        </select>
        <button data-testid="ifc-refresh-btn" onClick={() => void loadSources()}>Refresh ./storage IFC list</button>
        <button data-testid="ifc-register-btn" onClick={() => void register()}>{t("註冊並轉檔（真實）", "Register and convert (real)")}</button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
        <tbody>
          {rows.map(([label, tid]) => (
            <tr key={tid}>
              <td style={{ padding: "3px 8px", color: "#94a3b8" }}>{label}</td>
              <td data-testid={tid} style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{lin[tid] ?? DASH}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8 }}>
        <span data-testid="ifc-runtime-state" style={{ fontWeight: 700, color: "#76b900" }}>{runtime}</span>
        {viewerUrl && (
          <a data-testid="ifc-open-viewer" href={viewerUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 12 }}>{t("開 viewer（/ui/open）→", "Open viewer (/ui/open) →")}</a>
        )}
      </div>
    </section>
  );
}
