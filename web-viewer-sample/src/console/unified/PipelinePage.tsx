// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — Pipeline 頁（模型資料與轉檔生產線）
// 像素級移植正本：scratchpad/design-origin/app.js 的 pipe 區段
// 所有 inline style / 文案 byte-identical；互動為 fixture 語意（local state +
// toast 假 API 字串），不打任何 /api。導覽一律 window.location.hash 賦值。
// ═══════════════════════════════════════════════════════════════════════
import { useLang } from "../i18n";
import { ACCENT, MONO, chipBox, getL, innerBox, stChip } from "./fixtures";
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
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: ".1em", color: "var(--ab-text-code)", textTransform: "uppercase" }}>{title}</span>
      <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: "var(--ab-text-muted)" }}>{right}</span>
    </div>
  );

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "22px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 20, fontWeight: 700 }}>{L.pipe_title}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 10, color: "var(--ab-text-code)" }}>
          <span style={{ color: "var(--ab-accent-text)" }}>{"① " + L.st_intake}</span><span style={{ color: "var(--ab-text-faint)" }}>→</span>
          <span style={{ color: "var(--ab-accent-text)" }}>{"② " + L.st_conv}</span><span style={{ color: "var(--ab-text-faint)" }}>→</span>
          <span style={{ color: "var(--ab-accent-text)" }}>③ Session</span><span style={{ color: "var(--ab-text-faint)" }}>→</span>
          <span style={{ color: "var(--ab-accent-text)" }}>④ 3D Handoff</span><span style={{ color: "var(--ab-text-faint)" }}>→</span>
          <span style={{ color: "var(--ab-accent-text)" }}>{"⑤ " + L.st_callback}</span>
        </div>
        <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: "var(--ab-text-dimmer)" }}>MinIO watch ● · conversion API :49101 ●</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, alignItems: "start" }}>
        <div data-prov="fixture" style={{ ...chipBox, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {colHead("① " + L.st_intake, String(intake.length))}
          {intake.map((c) => (
            <div key={c.file} style={{ ...innerBox, padding: 11, display: "flex", flexDirection: "column", gap: 7 }}>
              <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--ab-text)", wordBreak: "break-all" }}>{c.file}</span>
              <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <span style={{ fontSize: "9.5px", color: "var(--ab-accent-text)", background: "rgba(65,199,232,.08)", border: "1px solid rgba(65,199,232,.2)", borderRadius: 4, padding: "1px 6px" }}>ifc-ready</span>
                <span style={{ fontFamily: MONO, fontSize: 9, color: "var(--ab-text-dimmer)" }}>{c.src}</span>
              </div>
              <span
                data-uc="trigger-conv"
                onClick={() => {
                  const next: ConvItem[] = [{ file: c.file, st: "running" }, ...conv];
                  patch({ intake: intake.filter((x) => x.file !== c.file), conv: next });
                  toast("POST /api/conversion/trigger → 202 Accepted · " + c.file);
                }}
                className="hv-bright"
                style={{ textAlign: "center", fontSize: 11, color: "var(--ab-on-accent)", background: `linear-gradient(135deg,${ACCENT},var(--ab-accent-2))`, borderRadius: 7, padding: 6, cursor: "pointer", fontWeight: 700 }}
              >{L.trigger + " →"}</span>
            </div>
          ))}
          {intake.length === 0 ? <span style={{ fontSize: 11, color: "var(--ab-text-dimmer)", textAlign: "center", padding: "8px 0" }}>{L.empty}</span> : null}
        </div>
        <div data-prov="fixture" style={{ ...chipBox, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {colHead("② " + L.st_conv, String(conv.length))}
          {conv.map((c) => (
            <div key={c.file} style={{ ...innerBox, padding: 11, display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontFamily: MONO, fontSize: 11, color: "var(--ab-text)", flex: 1, wordBreak: "break-all" }}>{c.file}</span><span style={stChip(c.st)}>{c.st === "running" ? (zh ? "轉檔中" : "running") : c.st === "failed" ? (zh ? "失敗" : "failed") : (zh ? "完成" : "done")}</span></div>
              {c.st === "running" ? (
                <>
                  <div style={{ height: 5, borderRadius: 3, background: "rgba(120,160,210,.12)", overflow: "hidden" }}><div style={{ height: "100%", width: "62%", background: "linear-gradient(90deg,var(--ab-accent-2),var(--ab-accent))", borderRadius: 3, animation: "convbar 3s ease-in-out infinite alternate" }} /></div>
                  <span style={{ fontFamily: MONO, fontSize: 9, color: "var(--ab-text-dim)" }}>IFC→USDC · ifcopenshell + usd-core</span>
                </>
              ) : null}
              {c.st === "failed" ? (
                <span
                  onClick={() => {
                    patch({ conv: conv.map((x): ConvItem => (x.file === c.file ? { ...x, st: "running" } : x)) });
                    toast("POST /api/conversion/jobs/cj_0116/retry → 202");
                  }}
                  className="hv-danger-bg"
                  style={{ textAlign: "center", fontSize: 11, color: "var(--ab-danger)", border: "1px solid rgba(232,97,92,.35)", borderRadius: 7, padding: 5, cursor: "pointer" }}
                >{L.retry}</span>
              ) : null}
              {c.st === "done" ? (
                <>
                  <div style={{ display: "flex", gap: 5 }}><span style={{ fontFamily: MONO, fontSize: 9, color: "var(--ab-text-dim)" }}>model.usdc</span><span style={{ fontFamily: MONO, fontSize: 9, color: "var(--ab-text-dim)" }}>element_mapping.json</span><span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 9, color: "var(--ab-ok-text)" }}>{c.metrics ?? ""}</span></div>
                  <span
                    onClick={() => {
                      const id = "S-2407" + String(14 + sessions.length);
                      patch({ sessions: [...sessions, { id, lease: "unclaimed", stage: "/artifacts/" + c.file.replace(".ifc", "") + "/model.usdc" }] });
                      toast("POST /api/review-sessions → 201 · " + id);
                    }}
                    className="hv-bright"
                    style={{ textAlign: "center", fontSize: 11, color: "var(--ab-on-accent)", background: `linear-gradient(135deg,${ACCENT},var(--ab-accent-2))`, borderRadius: 7, padding: 6, cursor: "pointer", fontWeight: 700 }}
                  >{L.mksession + " →"}</span>
                </>
              ) : null}
            </div>
          ))}
        </div>
        <div data-prov="fixture" style={{ ...chipBox, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {colHead("③ Review Sessions", String(sessions.length))}
          {sessions.map((x) => (
            <div key={x.id} style={{ ...innerBox, padding: 11, display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--ab-accent-text)" }}>{x.id}</span>
                <span style={{ marginLeft: "auto", fontSize: "9.5px", color: "var(--ab-ok-text)", background: "rgba(49,197,109,.08)", border: "1px solid rgba(49,197,109,.22)", borderRadius: 4, padding: "1px 6px" }}>{x.lease}</span>
              </div>
              <span style={{ fontFamily: MONO, fontSize: "9.5px", color: "var(--ab-text-dim)", wordBreak: "break-all" }}>{x.stage}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <span
                  onClick={() => {
                    window.location.hash = "#a1";
                    toast("GET /ui/open?session=" + x.id + " → 302 viewer");
                  }}
                  className="hv-bright"
                  style={{ flex: 1, textAlign: "center", fontSize: "10.5px", color: "var(--ab-on-accent)", background: `linear-gradient(135deg,${ACCENT},var(--ab-accent-2))`, borderRadius: 7, padding: 5, cursor: "pointer", fontWeight: 700 }}
                >{"④ " + L.enter3d + " →"}</span>
                <span
                  onClick={() => toast("已複製 /ui/open?session=" + x.id)}
                  className="hv-text"
                  style={{ textAlign: "center", fontSize: "10.5px", color: "var(--ab-text-muted)", border: "1px solid rgba(120,160,210,.16)", borderRadius: 7, padding: "5px 8px", cursor: "pointer" }}
                >⧉ /ui/open</span>
                <span
                  onClick={() => toast("已複製 Spectator 邀請連結 /ui/open?session=" + x.id + "&streamRole=spectator(唯讀)")}
                  className="hv-accent-bg"
                  style={{ textAlign: "center", fontSize: "10.5px", color: "var(--ab-accent-text)", border: "1px solid rgba(65,199,232,.3)", borderRadius: 7, padding: "5px 8px", cursor: "pointer", whiteSpace: "nowrap" }}
                >+ Spectator</span>
              </div>
            </div>
          ))}
        </div>
        <div data-prov="fixture" style={{ ...chipBox, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: ".1em", color: "var(--ab-text-code)", textTransform: "uppercase" }}>⑤ Callback Outbox</span><span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: "var(--ab-warn)" }}>{`${outbox.filter((o) => o.st === "待送").length} ${L.pending}`}</span></div>
          {outbox.map((o) => (
            <div key={o.id} style={{ ...innerBox, padding: 10, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--ab-text)" }}>{o.id + " · " + o.kind}</span>
                <span style={{ fontSize: "9.5px", color: "var(--ab-text-dim)" }}>metadata-only → 雲端 bim-control</span>
              </div>
              <span style={o.st === "待送"
                ? { fontSize: "9.5px", color: "var(--ab-warn)", background: "rgba(230,178,62,.08)", border: "1px solid rgba(230,178,62,.3)", borderRadius: 4, padding: "2px 7px", fontFamily: MONO }
                : { fontSize: "9.5px", color: "var(--ab-ok-text)", background: "rgba(49,197,109,.08)", border: "1px solid rgba(49,197,109,.25)", borderRadius: 4, padding: "2px 7px", fontFamily: MONO }}
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
            style={{ textAlign: "center", fontSize: 11, color: "var(--ab-accent-text)", border: "1px solid rgba(65,199,232,.3)", borderRadius: 8, padding: 7, cursor: "pointer" }}
          >{L.deliver}</span>
        </div>
      </div>
      <div data-prov="fixture" style={{ ...chipBox, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center" }}><span style={{ fontSize: "13.5px", fontWeight: 700 }}>{"MinIO " + L.browse}</span><span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "9.5px", color: "var(--ab-text-dimmer)" }}>GET /api/minio/objects?delimiter=/</span></div>
        <div style={{ display: "flex", gap: 20, fontFamily: MONO, fontSize: 11 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, color: "var(--ab-text-muted)" }}>
            <span>▾ bucket/incoming</span>
            <span style={{ paddingLeft: 16, color: "var(--ab-text)" }}>demo_lib_2026.ifc <span style={{ color: "var(--ab-text-dimmer)" }}>· 48 MB</span></span>
            <span style={{ paddingLeft: 16, color: "var(--ab-text)" }}>松風庵_v3.ifc <span style={{ color: "var(--ab-text-dimmer)" }}>· 132 MB</span></span>
            <span>▸ bucket/processed</span>
            <span>▸ bucket/artifacts</span>
          </div>
          <div style={{ flex: 1, borderLeft: "1px solid rgba(120,160,210,.10)", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 5, color: "var(--ab-text-dim)", fontSize: "10.5px" }}>
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
