// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — Concept 頁（A5–A10 概念稿）
// 像素級移植正本：scratchpad/design-origin/app.js（/* ═══ CONCEPT (A5–A10) ═══ */ 區塊）
// 所有 inline style / 文案 byte-identical；fixture 資料一律 import 自 ./fixtures。
// 大圖 src 改指產品資產路徑 /design-assets/（由 conceptMeta.img 的 uploads/ 前綴替換），
// 圖檔缺失時比照原型 App.conceptFallback：以原生占位卡取代 <img>。不打任何 /api。
// ═══════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { useLang } from "../i18n";
import { getL, appEn, chipBox, conceptFeat, conceptMeta } from "./fixtures";
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
  /* 原型 img src = "uploads/ai-bim-geo-viewer-A<N>.png"；產品資產落點 design-assets/。
     BASE_URL 感知：build:ui base='/ui/' 下根絕對路徑會 404（概念稿大圖破圖）。 */
  const imgSrc = cm.img.replace("uploads/", `${import.meta.env.BASE_URL}design-assets/`);

  /* 原型 onerror="App.conceptFallback(this)"：換頁重建 DOM 會重試載圖 → 以 per-slug 記錄還原同語意 */
  const [failedSlug, setFailedSlug] = useState<ConceptKey | null>(null);
  const imgFailed = failedSlug === slug;

  const monoInline = { fontFamily: "var(--ab-mono)", color: "var(--ab-text-2)" } as const;

  return (
    <div data-prov="fixture" data-uc="concept-root" style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-4)", padding: "var(--ab-space-5) var(--ab-space-7)", borderBottom: "var(--ab-space-px-1) solid var(--ab-border-a10)", background: "var(--ab-bar)" }}>
        <span style={{ fontSize: "var(--ab-fs-h3)", fontWeight: "var(--ab-fw-700)" }}>{title}</span>
        <span style={{ fontSize: "var(--ab-fs-10)", color: "var(--ab-warn)", background: "var(--ab-warn-a10)", border: "var(--ab-space-px-1) solid var(--ab-warn-a30)", borderRadius: "var(--ab-r-px-5)", padding: "var(--ab-space-px-2) var(--ab-space-3)", fontFamily: "var(--ab-mono)" }}>Concept Preview / Roadmap</span>
        <span style={{ marginLeft: "auto", fontSize: "var(--ab-fs-mono)", color: "var(--ab-text-dim)" }}>{L.concept_note}</span>
      </div>
      {imgFailed ? (
        <div data-uc="concept-fallback">
          <div style={{ padding: "var(--ab-space-px-40) var(--ab-space-px-48)", display: "flex", flexDirection: "column", gap: "var(--ab-space-7)", maxWidth: 980 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-px-14)" }}>
              <div style={{ width: 64, height: 64, borderRadius: "var(--ab-r-px-16)", background: "radial-gradient(circle at 35% 35%,var(--ab-violet-a55),var(--ab-accent-2-a30) 60%,var(--ab-bar-a20))", border: "var(--ab-space-px-1) solid var(--ab-violet-a35)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-17)", fontWeight: "var(--ab-fw-600)", color: "var(--ab-violet-bright)" }}>{code}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--ab-space-1)" }}>
                <span style={{ fontSize: "var(--ab-fs-22)", fontWeight: "var(--ab-fw-700)" }}>{title}</span>
                <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-mono)", color: "var(--ab-violet-dim)" }}>{`${appEn[code]} · Roadmap Phase ${slug === "a5" ? "P3" : "P4"}`}</span>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--ab-space-4)" }}>
              {feats.map((f, i) => (
                <div key={f} style={{ ...chipBox, padding: "var(--ab-space-px-14) var(--ab-space-6)", display: "flex", gap: "var(--ab-space-4)", alignItems: "flex-start" }}>
                  <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-10)", color: "var(--ab-text-code)", paddingTop: "var(--ab-space-px-2)" }}>{`0${i + 1}`}</span>
                  <span style={{ fontSize: "var(--ab-fs-12-5)", color: "var(--ab-text-2)", lineHeight: "var(--ab-lh-155)" }}>{f}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-4)", border: "var(--ab-space-px-1) dashed var(--ab-warn-a35)", borderRadius: "var(--ab-r-lg)", padding: "var(--ab-space-5) var(--ab-space-6)" }}>
              <span style={{ fontSize: "var(--ab-fs-sm)" }}>🖼</span>
              <span style={{ fontSize: "var(--ab-fs-11-5)", color: "var(--ab-text-muted)", lineHeight: "var(--ab-lh-160)" }}>
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
        <img data-uc="concept-img" src={imgSrc} alt="" style={{ width: "100%", display: "block" }} onError={() => setFailedSlug(slug)} />
      )}
    </div>
  );
}
