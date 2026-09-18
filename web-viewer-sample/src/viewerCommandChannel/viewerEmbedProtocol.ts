// Viewer Embed Protocol（vg01）中由 Viewer Command Channel 擁有的指令訊息。
// 其餘 vg01 訊息（highlight、stage_tree、viewer_lease_token…）仍由 Window／EmbeddedViewer 各自處理，
// 待 vg01-postmessage-v1.schema.json 退役時併入此處（見 docs/architecture/viewer-command-channel-adr.md）。
import type { CameraState, CameraViewInput, CommandReason } from "./camera";
import type { MeasurementAction, MeasurementState } from "./measurement";
import type { SectionInput, SectionReply } from "./sectionPlane";

export const VIEWER_EMBED_PROTOCOL = "vg01" as const;

/** console → viewer 的指令。viewer 端收到時一律視為未驗證輸入，逐欄重新解析。 */
export type ViewerCommandRequest =
  | { type: "camera_view"; camera: CameraViewInput; clientRequestId: string }
  | { type: "camera_state"; clientRequestId: string }
  | { type: "fly_navigation"; speed: number; clientRequestId: string }
  | { type: "section_plane"; section: SectionInput; clientRequestId: string }
  | { type: "measurement_control"; action: MeasurementAction };

export type ViewerCommandType = ViewerCommandRequest["type"];

type ReplyStatus = "applied" | "unconfirmed" | "error";
type Correlation = { clientRequestId?: string; requestId?: string; reason?: CommandReason };

/** viewer → console 的回覆與狀態推送。 */
export type ViewerCommandReply =
  | ({ type: "camera_view_result" | "camera_state_result"; status: ReplyStatus; camera?: CameraState } & Correlation)
  | ({ type: "fly_navigation_result"; status: ReplyStatus; speed?: number } & Correlation)
  | ({ type: "section_result" } & SectionReply)
  | ({ type: "measurement_state" } & MeasurementState);
