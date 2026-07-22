// ── stream-config 讀取器（D2-A′ 抽出葉子模組）：CoordinatorGovernanceTabs 的 ──
// Terminal/Debug 分頁掛載此元件，使 stream-config 入口在 #runtime（承接 CoordinatorPage）後不孤兒。
// 自取資料（coordinatorClient.streamConfig）、零 props、誠實 read-only：不開串流、不捏造遙測。
//
// 為何獨立成葉子檔（非留在 pages.tsx）：pages.tsx 與 coordinator/RuntimeGovernanceTabs.tsx 互相 import
// 會形成循環依賴（pages → RuntimeGovernanceTabs → pages）。Vite/Rollup 的 ES module live-binding 讓
// build/test 仍過，但一旦初始化順序改變（SSR entry、非 Vite runner、動態 import code-split），
// StreamConfigReader 取值可能為 undefined → React 靜默不渲染，正好違反 D2-A′「stream-config 不孤兒」合約且
// 測試抓不到。抽成 leaf 檔讓 CoordinatorGovernanceTabs 直接 import，即根治此循環。
import { useCallback, useState } from "react";
import { Btn, Panel } from "./components";
import { coordinatorClient } from "./coordinatorClient";
import { t } from "./i18n";

export function StreamConfigReader() {
  const [scSession, setScSession] = useState("");
  const [sc, setSc] = useState<string | null>(null);
  const [scErr, setScErr] = useState<string | null>(null);
  // 對齊 ReviewRoomPage（pages.tsx）的 session-id 格式守門：需 lwv_ / review_session_ 前綴 + 英數底線。
  // 不符者 coordinator stream-config 端點直接回 400，故前置 disable、不發出注定失敗的請求（誠實鐵律：不偽裝可操作）。
  const valid = /^(lwv_|review_session_)[A-Za-z0-9_]+$/.test(scSession.trim());

  const fetchStreamConfig = useCallback(async () => {
    if (!valid) return;
    setScErr(null); setSc(null);
    try { setSc(JSON.stringify(await coordinatorClient.streamConfig(scSession.trim()), null, 2)); }
    catch (e) { setScErr(`${t("stream-config 讀取失敗：", "Failed to read stream-config: ")}${String(e)}`); }
  }, [scSession, valid]);

  return (
    <Panel title={t("stream-config · 給 viewer 的連線資訊", "stream-config · connection info for the viewer")} sub="GET /api/review-sessions/:id/stream-config（coordinator owner）" prov="asbuilt">
      <div style={{ display: "flex", gap: "var(--ab-space-3)", alignItems: "center", flexWrap: "wrap" }}>
        <input className="ec-btn" style={{ minWidth: 320 }} placeholder="review_session_id" value={scSession} onChange={(e) => setScSession(e.target.value)} />
        <Btn disabled={!valid} caption="GET …/stream-config" onClick={fetchStreamConfig}>{t("讀取 stream-config", "Read stream-config")}</Btn>
      </div>
      {!valid && scSession.length > 0 && <p className="ec-warn-note">{t("此 session id 不符格式（需 lwv_ 或 review_session_ 前綴 + 英數底線）；coordinator stream-config 會回 400 → 按鈕停用，不發出壞請求。", "This session id does not match the format (needs lwv_ or review_session_ prefix + alphanumerics/underscores); coordinator stream-config returns 400 → the button is disabled to avoid a bad request.")}</p>}
      {scErr && <p className="ec-warn-note">{scErr}</p>}
      {sc && <pre className="ec-note" style={{ whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}>{sc}</pre>}
      <p className="ec-note">{t("stream-config 為 coordinator owner 的真實端點；GPU 串流由 host-native Kit 負責，本面板僅唯讀轉發連線資訊，不開串流、不捏造遙測。", "stream-config is a real endpoint owned by the coordinator; GPU streaming is handled by host-native Kit. This panel only forwards connection info read-only; it does not open streams or fabricate telemetry.")}</p>
    </Panel>
  );
}
