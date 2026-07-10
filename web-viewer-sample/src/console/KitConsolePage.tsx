// CH-E：Kit Manager 模型台 React 頁（#/kit）。
// 由 vanilla dev-console Kit panel 忠實移植：沿用相同 data-testid 與輸出格式（"<status> ..."），
// 全部經 coordinator /api/kit/* 同源 forward proxy（瀏覽器禁直連 :8010；RK1 Kit 控制權威留 kit-manager）。
// 誠實鐵律：HTTP 狀態碼原樣顯示（含非 200 / error），不偽造成功。
import { useState } from "react";
import { t } from "./i18n";
// W4：raw fetch 語意保留（狀態碼原樣顯示），base 解析統一走 coordinatorUrl（修 dev :5173→:8004 斷裂）。
import { coordinatorUrl } from "./coordinatorClient";

const DASH = "—";

export function KitConsolePage() {
  const [health, setHealth] = useState<string>(DASH);
  const [instance, setInstance] = useState<string>(DASH);
  const [usdcCount, setUsdcCount] = useState<string>(DASH);

  async function go() {
    setHealth("…"); setInstance("…"); setUsdcCount("…");
    // 三個欄位皆走 coordinator /api/kit/*（forward → kit-manager :8010 loopback），原樣顯示 status code。
    try {
      const r = await fetch(coordinatorUrl("/api/kit/health"));
      const j = await r.json().catch(() => ({}));
      setHealth(r.status + " " + (j.status || j.kit_status || JSON.stringify(j).slice(0, 60)));
    } catch (e) { setHealth("error: " + (e instanceof Error ? e.message : String(e))); }
    try {
      const r = await fetch(coordinatorUrl("/api/kit/instances/current"));
      const j = await r.json().catch(() => ({}));
      setInstance(r.status + " status=" + (j.status || j.state || JSON.stringify(j).slice(0, 50)));
    } catch (e) { setInstance("error: " + (e instanceof Error ? e.message : String(e))); }
    try {
      const r = await fetch(coordinatorUrl("/api/kit/usdc"));
      const j = await r.json().catch(() => ({}));
      const arr = Array.isArray(j) ? j : (j.items || j.artifacts || j.usdc || []);
      setUsdcCount(r.status + " count=" + (Array.isArray(arr) ? arr.length : "?"));
    } catch (e) { setUsdcCount("error: " + (e instanceof Error ? e.message : String(e))); }
  }

  const rows: [string, string, string][] = [
    ["GET /api/kit/health", "kit-health", health],
    ["GET /api/kit/instances/current", "kit-instance", instance],
    ["GET /api/kit/usdc", "kit-usdc-count", usdcCount],
  ];

  return (
    <section data-testid="kit-proxy-panel" style={{ padding: 12 }}>
      <h1>{t("Kit Manager 模型台（經 /api/kit proxy）", "Kit Manager Model Console (via /api/kit proxy)")}</h1>
      <p className="ec-lead">
        {t("瀏覽器一律打 coordinator ", "The browser always calls coordinator ")}<code>:8004 /api/kit/*</code>{t("（forward → kit-manager ", "(forward → kit-manager ")}<code>:8010</code>{t(" loopback）；\n        禁直連 :8010。RK1：Kit 控制權威留 kit-manager，coordinator 只轉發（變更型需 operator/dev 授權）。", " loopback). Direct connection to :8010 is forbidden. RK1: Kit control authority stays with kit-manager; coordinator only forwards (mutating operations require operator/dev authorization).")}
      </p>
      <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
        <button data-testid="kit-status-btn" className="ec-btn primary" onClick={() => void go()}>{t("查 Kit 狀態 + USDC（經 proxy）", "Check Kit status + USDC (via proxy)")}</button>
      </div>
      <table style={{ width: "100%", fontSize: 13, textAlign: "left", borderCollapse: "collapse" }}>
        <tbody>
          {rows.map(([label, tid, val]) => (
            <tr key={tid}>
              <td style={{ color: "#94a3b8", padding: "3px 8px" }}>{label}</td>
              <td data-testid={tid} style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{val}</td>
            </tr>
          ))}
          <tr>
            <td style={{ color: "#94a3b8", padding: "3px 8px" }}>proxy boundary</td>
            <td data-testid="kit-proxy-note">{t("瀏覽器 → :8004 /api/kit/*（forward → :8010，無直連）", "Browser → :8004 /api/kit/* (forward → :8010, no direct connection)")}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
