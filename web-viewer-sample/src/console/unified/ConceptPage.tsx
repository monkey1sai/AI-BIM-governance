// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — Concept 頁（A5–A10 概念稿）
// 像素級移植正本：scratchpad/design-origin/app.js（/* ═══ CONCEPT (A5–A10) ═══ */ 區塊）
// 所有 inline style / 文案 byte-identical；fixture 資料一律 import 自 ./fixtures。
// 大圖 src 改指產品資產路徑 /design-assets/（由 conceptMeta.img 的 uploads/ 前綴替換），
// 圖檔缺失時比照原型 App.conceptFallback：以原生占位卡取代 <img>。不打任何 /api。
// ═══════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { useLang } from "../i18n";
import { MONO, getL, appEn, chipBox, conceptFeat, conceptMeta } from "./fixtures";
import type { ConceptKey } from "./fixtures";

export interface ConceptPageProps {
  /** 概念頁 key（a5..a10），對應 hash route #a5..#a10。 */
  slug: ConceptKey;
}

export function ConceptPage({ slug }: ConceptPageProps) {
  const lang = useLang();
  const zh = lang === "zh";
  const L = getL(zh);

  const cm = conceptMeta[slug];
  const feats = zh ? conceptFeat[slug].zh : conceptFeat[slug].en;
  const code = slug.toUpperCase() as Uppercase<ConceptKey>;
  const title = zh ? cm.titleZh : cm.titleEn;
  /* 原型 img src = "uploads/ai-bim-geo-viewer-A<N>.png"；產品資產落點 /design-assets/ */
  const imgSrc = cm.img.replace("uploads/", "/design-assets/");

  /* 原型 onerror="App.conceptFallback(this)"：換頁重建 DOM 會重試載圖 → 以 per-slug 記錄還原同語意 */
  const [failedSlug, setFailedSlug] = useState<ConceptKey | null>(null);
  const imgFailed = failedSlug === slug;

  const monoInline = { fontFamily: MONO, color: "#b9c9da" } as const;

  return (
    <div data-prov="fixture" style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 22px", borderBottom: "1px solid rgba(120,160,210,.10)", background: "#0a1018" }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{title}</span>
        <span style={{ fontSize: 10, color: "#e6b23e", background: "rgba(230,178,62,.1)", border: "1px solid rgba(230,178,62,.3)", borderRadius: 5, padding: "2px 8px", fontFamily: MONO }}>Concept Preview / Roadmap</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#5a7089" }}>{L.concept_note}</span>
      </div>
      {imgFailed ? (
        <div>
          <div style={{ padding: "40px 48px", display: "flex", flexDirection: "column", gap: 22, maxWidth: 980 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 64, height: 64, borderRadius: 16, background: "radial-gradient(circle at 35% 35%,rgba(157,140,255,.55),rgba(47,123,246,.3) 60%,rgba(10,16,24,.2))", border: "1px solid rgba(157,140,255,.35)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 17, fontWeight: 600, color: "#c9befc" }}>{code}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 22, fontWeight: 700 }}>{title}</span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: "#8f81d8" }}>{`${appEn[code]} · Roadmap Phase ${slug === "a5" ? "P3" : "P4"}`}</span>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {feats.map((f, i) => (
                <div key={f} style={{ ...chipBox, padding: "14px 16px", display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: "#5a8db0", paddingTop: 2 }}>{`0${i + 1}`}</span>
                  <span style={{ fontSize: "12.5px", color: "#b9c9da", lineHeight: 1.55 }}>{f}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, border: "1px dashed rgba(230,178,62,.35)", borderRadius: 10, padding: "12px 16px" }}>
              <span style={{ fontSize: 13 }}>🖼</span>
              <span style={{ fontSize: "11.5px", color: "#8aa0b8", lineHeight: 1.6 }}>
                {zh ? (
                  <>
                    {"原始概念稿 "}<span style={monoInline}>{cm.img}</span>{" 未隨程式碼打包(檔案超過設計匯出上限)。將原圖放入 "}<span style={monoInline}>uploads/</span>{" 目錄即自動顯示。"}
                  </>
                ) : (
                  <>
                    {"Original concept mock "}<span style={monoInline}>{cm.img}</span>{" is not bundled (exceeds design export cap). Drop the file into "}<span style={monoInline}>uploads/</span>{" and it will render automatically."}
                  </>
                )}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <img src={imgSrc} alt="" style={{ width: "100%", display: "block" }} onError={() => setFailedSlug(slug)} />
      )}
    </div>
  );
}
