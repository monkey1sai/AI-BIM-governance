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
}

export type HighlightResult =
  | { ok: true; primPath: string; requestId: string }
  | { ok: false; reason: "unmapped" | "datachannel_not_ready" };

export interface HighlightBridgeDeps {
  cache: MappingCache;
  sendMessage: (message: StreamMessage) => void;
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
    const item: HighlightItem = {
      prim_path: primPath,
      ifc_guid: failed.ifc_guid,
      color: severityToColor(failed.severity),
      label: failed.label || failed.rule_code || failed.ifc_guid,
      source: "governance_failed",
      issue_id: failed.rule_code ? `gov:${failed.rule_code}:${failed.ifc_guid}` : `gov:${failed.ifc_guid}`,
    };
    const requestId = `gov-highlight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.deps.sendMessage(buildHighlightPrimsRequest([item], true, requestId));
    return { ok: true, primPath, requestId };
  }

  clear(buildClear: () => StreamMessage): void {
    if (!this.deps.dataChannelReady()) return;
    this.deps.sendMessage(buildClear());
  }
}
