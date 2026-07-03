// web-viewer-sample/src/console/incomingHandoff.tsx
// 接收端 handoff 重驗（spec §4.2「接收端重驗鐵律」，硬性）：讀本軸的 incoming handoff，向頁面「已經
// 擁有」的權威資料重驗其攜帶的 id。verify predicate 只能查已在記憶體中的權威資料——不得多發新 fetch、
// 不得打新端點（N2/N4）。查無 → 誠實 not_found，絕不靜默 fallback 到別的紀錄，讓使用者手動重選。
import { parseHandoff, type AxisKey, type CrossAxisHandoff } from "./handoff";
import { t } from "./i18n";

export type HandoffVerifyStatus = "none" | "verified" | "not_found";

export function useIncomingHandoff(
  selfAxis: AxisKey,
  verify: (h: CrossAxisHandoff) => boolean,
  hash: string = typeof window !== "undefined" ? window.location.hash : "",
): { handoff: CrossAxisHandoff | null; status: HandoffVerifyStatus } {
  const handoff = parseHandoff(hash);
  // 只回應目標路由是本頁的 handoff（hash 以 #<selfAxis> 開頭）；其餘（含無 handoff）一律 status="none"。
  if (!handoff || !hash.startsWith(`#${selfAxis}`)) return { handoff: null, status: "none" };
  return { handoff, status: verify(handoff) ? "verified" : "not_found" };
}

function handoffIdText(h: CrossAxisHandoff): string {
  return h.session ?? h.minio_key ?? h.job_id ?? h.conversion_id ?? h.rule_run_id ?? h.prefix ?? "";
}

export function IncomingHandoffBanner({ testId, handoff, status }: { testId: string; handoff: CrossAxisHandoff | null; status: HandoffVerifyStatus }) {
  if (!handoff || status === "none") return null;
  const id = handoffIdText(handoff);
  return (
    <div className={`ec-note ${status === "not_found" ? "ec-warn-note" : ""}`} data-testid={testId} data-handoff-status={status} data-handoff-source={handoff.source}>
      {status === "verified"
        ? t(`已接收來自 ${handoff.source} 的 ${id}（已向權威端點重驗）`, `Received ${id} from ${handoff.source} (re-verified against the authoritative endpoint)`)
        : t(`來自 ${handoff.source} 的 ${id} 在權威資料中查無，請手動重選（未靜默 fallback）`, `${id} from ${handoff.source} was not found in authoritative data; please reselect (no silent fallback)`)}
    </div>
  );
}
