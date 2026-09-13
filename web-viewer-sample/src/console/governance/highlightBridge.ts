// web-viewer-sample/src/console/governance/highlightBridge.ts
// HighlightBridge：治理失敗構件 usd_prim_path → highlightPrimsRequest → 經注入的 sendMessage（既有
// _sendStreamMessage / AppStreamer.sendMessage）走 viewer WebRTC DataChannel 在 3D 標紅。
// 著色走 client 主動拉（client → DataChannel → Kit），不復活 2026-05-21 退役的 server-push highlight。
// 未對映 / DataChannel 未就緒誠實回拒（不捏造 prim、不假裝成功）。
import { buildHighlightPrimsRequest, severityToColor } from "../../clients/streamMessages";
import type { HighlightItem, StreamMessage } from "../../types/streamMessages";
import type { MappingCache } from "./mappingCache";

export interface FailedElement {
  ifc_guid: string;
  severity: string; // error / warning / ...
  label?: string;
  rule_code?: string;
  color?: [number, number, number, number] | number[];
}

export type HighlightResult =
  | { ok: true; primPath: string; requestId: string }
  | { ok: false; reason: "unmapped" | "datachannel_not_ready" };

// 批次疊加使用一個 replace request 原子替換 Kit 材質層，保留每個構件的嚴重度與顏色。
// 逐筆 replace 只會留下最後一筆；unmapped 逐 GUID 回列，實際套用仍須等待 Kit ACK。
export type HighlightManyResult =
  | { ok: true; requestId: string; sent: { ifc_guid: string; primPath: string }[]; unmapped: string[] }
  | { ok: false; reason: "unmapped" | "datachannel_not_ready" };

// severityToColor 只特判 "error"/"warning"，其餘一律藍。治理 rule engine 可能吐 critical/high/required/medium/low
// 等其他標籤，先正規化成 severityToColor 認得的 error/warning（大小寫不敏感），其餘原樣透傳（→ 預設藍）。
// 不改 severityToColor 本身（共用於 mapping-verify 等既有路徑）。
export function normalizeSeverity(sev: string): string {
  const s = sev.toLowerCase();
  if (s === "critical" || s === "high" || s === "error" || s === "required") return "error";
  if (s === "medium" || s === "warning") return "warning";
  return s;
}

export interface HighlightBridgeDeps {
  cache: MappingCache;
  sendMessage: (message: StreamMessage) => unknown;
  dataChannelReady: () => boolean;
}

export class HighlightBridge {
  constructor(private readonly deps: HighlightBridgeDeps) {}

  highlightFailed(failed: FailedElement): HighlightResult {
    if (!this.deps.dataChannelReady()) {
      return { ok: false, reason: "datachannel_not_ready" };
    }
    const primPath = this.deps.cache.primPathForGuid(failed.ifc_guid); // fake cache → null
    if (!primPath) {
      return { ok: false, reason: "unmapped" };
    }
    const resolvedColor = failed.color && Array.isArray(failed.color) && failed.color.length >= 3
      ? failed.color
      : severityToColor(normalizeSeverity(failed.severity));
    const item: HighlightItem = {
      prim_path: primPath,
      severity: failed.severity,
      ifc_guid: failed.ifc_guid,
      color: resolvedColor,
      label: failed.label || failed.rule_code || failed.ifc_guid,
      source: "governance_failed",
      issue_id: failed.rule_code ? `gov:${failed.rule_code}:${failed.ifc_guid}` : `gov:${failed.ifc_guid}`,
    };
    const requestId = `gov-highlight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (this.deps.sendMessage(buildHighlightPrimsRequest([item], false, requestId)) === false) {
      return { ok: false, reason: "datachannel_not_ready" };
    }
    return { ok: true, primPath, requestId };
  }

  // 批次疊加（A2 diff overlay）：全部可對映構件裝進「一個」highlightPrimsRequest（mode:"replace"）
  // → Kit 一次替換材質層。per-item color 依 severity 對映（紅／黃／藍），或使用自訂 RGBA。
  // focusFirst=false：批次疊加不改相機或選取；定位與清除選取由各自的命令處理。
  highlightMany(failedList: FailedElement[]): HighlightManyResult {
    if (!this.deps.dataChannelReady()) {
      return { ok: false, reason: "datachannel_not_ready" };
    }
    const items: HighlightItem[] = [];
    const sent: { ifc_guid: string; primPath: string }[] = [];
    const unmapped: string[] = [];
    for (const failed of failedList) {
      const primPath = this.deps.cache.primPathForGuid(failed.ifc_guid); // fake cache → null（誠實 unmapped）
      if (!primPath) {
        unmapped.push(failed.ifc_guid);
        continue;
      }
      const resolvedColor = failed.color && Array.isArray(failed.color) && failed.color.length >= 3
        ? failed.color
        : severityToColor(normalizeSeverity(failed.severity));
      items.push({
        prim_path: primPath,
        severity: failed.severity,
        ifc_guid: failed.ifc_guid,
        color: resolvedColor,
        label: failed.label || failed.rule_code || failed.ifc_guid,
        source: "governance_failed",
        issue_id: failed.rule_code ? `gov:${failed.rule_code}:${failed.ifc_guid}` : `gov:${failed.ifc_guid}`,
      });
      sent.push({ ifc_guid: failed.ifc_guid, primPath });
    }
    if (items.length === 0) {
      // 全數未對映 → 不送空 request（誠實回拒，不假裝成功）。
      return { ok: false, reason: "unmapped" };
    }
    const requestId = `gov-highlight-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (this.deps.sendMessage(buildHighlightPrimsRequest(items, false, requestId)) === false) {
      return { ok: false, reason: "datachannel_not_ready" };
    }
    return { ok: true, requestId, sent, unmapped };
  }
}
