import fs from "node:fs";
import path from "node:path";

/**
 * fast-ifc-link-demo-loop §2.1:把外部 IFC 同步下載到 shared volume,作為 dispatch
 * streaming-server 前的臨時通道。coordinator 不視為 IFC bytes 資料權威(權威在
 * 外部公司雲端 control-plane,以 external_model_version_id 參照),streaming-server
 * 為 conversion authority;本檔只負責「網路位址 → local file system path」的搬運。
 *
 * 對應 AGENTS.md §3.4 carve-out 與 bim-review-coordinator/CLAUDE.md MUST NOT 內
 * fast-ifc-link-demo-loop 例外段。
 */

export interface IfcDownloadOptions {
  /** Container view storage root,coordinator 寫入用(預設 `/workspace/storage`)。 */
  storageRoot: string;
  /**
   * Host view storage root,寫進回傳 host_local_path 供 streaming-server 讀取。
   * coordinator 不檢查此 path 在自己 container 內存在;只負責記錄 host 視角絕對路徑。
   */
  storageHostRoot?: string | null;
  /** 下載 timeout,毫秒;預設 600 秒對齊 IFC_DOWNLOAD_TIMEOUT_SECONDS。 */
  timeoutMs?: number;
  /** 注入 fetch(測試用)。預設用 globalThis.fetch。 */
  fetchImpl?: typeof fetch;
  /**
   * fast-ifc-link-demo-loop §2:fetch 失敗時是否仍回傳 ok placeholder(不真實下載)。
   * - true(default):非 production 場景。HTTP fetch 失敗 / non-2xx / 非 http scheme 視為
   *   placeholder ok,後續 dispatch streaming 仍走 source_ifc_ref URL fallback。
   * - false(strict):production / smoke。必須真實下載成功才回 ok;失敗回 502。
   */
  fallbackOnFetchError?: boolean;
}

export interface IfcDownloadSuccess {
  ok: true;
  /** Container view path:`${storageRoot}/ifc-cache/<jobId>/source.ifc`。 */
  local_path: string;
  /** Host view path:`${storageHostRoot}/ifc-cache/<jobId>/source.ifc`。 */
  host_local_path: string;
  /** Disk 寫入 byte 數(來自 ContentLength 或實際寫入計數)。 */
  bytes_written: number;
}

export interface IfcDownloadFailure {
  ok: false;
  /** 原因 token:`timeout` / `fetch_failed` / `http_status` / `write_failed`。 */
  reason: string;
  /** 人可讀錯誤訊息。 */
  message: string;
  /** HTTP status code(若 reason="http_status")。 */
  http_status?: number;
}

export type IfcDownloadResult = IfcDownloadSuccess | IfcDownloadFailure;

const DEFAULT_TIMEOUT_MS = 600_000;

function joinPosixPath(...parts: string[]): string {
  return parts
    .map((part, index) => (index === 0 ? part.replace(/[\\/]+$/, "") : part.replace(/^[\\/]+|[\\/]+$/g, "")))
    .filter((part) => part.length > 0)
    .join("/");
}

function joinHostPath(root: string, ...parts: string[]): string {
  // 保留 host root 內含的 separator(Windows host root 可能是 C:\foo,POSIX 可能是 /foo)。
  const sep = /[\\]/.test(root) ? "\\" : "/";
  const tail = parts.map((part) => part.replace(/[\\/]+/g, sep)).join(sep);
  return root.replace(/[\\/]+$/, "") + sep + tail;
}

/**
 * 同步下載 IFC 至 shared volume:
 *   ${storageRoot}/ifc-cache/<jobId>/source.ifc
 *
 * sourceRef 支援 HTTP / HTTPS URL。其他 scheme(`edge-local://` 等 test fixture)
 * 由 caller 在進入本函式前自行解析為實際下載 URL,或改用 file-system fallback。
 *
 * 失敗時 partial file 會被清乾淨(若已寫入);job state 由 caller 透過 store
 * markDownloadFailed 記錄。
 */
export async function downloadIfcToSharedVolume(
  sourceRef: string,
  jobId: string,
  options: IfcDownloadOptions,
): Promise<IfcDownloadResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const storageRoot = options.storageRoot.replace(/[\\/]+$/, "");
  const storageHostRoot = (options.storageHostRoot ?? storageRoot).replace(/[\\/]+$/, "");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const fallbackOnFetchError = options.fallbackOnFetchError ?? true;

  const placeholderSuccess = (): IfcDownloadSuccess => ({
    ok: true,
    local_path: joinPosixPath(storageRoot, "ifc-cache", jobId, "source.ifc"),
    host_local_path: joinHostPath(storageHostRoot, "ifc-cache", jobId, "source.ifc"),
    bytes_written: 0,
  });

  const localPath = joinPosixPath(storageRoot, "ifc-cache", jobId, "source.ifc");
  const hostLocalPath = joinHostPath(storageHostRoot, "ifc-cache", jobId, "source.ifc");
  const targetDir = path.dirname(localPath);

  let url: URL;
  try {
    url = new URL(sourceRef);
  } catch (error) {
    return {
      ok: false,
      reason: "invalid_source_ref",
      message: `source ref is not a valid URL: ${sourceRef}`,
    };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    // fast-ifc-link-demo-loop §2.1 fallback:test fixture / 非 production scheme
    // (`edge-local://`、`file://` 等)不實際下載,回傳 placeholder path 並讓
    // intake 流程繼續。
    return placeholderSuccess();
  }

  try {
    await fs.promises.mkdir(targetDir, { recursive: true });
  } catch (error) {
    return {
      ok: false,
      reason: "write_failed",
      message: `cannot create ${targetDir}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(new Error("ifc_download_timeout")), timeoutMs);
  let bytesWritten = 0;
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      if (fallbackOnFetchError) {
        // test / non-strict:non-2xx 仍回 placeholder,讓 dispatch 走 url fallback。
        return placeholderSuccess();
      }
      return {
        ok: false,
        reason: "http_status",
        message: `source returned ${response.status} ${response.statusText}`,
        http_status: response.status,
      };
    }
    const arrayBuffer = await response.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    bytesWritten = bytes.length;
    await fs.promises.writeFile(localPath, bytes);
    return {
      ok: true,
      local_path: localPath,
      host_local_path: hostLocalPath,
      bytes_written: bytesWritten,
    };
  } catch (error) {
    // 清掉 partial(若有)。
    await fs.promises.rm(localPath, { force: true }).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    if (controller.signal.aborted) {
      // timeout 即使 fallback mode 也回 fail(避免靜默掛起 → unbounded retry)。
      return { ok: false, reason: "timeout", message: `ifc download timeout after ${timeoutMs}ms` };
    }
    if (fallbackOnFetchError) {
      // test / non-strict:network error / connection refused 視為 placeholder ok。
      // production strict 才會回 fetch_failed 502。
      return placeholderSuccess();
    }
    return { ok: false, reason: "fetch_failed", message };
  } finally {
    clearTimeout(timeoutHandle);
  }
}
