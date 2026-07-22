// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — Pipeline 頁（模型資料與轉檔生產線）
// 像素級移植正本：scratchpad/design-origin/app.js 的 pipe 區段
// 所有 inline style / 文案 byte-identical；互動為 fixture 語意（local state +
// toast 假 API 字串），不打任何 /api。導覽一律 window.location.hash 賦值。
// ═══════════════════════════════════════════════════════════════════════
import { useLang } from "../i18n";
import { ACCENT, chipBox, getL, innerBox, stChip } from "./fixtures";
import type { ConvItem, OutboxItem } from "./fixtures";
import { useUnifiedState } from "./UnifiedShell";

export function PipelinePage() {
  const lang = useLang();
  const zh = lang === "zh";
  const L = getL(zh);
  const { intake, conv, sessions, outbox, patch, toast } = useUnifiedState();
  /* 誠實停用：全部已送後 deliver 不再有事可做（design gate disabled case 依 aria-disabled 斷言）。
     預設態（2 筆待送）aria-disabled="false"，不改任何預設像素。 */
  const outboxPending = outbox.filter((o) => o.st === "待送").length;

  /* colHead（1:1 對應原型 colHead(title, right)）*/
  const colHead = (title: string, right: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-3)" }}>
      <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-9-5)", letterSpacing: "var(--ab-track-10)", color: "var(--ab-text-code)", textTransform: "uppercase" }}>{title}</span>
      <span style={{ marginLeft: "auto", fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-10)", color: "var(--ab-text-muted)" }}>{right}</span>
    </div>
  );

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "var(--ab-space-7) var(--ab-space-8)", display: "flex", flexDirection: "column", gap: "var(--ab-space-6)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-px-14)" }}>
        <span style={{ fontSize: "var(--ab-fs-20)", fontWeight: "var(--ab-fw-700)" }}>{L.pipe_title}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-2)", fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-10)", color: "var(--ab-text-code)" }}>
          <span style={{ color: "var(--ab-accent-text)" }}>{"① " + L.st_intake}</span><span style={{ color: "var(--ab-text-faint)" }}>→</span>
          <span style={{ color: "var(--ab-accent-text)" }}>{"② " + L.st_conv}</span><span style={{ color: "var(--ab-text-faint)" }}>→</span>
          <span style={{ color: "var(--ab-accent-text)" }}>③ Session</span><span style={{ color: "var(--ab-text-faint)" }}>→</span>
          <span style={{ color: "var(--ab-accent-text)" }}>④ 3D Handoff</span><span style={{ color: "var(--ab-text-faint)" }}>→</span>
          <span style={{ color: "var(--ab-accent-text)" }}>{"⑤ " + L.st_callback}</span>
        </div>
        <span style={{ marginLeft: "auto", fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-10)", color: "var(--ab-text-dimmer)" }}>MinIO watch ● · conversion API :49101 ●</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "var(--ab-space-5)", alignItems: "start" }}>
        <div data-prov="fixture" style={{ ...chipBox, padding: "var(--ab-space-px-14)", display: "flex", flexDirection: "column", gap: "var(--ab-space-4)" }}>
          {colHead("① " + L.st_intake, String(intake.length))}
          {intake.map((c) => (
            <div key={c.file} style={{ ...innerBox, padding: "var(--ab-space-px-11)", display: "flex", flexDirection: "column", gap: "var(--ab-space-px-7)" }}>
              <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-mono)", color: "var(--ab-text)", wordBreak: "break-all" }}>{c.file}</span>
              <div style={{ display: "flex", gap: "var(--ab-space-px-5)", alignItems: "center" }}>
                <span style={{ fontSize: "var(--ab-fs-9-5)", color: "var(--ab-accent-text)", background: "var(--ab-accent-a08)", border: "var(--ab-space-px-1) solid var(--ab-accent-a20)", borderRadius: "var(--ab-r-xs)", padding: "var(--ab-space-px-1) var(--ab-space-2)" }}>ifc-ready</span>
                <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-9)", color: "var(--ab-text-dimmer)" }}>{c.src}</span>
              </div>
              <span
                data-uc="trigger-conv"
                onClick={() => {
                  const next: ConvItem[] = [{ file: c.file, st: "running" }, ...conv];
                  patch({ intake: intake.filter((x) => x.file !== c.file), conv: next });
                  toast("POST /api/conversion/trigger → 202 Accepted · " + c.file);
                }}
                className="hv-bright"
                style={{ textAlign: "center", fontSize: "var(--ab-fs-mono)", color: "var(--ab-on-accent)", background: `linear-gradient(135deg,${ACCENT},var(--ab-accent-2))`, borderRadius: "var(--ab-r-px-7)", padding: "var(--ab-space-2)", cursor: "pointer", fontWeight: "var(--ab-fw-700)" }}
              >{L.trigger + " →"}</span>
            </div>
          ))}
          {intake.length === 0 ? <span style={{ fontSize: "var(--ab-fs-mono)", color: "var(--ab-text-dimmer)", textAlign: "center", padding: "var(--ab-space-3) 0" }}>{L.empty}</span> : null}
        </div>
        <div data-prov="fixture" style={{ ...chipBox, padding: "var(--ab-space-px-14)", display: "flex", flexDirection: "column", gap: "var(--ab-space-4)" }}>
          {colHead("② " + L.st_conv, String(conv.length))}
          {conv.map((c) => (
            <div key={c.file} style={{ ...innerBox, padding: "var(--ab-space-px-11)", display: "flex", flexDirection: "column", gap: "var(--ab-space-px-7)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-2)" }}><span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-mono)", color: "var(--ab-text)", flex: 1, wordBreak: "break-all" }}>{c.file}</span><span style={stChip(c.st)}>{c.st === "running" ? (zh ? "轉檔中" : "running") : c.st === "failed" ? (zh ? "失敗" : "failed") : (zh ? "完成" : "done")}</span></div>
              {c.st === "running" ? (
                <>
                  <div style={{ height: 5, borderRadius: "var(--ab-r-px-3)", background: "var(--ab-border)", overflow: "hidden" }}><div style={{ height: "100%", width: "62%", background: "linear-gradient(90deg,var(--ab-accent-2),var(--ab-accent))", borderRadius: "var(--ab-r-px-3)", animation: "convbar 3s ease-in-out infinite alternate" }} /></div>
                  <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-9)", color: "var(--ab-text-dim)" }}>IFC→USDC · ifcopenshell + usd-core</span>
                </>
              ) : null}
              {c.st === "failed" ? (
                <span
                  onClick={() => {
                    patch({ conv: conv.map((x): ConvItem => (x.file === c.file ? { ...x, st: "running" } : x)) });
                    toast("POST /api/conversion/jobs/cj_0116/retry → 202");
                  }}
                  className="hv-danger-bg"
                  style={{ textAlign: "center", fontSize: "var(--ab-fs-mono)", color: "var(--ab-danger)", border: "var(--ab-space-px-1) solid var(--ab-danger-a35)", borderRadius: "var(--ab-r-px-7)", padding: "var(--ab-space-px-5)", cursor: "pointer" }}
                >{L.retry}</span>
              ) : null}
              {c.st === "done" ? (
                <>
                  <div style={{ display: "flex", gap: "var(--ab-space-px-5)" }}><span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-9)", color: "var(--ab-text-dim)" }}>model.usdc</span><span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-9)", color: "var(--ab-text-dim)" }}>element_mapping.json</span><span style={{ marginLeft: "auto", fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-9)", color: "var(--ab-ok-text)" }}>{c.metrics ?? ""}</span></div>
                  <span
                    onClick={() => {
                      const id = "S-2407" + String(14 + sessions.length);
                      patch({ sessions: [...sessions, { id, lease: "unclaimed", stage: "/artifacts/" + c.file.replace(".ifc", "") + "/model.usdc" }] });
                      toast("POST /api/review-sessions → 201 · " + id);
                    }}
                    className="hv-bright"
                    style={{ textAlign: "center", fontSize: "var(--ab-fs-mono)", color: "var(--ab-on-accent)", background: `linear-gradient(135deg,${ACCENT},var(--ab-accent-2))`, borderRadius: "var(--ab-r-px-7)", padding: "var(--ab-space-2)", cursor: "pointer", fontWeight: "var(--ab-fw-700)" }}
                  >{L.mksession + " →"}</span>
                </>
              ) : null}
            </div>
          ))}
        </div>
        <div data-prov="fixture" style={{ ...chipBox, padding: "var(--ab-space-px-14)", display: "flex", flexDirection: "column", gap: "var(--ab-space-4)" }}>
          {colHead("③ Review Sessions", String(sessions.length))}
          {sessions.map((x) => (
            <div key={x.id} style={{ ...innerBox, padding: "var(--ab-space-px-11)", display: "flex", flexDirection: "column", gap: "var(--ab-space-px-7)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-2)" }}>
                <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-mono)", color: "var(--ab-accent-text)" }}>{x.id}</span>
                <span style={{ marginLeft: "auto", fontSize: "var(--ab-fs-9-5)", color: "var(--ab-ok-text)", background: "var(--ab-ok-a08)", border: "var(--ab-space-px-1) solid var(--ab-ok-a22)", borderRadius: "var(--ab-r-xs)", padding: "var(--ab-space-px-1) var(--ab-space-2)" }}>{x.lease}</span>
              </div>
              <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-9-5)", color: "var(--ab-text-dim)", wordBreak: "break-all" }}>{x.stage}</span>
              <div style={{ display: "flex", gap: "var(--ab-space-2)" }}>
                <span
                  onClick={() => {
                    window.location.hash = "#a1";
                    toast("GET /ui/open?session=" + x.id + " → 302 viewer");
                  }}
                  className="hv-bright"
                  style={{ flex: 1, textAlign: "center", fontSize: "var(--ab-fs-10-5)", color: "var(--ab-on-accent)", background: `linear-gradient(135deg,${ACCENT},var(--ab-accent-2))`, borderRadius: "var(--ab-r-px-7)", padding: "var(--ab-space-px-5)", cursor: "pointer", fontWeight: "var(--ab-fw-700)" }}
                >{"④ " + L.enter3d + " →"}</span>
                <span
                  onClick={() => toast("已複製 /ui/open?session=" + x.id)}
                  className="hv-text"
                  style={{ textAlign: "center", fontSize: "var(--ab-fs-10-5)", color: "var(--ab-text-muted)", border: "var(--ab-space-px-1) solid var(--ab-border-strong)", borderRadius: "var(--ab-r-px-7)", padding: "var(--ab-space-px-5) var(--ab-space-3)", cursor: "pointer" }}
                >⧉ /ui/open</span>
                <span
                  onClick={() => toast("已複製 Spectator 邀請連結 /ui/open?session=" + x.id + "&streamRole=spectator(唯讀)")}
                  className="hv-accent-bg"
                  style={{ textAlign: "center", fontSize: "var(--ab-fs-10-5)", color: "var(--ab-accent-text)", border: "var(--ab-space-px-1) solid var(--ab-border-accent)", borderRadius: "var(--ab-r-px-7)", padding: "var(--ab-space-px-5) var(--ab-space-3)", cursor: "pointer", whiteSpace: "nowrap" }}
                >+ Spectator</span>
              </div>
            </div>
          ))}
        </div>
        <div data-prov="fixture" style={{ ...chipBox, padding: "var(--ab-space-px-14)", display: "flex", flexDirection: "column", gap: "var(--ab-space-4)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-3)" }}><span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-9-5)", letterSpacing: "var(--ab-track-10)", color: "var(--ab-text-code)", textTransform: "uppercase" }}>⑤ Callback Outbox</span><span style={{ marginLeft: "auto", fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-10)", color: "var(--ab-warn)" }}>{`${outbox.filter((o) => o.st === "待送").length} ${L.pending}`}</span></div>
          {outbox.map((o) => (
            <div key={o.id} style={{ ...innerBox, padding: "var(--ab-space-4)", display: "flex", alignItems: "center", gap: "var(--ab-space-3)" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--ab-space-px-2)" }}>
                <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-10)", color: "var(--ab-text)" }}>{o.id + " · " + o.kind}</span>
                <span style={{ fontSize: "var(--ab-fs-9-5)", color: "var(--ab-text-dim)" }}>metadata-only → 雲端 bim-control</span>
              </div>
              <span style={o.st === "待送"
                ? { fontSize: "var(--ab-fs-9-5)", color: "var(--ab-warn)", background: "var(--ab-warn-a08)", border: "var(--ab-space-px-1) solid var(--ab-warn-a30)", borderRadius: "var(--ab-r-xs)", padding: "var(--ab-space-px-2) var(--ab-space-px-7)", fontFamily: "var(--ab-mono)" }
                : { fontSize: "var(--ab-fs-9-5)", color: "var(--ab-ok-text)", background: "var(--ab-ok-a08)", border: "var(--ab-space-px-1) solid var(--ab-ok-a25)", borderRadius: "var(--ab-r-xs)", padding: "var(--ab-space-px-2) var(--ab-space-px-7)", fontFamily: "var(--ab-mono)" }}
              >{o.st === "待送" ? (zh ? "待送" : "pending") : (zh ? "已送 ✓" : "sent ✓")}</span>
            </div>
          ))}
          <span
            data-uc="deliver-outbox"
            role="button"
            aria-disabled={outboxPending === 0 ? "true" : "false"}
            onClick={() => {
              if (outboxPending === 0) return;
              patch({ outbox: outbox.map((o): OutboxItem => ({ ...o, st: "已送" })) });
              toast("POST /api/internal/callback-outbox/deliver → ✓ metadata-only");
            }}
            className="hv-accent-bg"
            style={{ textAlign: "center", fontSize: "var(--ab-fs-mono)", color: "var(--ab-accent-text)", border: "var(--ab-space-px-1) solid var(--ab-border-accent)", borderRadius: "var(--ab-r-md)", padding: "var(--ab-space-px-7)", cursor: "pointer" }}
          >{L.deliver}</span>
        </div>
      </div>
      <div data-prov="fixture" style={{ ...chipBox, padding: "var(--ab-space-6)", display: "flex", flexDirection: "column", gap: "var(--ab-space-4)" }}>
        <div style={{ display: "flex", alignItems: "center" }}><span style={{ fontSize: "var(--ab-fs-13-5)", fontWeight: "var(--ab-fw-700)" }}>{"MinIO " + L.browse}</span><span style={{ marginLeft: "auto", fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-9-5)", color: "var(--ab-text-dimmer)" }}>GET /api/minio/objects?delimiter=/</span></div>
        <div style={{ display: "flex", gap: "var(--ab-space-px-20)", fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-mono)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--ab-space-px-5)", color: "var(--ab-text-muted)" }}>
            <span>▾ bucket/incoming</span>
            <span style={{ paddingLeft: "var(--ab-space-6)", color: "var(--ab-text)" }}>demo_lib_2026.ifc <span style={{ color: "var(--ab-text-dimmer)" }}>· 48 MB</span></span>
            <span style={{ paddingLeft: "var(--ab-space-6)", color: "var(--ab-text)" }}>松風庵_v3.ifc <span style={{ color: "var(--ab-text-dimmer)" }}>· 132 MB</span></span>
            <span>▸ bucket/processed</span>
            <span>▸ bucket/artifacts</span>
          </div>
          <div style={{ flex: 1, borderLeft: "var(--ab-space-px-1) solid var(--ab-border-a10)", paddingLeft: "var(--ab-space-px-20)", display: "flex", flexDirection: "column", gap: "var(--ab-space-px-5)", color: "var(--ab-text-dim)", fontSize: "var(--ab-fs-10-5)" }}>
            <span style={{ color: "var(--ab-text-muted)" }}>{L.recent}</span>
            <span>10:20 · 990_model.ifc → conversion job cj_0117 <span style={{ color: "var(--ab-ok-text)" }}>202</span></span>
            <span>10:05 · s3:ObjectCreated demo_lib_2026.ifc</span>
            <span>09:41 · conversion cj_0116 failed <span style={{ color: "var(--ab-danger)" }}>ifcopenshell parse error</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}
