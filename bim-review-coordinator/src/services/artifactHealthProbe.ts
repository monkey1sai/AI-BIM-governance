import fs from "node:fs";
import path from "node:path";
import type { ArtifactHealthSnapshot } from "../types.js";

export interface ArtifactHealthProbeInput {
  host_local_path: string | null;
  model_artifact_url: string | null;
  mapping_url: string | null;
  edge_runtime_data_root: string;
  configured_conversion_api_origin: string;
  checked_at?: string;
}

type ProbeBoolean = boolean | null;

export interface SourceIfcPathCheck {
  value: ProbeBoolean;
  failure: string | null;
}

type ProbeResult = SourceIfcPathCheck;

type PathStyle = "win32" | "posix";

const URL_PROBE_TIMEOUT_MS = 1500;

function detectPathStyle(value: string): PathStyle {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("//") || value.includes("\\")
    ? "win32"
    : "posix";
}

function pathApi(style: PathStyle): path.PlatformPath {
  return style === "win32" ? path.win32 : path.posix;
}

function stripExtendedWinPrefix(value: string): string {
  if (value.startsWith("\\\\?\\")) return value.slice(4);
  return value;
}

function isUncPath(value: string): boolean {
  const normalized = stripExtendedWinPrefix(value);
  return normalized.startsWith("\\\\") || normalized.startsWith("//");
}

function sameWin32Drive(a: string, b: string): boolean {
  return path.win32.parse(stripExtendedWinPrefix(a)).root.slice(0, 2).toUpperCase()
    === path.win32.parse(stripExtendedWinPrefix(b)).root.slice(0, 2).toUpperCase();
}

function isWithin(child: string, parent: string, api: path.PlatformPath): boolean {
  const relative = api.relative(parent, child);
  return relative === "" || (relative.length > 0 && !relative.startsWith("..") && !api.isAbsolute(relative));
}

function realpathIfExists(value: string): string | null {
  if (!fs.existsSync(value)) return null;
  return fs.realpathSync.native(value);
}

export function checkSourceIfcPath(hostLocalPath: string | null, edgeRuntimeDataRoot: string): SourceIfcPathCheck {
  if (!hostLocalPath) {
    return { value: null, failure: null };
  }
  if (!edgeRuntimeDataRoot) {
    return { value: false, failure: "edge_runtime_data_root_missing" };
  }

  const hostStyle = detectPathStyle(hostLocalPath);
  const rootStyle = detectPathStyle(edgeRuntimeDataRoot);
  if (hostStyle !== rootStyle) {
    return { value: false, failure: "source_ifc_path_style_mismatch" };
  }
  if (hostStyle === "win32" && isUncPath(hostLocalPath)) {
    return { value: false, failure: "source_ifc_unc_path_rejected" };
  }

  const api = pathApi(hostStyle);
  if (!api.isAbsolute(hostLocalPath) || !api.isAbsolute(edgeRuntimeDataRoot)) {
    return { value: false, failure: "source_ifc_path_not_absolute" };
  }

  const storageRoot = api.resolve(edgeRuntimeDataRoot, "storage");
  const resolvedHostPath = api.resolve(hostLocalPath);
  if (hostStyle === "win32" && !sameWin32Drive(resolvedHostPath, storageRoot)) {
    return { value: false, failure: "source_ifc_alternate_drive_rejected" };
  }
  if (!isWithin(resolvedHostPath, storageRoot, api)) {
    return { value: false, failure: "source_ifc_outside_edge_storage" };
  }

  const storageReal = realpathIfExists(storageRoot);
  if (!storageReal) {
    return { value: false, failure: "edge_storage_root_missing" };
  }
  const edgeRootReal = realpathIfExists(edgeRuntimeDataRoot);
  if (!edgeRootReal) {
    return { value: false, failure: "edge_runtime_data_root_missing" };
  }
  const storageRealStyle = detectPathStyle(storageReal);
  const edgeRootRealStyle = detectPathStyle(edgeRootReal);
  if (
    storageRealStyle !== edgeRootRealStyle
    || !isWithin(stripExtendedWinPrefix(storageReal), stripExtendedWinPrefix(edgeRootReal), pathApi(storageRealStyle))
  ) {
    return { value: false, failure: "edge_storage_root_escape" };
  }
  if (!fs.existsSync(resolvedHostPath)) {
    return { value: false, failure: "source_ifc_missing" };
  }

  const stat = fs.statSync(resolvedHostPath);
  if (!stat.isFile()) {
    return { value: false, failure: "source_ifc_not_file" };
  }

  const hostReal = fs.realpathSync.native(resolvedHostPath);
  const realStyle = detectPathStyle(hostReal);
  const realApi = pathApi(realStyle);
  const normalizedHostReal = stripExtendedWinPrefix(hostReal);
  const normalizedStorageReal = stripExtendedWinPrefix(storageReal);
  if (realStyle !== detectPathStyle(storageReal) || !isWithin(normalizedHostReal, normalizedStorageReal, realApi)) {
    return { value: false, failure: "source_ifc_symlink_escape" };
  }

  return { value: true, failure: null };
}

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return null;
  }
}

function isAllowedProbeUrl(url: URL, configuredConversionApiOrigin: string): boolean {
  if (url.username || url.password) return false;
  const configuredOrigin = normalizedOrigin(configuredConversionApiOrigin);
  if (configuredOrigin && url.origin === configuredOrigin) return true;
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

function statusToReachability(status: number): ProbeResult {
  if ((status >= 200 && status < 300) || status === 206) {
    return { value: true, failure: null };
  }
  return { value: false, failure: `http_${status}` };
}

async function requestStatus(url: URL, method: "HEAD" | "GET"): Promise<number> {
  const response = await fetch(url, {
    method,
    headers: method === "GET" ? { Range: "bytes=0-0" } : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(URL_PROBE_TIMEOUT_MS),
  });
  return response.status;
}

async function checkArtifactUrl(urlValue: string | null, configuredConversionApiOrigin: string): Promise<ProbeResult> {
  if (!urlValue) {
    return { value: null, failure: null };
  }

  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return { value: null, failure: "url_invalid" };
  }

  if (!isAllowedProbeUrl(url, configuredConversionApiOrigin)) {
    return { value: null, failure: "url_not_allowed" };
  }

  try {
    const headStatus = await requestStatus(url, "HEAD");
    if (headStatus === 405) {
      return statusToReachability(await requestStatus(url, "GET"));
    }
    return statusToReachability(headStatus);
  } catch {
    return { value: false, failure: "network_error" };
  }
}

function firstStaleReason(
  source: ProbeResult,
  model: ProbeResult,
  mapping: ProbeResult,
): string | null {
  if (source.value === false) return source.failure ?? "source_ifc_missing";
  if (model.value === false) return model.failure ?? "model_usdc_unreachable";
  if (mapping.value === false) return mapping.failure ?? "mapping_unreachable";
  return null;
}

function failureDetails(
  source: ProbeResult,
  model: ProbeResult,
  mapping: ProbeResult,
): ArtifactHealthSnapshot["failure_details"] {
  if (!source.failure && !model.failure && !mapping.failure) return null;
  return {
    source_ifc: source.failure,
    model_usdc: model.failure,
    mapping: mapping.failure,
    metadata: null,
  };
}

export async function probeArtifactHealth(input: ArtifactHealthProbeInput): Promise<ArtifactHealthSnapshot> {
  const source = checkSourceIfcPath(input.host_local_path, input.edge_runtime_data_root);
  const [model, mapping] = await Promise.all([
    checkArtifactUrl(input.model_artifact_url, input.configured_conversion_api_origin),
    checkArtifactUrl(input.mapping_url, input.configured_conversion_api_origin),
  ]);

  return {
    source_ifc_exists: source.value,
    model_usdc_reachable: model.value,
    mapping_reachable: mapping.value,
    metadata_reachable: null,
    all_required_ready: source.value === true && model.value === true && mapping.value === true,
    checked_at: input.checked_at ?? new Date().toISOString(),
    stale_reason: firstStaleReason(source, model, mapping),
    failure_details: failureDetails(source, model, mapping),
    source: "edge_health_probe",
  };
}
