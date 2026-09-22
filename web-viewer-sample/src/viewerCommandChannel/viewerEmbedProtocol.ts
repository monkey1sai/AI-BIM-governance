// Viewer Embed Protocol（vg01）：console 與 viewer iframe 之間全部 postMessage 訊息的唯一宣告。
// 兩端在同一個 bundle，型別就是漂移檢查；沒有 JSON schema 副本（見 docs/architecture/viewer-command-channel-adr.md）。
// 兩端收到的訊息都是未驗證輸入：console 端用 parseViewerEvent，viewer 端用 parseViewerLeaseToken 與 Channel 的解析器。
import type { CameraState, CameraViewInput, CommandReason } from "./camera";
import type { MeasurementAction, MeasurementState } from "./measurement";
import type { SectionInput, SectionReply } from "./sectionPlane";
import type { OverlayStyleInput } from "./overlayStyle";

export const VIEWER_EMBED_PROTOCOL = "vg01" as const;

// ─── console → viewer ───────────────────────────────────────────────────────

/** Viewer Command Channel 擁有的指令。 */
export type ViewerCommandRequest =
  | { type: "camera_view"; camera: CameraViewInput; clientRequestId: string }
  | { type: "camera_state"; clientRequestId: string }
  | { type: "fly_navigation"; speed: number; clientRequestId: string }
  | { type: "overlay_style"; style: OverlayStyleInput; clientRequestId: string }
  | { type: "section_plane"; section: SectionInput; clientRequestId: string }
  | { type: "measurement_control"; action: MeasurementAction };

export type ViewerCommandType = ViewerCommandRequest["type"];

export interface HighlightItem {
  ifc_guid: string;
  severity?: string;
  label?: string;
  rule_code?: string | null;
  color?: [number, number, number, number] | number[];
}

export type ToolbarAction = "reset_camera" | "frame_all" | "camera_view" | "toggle_fullscreen" | "toggle_projection";

/** viewer 憑證只走這個訊息；其他任何訊息都不得攜帶 token 欄位。 */
export interface ViewerLeaseTokenMessage { type: "viewer_lease_token"; token: string; user_token?: string }

/** console → viewer 的其餘訊息（highlight 家族與 stage 樹，留待下一批收進 Channel）。 */
/** console → viewer：以既有 stage-binding 交易套用一組 artifact（primary + secondary）。S3 CFD 疊圖使用。 */
export interface StageBindingSelection { artifact_id: string; role: "primary" | "secondary"; load_order: number }

export type ViewerParentMessage =
  | ViewerCommandRequest
  | ViewerLeaseTokenMessage
  | { type: "highlight"; items: HighlightItem[]; clientRequestId?: string }
  | { type: "highlight_batch"; items: HighlightItem[]; clientRequestId?: string }
  | { type: "focus"; ifc_guid: string; clientRequestId?: string }
  | { type: "clear"; clientRequestId?: string }
  | { type: "clear_selection"; clientRequestId?: string }
  | { type: "request_stage_tree"; prim_path?: string }
  | { type: "select_prim"; prim_path: string; multi_select?: boolean }
  | { type: "toolbar_action"; action: ToolbarAction; camera_view?: string }
  | { type: "apply_stage_binding"; artifacts: StageBindingSelection[]; clientRequestId?: string };

// ─── viewer → console ───────────────────────────────────────────────────────

type ReplyStatus = "applied" | "unconfirmed" | "error";
type Correlation = { clientRequestId?: string; requestId?: string; reason?: CommandReason };

/** Viewer Command Channel 的回覆與狀態推送。 */
export type ViewerCommandReply =
  | ({ type: "camera_view_result" | "camera_state_result"; status: ReplyStatus; camera?: CameraState } & Correlation)
  | ({ type: "fly_navigation_result"; status: ReplyStatus; speed?: number } & Correlation)
  | ({ type: "overlay_style_result"; status: ReplyStatus; primPath?: string; displayOpacity?: number } & Correlation)
  | ({ type: "section_result" } & SectionReply)
  | ({ type: "measurement_state" } & MeasurementState);

export interface USDPrimNode {
  name?: string;
  path: string;
  type?: string;
  children?: USDPrimNode[];
}

export interface FirstFrameMessage { protocol: "vg01"; type: "first_frame"; stageUrl: string | null }
export interface StreamStateMessage { protocol: "vg01"; type: "stream_state"; state: "disconnected"; kind: "stopped" | "terminated" }
export interface StageLoadedMessage {
  protocol: "vg01";
  type: "stage_loaded";
  stageUrl: string | null;
  status: "active" | "unproven";
  binding_revision_id?: string;
}
export interface HighlightResultMessage {
  protocol: "vg01"; type: "highlight_result"; requestId: string;
  // console 為每個指令建立的本地關聯 ID；Kit requestId 是 runtime 實際請求 ID，兩者不可互換。
  clientRequestId?: string;
  ok: boolean; reason?: string;
  applied_mode?: string;
  applied_count?: number;
  applied_paths?: string[];
  unsupported_paths?: string[];
  missing_paths?: string[];
  renderer_mode?: string;
  // 批次（highlight_batch）專屬：實際裝進單一 highlightPrimsRequest 的筆數與解不出 prim 的 GUID。
  sent_count?: number;
  unmapped_count?: number;
  unmapped_guids?: string[];
}
export interface IssueViewResultMessage extends Omit<HighlightResultMessage, "type"> {
  type: "issue_view_result";
  action: "clear" | "focus" | "clear_selection";
}
export interface SelectedGuidMessage { protocol: "vg01"; type: "selected_guid"; ifcGuid: string | null }
export interface StageTreeMessage {
  protocol: "vg01";
  type: "stage_tree";
  prim_path: string;
  children: USDPrimNode[];
  selected_paths?: string[];
}
export interface ViewerReadyMessage { protocol: "vg01"; type: "viewer_ready" }
/**
 * viewer → console：apply_stage_binding 的終態。applied 只在 Kit 以 openedStageResult／bindingApplied 確認後送出；
 * applied_secondary_layers 是 Kit 回報實際套用的 secondary artifact_id（缺席＝Kit 未回報，不是空集合）。
 */
export interface StageBindingResultMessage {
  protocol: "vg01";
  type: "stage_binding_result";
  status: "applied" | "failed";
  clientRequestId?: string;
  revision_id: string | null;
  reason?: string;
  applied_secondary_layers?: string[];
}

/** viewer → console 中不屬於 Channel 的事件；console 只能經 parseViewerEvent 取得。 */
export type ViewerEvent =
  | ViewerReadyMessage
  | FirstFrameMessage
  | StreamStateMessage
  | StageLoadedMessage
  | HighlightResultMessage
  | IssueViewResultMessage
  | SelectedGuidMessage
  | StageTreeMessage
  | StageBindingResultMessage;

// ─── parsers ────────────────────────────────────────────────────────────────

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const optionalString = (value: unknown): value is string | undefined => value === undefined || typeof value === "string";
const stringOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const CREDENTIAL_KEYS = ["token", "user_token", "viewer_lease_token"];
const ISSUE_VIEW_ACTIONS = ["clear", "focus", "clear_selection"];

/** 憑證只能出現在 viewer_lease_token；任何事件夾帶 token 欄位一律整筆丟棄。 */
export function carriesCredential(message: Record<string, unknown>): boolean {
  return CREDENTIAL_KEYS.some(key => key in message);
}

function isPrimNode(value: unknown): value is USDPrimNode {
  return record(value) && typeof value.path === "string"
    && optionalString(value.name) && optionalString(value.type)
    && (value.children === undefined || (Array.isArray(value.children) && value.children.every(isPrimNode)));
}

const STAGE_BINDING_ROLES = ["primary", "secondary"];

/** viewer 端解析 apply_stage_binding 的 artifacts；格式不符回 null（不套用半組）。 */
export function parseStageBindingSelection(value: unknown): StageBindingSelection[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) return null;
  const out: StageBindingSelection[] = [];
  for (const item of value) {
    if (!record(item) || typeof item.artifact_id !== "string" || !item.artifact_id || item.artifact_id.length > 240) return null;
    if (!STAGE_BINDING_ROLES.includes(item.role as string)) return null;
    if (typeof item.load_order !== "number" || !Number.isInteger(item.load_order) || item.load_order < 0) return null;
    out.push({ artifact_id: item.artifact_id, role: item.role as "primary" | "secondary", load_order: item.load_order });
  }
  return out.filter(item => item.role === "primary").length === 1 ? out : null;
}

function highlightResultFields(m: Record<string, unknown>): boolean {
  return typeof m.requestId === "string" && typeof m.ok === "boolean" && optionalString(m.clientRequestId) && optionalString(m.reason);
}

/**
 * console 端唯一的 viewer 事件入口。回傳 null 表示格式不符或夾帶憑證，呼叫端不得再用原始物件。
 * stage_loaded 缺 status 不是可忽略的舊版成功：正規化成 unproven，讓 console 清掉先前的 active URL。
 */
export function parseViewerEvent(value: unknown): ViewerEvent | null {
  if (!record(value) || value.protocol !== VIEWER_EMBED_PROTOCOL || carriesCredential(value)) return null;
  const m = value;
  switch (m.type) {
    case "viewer_ready":
      return { protocol: "vg01", type: "viewer_ready" };
    case "first_frame":
      return stringOrNull(m.stageUrl) ? { protocol: "vg01", type: "first_frame", stageUrl: m.stageUrl } : null;
    case "stream_state":
      return m.state === "disconnected" && (m.kind === "stopped" || m.kind === "terminated")
        ? { protocol: "vg01", type: "stream_state", state: "disconnected", kind: m.kind } : null;
    case "stage_loaded": {
      const revision = typeof m.binding_revision_id === "string" && m.binding_revision_id ? { binding_revision_id: m.binding_revision_id } : {};
      if (m.status === "active" || m.status === "unproven") {
        return stringOrNull(m.stageUrl) ? { protocol: "vg01", type: "stage_loaded", stageUrl: m.stageUrl, status: m.status, ...revision } : null;
      }
      return { protocol: "vg01", type: "stage_loaded", stageUrl: null, status: "unproven", ...revision };
    }
    case "highlight_result":
      return highlightResultFields(m) ? { ...(m as unknown as HighlightResultMessage), protocol: "vg01", type: "highlight_result" } : null;
    case "issue_view_result":
      return highlightResultFields(m) && ISSUE_VIEW_ACTIONS.includes(m.action as string)
        ? { ...(m as unknown as IssueViewResultMessage), protocol: "vg01", type: "issue_view_result" } : null;
    case "selected_guid":
      return stringOrNull(m.ifcGuid) ? { protocol: "vg01", type: "selected_guid", ifcGuid: m.ifcGuid } : null;
    case "stage_tree":
      return typeof m.prim_path === "string" && Array.isArray(m.children) && m.children.every(isPrimNode)
        && (m.selected_paths === undefined || (Array.isArray(m.selected_paths) && m.selected_paths.every(path => typeof path === "string")))
        ? { protocol: "vg01", type: "stage_tree", prim_path: m.prim_path, children: m.children,
          ...(m.selected_paths ? { selected_paths: m.selected_paths as string[] } : {}) }
        : null;
    case "stage_binding_result": {
      if (m.status !== "applied" && m.status !== "failed") return null;
      if (!stringOrNull(m.revision_id ?? null) || !optionalString(m.clientRequestId) || !optionalString(m.reason)) return null;
      const layers = m.applied_secondary_layers;
      if (layers !== undefined && !(Array.isArray(layers) && layers.every(layer => typeof layer === "string"))) return null;
      return {
        protocol: "vg01", type: "stage_binding_result", status: m.status, revision_id: (m.revision_id as string | null | undefined) ?? null,
        ...(m.clientRequestId ? { clientRequestId: m.clientRequestId } : {}),
        ...(m.reason ? { reason: m.reason } : {}),
        ...(layers ? { applied_secondary_layers: layers as string[] } : {}),
      };
    }
    default:
      return null; // 未知 type 忽略（前向相容）
  }
}

/** viewer 端解析父視窗送來的憑證；token 必填且非空，user_token 可選。 */
export function parseViewerLeaseToken(value: unknown): ViewerLeaseTokenMessage | null {
  if (!record(value) || value.type !== "viewer_lease_token") return null;
  if (typeof value.token !== "string" || value.token.length === 0) return null;
  if (value.user_token !== undefined && (typeof value.user_token !== "string" || value.user_token.length === 0)) return null;
  return { type: "viewer_lease_token", token: value.token, ...(value.user_token ? { user_token: value.user_token } : {}) };
}
