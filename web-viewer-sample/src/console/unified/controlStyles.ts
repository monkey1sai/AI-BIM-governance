import type { CSSProperties } from "react";

export const controlField: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--ab-border)", background: "var(--ab-surface)", color: "var(--ab-text)" };

/**
 * 全域 reboot CSS 的 `legend { float: left; width: 100%; font-size: calc(1.275rem + .3vw) }` 會穿過 .uc-root 防火牆
 * （`:where()` 的優先度是 0）：legend 被放大到約 24px，而且浮動的 legend 不再是 fieldset 的標題，在 grid fieldset 裡會變成一格。
 */
export const fieldsetLegend: CSSProperties = { float: "none", width: "auto", padding: "0 4px", marginBottom: 0, fontSize: "inherit", lineHeight: "inherit", fontWeight: 600 };
