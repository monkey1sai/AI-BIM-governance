import type { components } from "./generated/kit-manager-api";

// C1 契約收斂（2026-07-21）：UsdcArtifact / KitInstanceState 改由 kit-manager-api openapi
// 生成型別 alias（generated/kit-manager-api.ts，再生成：cd web-viewer-sample &&
// npm run generate:api-types）。本 package 只用自己 src/generated/ 的檔，不跨 package import。
export type UsdcArtifact = components["schemas"]["UsdcArtifact"];

// Drift 註記：openapi 契約僅標 instance_id/status 為 required（pydantic 有 default 的欄位不入
// required），但後端序列化恆帶全部欄位——wire 上實際必存在，且既有消費端（StatusPanel 的
// control_status.startsWith / opened_runtime_uris.length）依賴必填語意。故以 Required<> 做最小
// local 收緊，不改前端行為。原手寫 last_command?: string 與 wire 不符（實為 string | null 恆帶），
// 收斂後修正為契約值。
export type KitInstanceState = Required<components["schemas"]["KitInstanceState"]>;

export interface HealthResponse {
  status: string;
  runtime_mode: string;
  host_local_runtime_allowed: boolean;
  kit_instance_id: string;
  kit_control_url: string;
}

export interface OpenResponse {
  instance: KitInstanceState;
  stage_composition_payload: Record<string, unknown>;
  message: string;
}

export interface CloseResponse {
  instance: KitInstanceState;
  message: string;
}
