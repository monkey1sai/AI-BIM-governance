// 遮蔽 presigned URL 的簽章 query（X-Amz-*）。只留 origin+pathname，簽章/憑證/過期不外洩。
// 誠實鐵律：對外 response 不得含 presigned 簽章。非 URL 或無簽章參數者原樣返回。
export function maskPresignedRef(ref: string): string {
  if (!ref) return ref;
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    return ref; // 非 URL（如 devstorage:filename）原樣
  }
  let hasSignature = false;
  for (const k of url.searchParams.keys()) {
    if (k.toLowerCase().startsWith("x-amz-")) {
      hasSignature = true;
      break;
    }
  }
  if (!hasSignature) return ref;
  return `${url.origin}${url.pathname}`;
}

/**
 * Stable object identity for retry comparison. HTTP(S) presigned query and
 * fragment values are renewable capabilities, while origin + pathname name
 * the underlying object. Non-HTTP refs keep exact-string semantics.
 */
export function stableHttpRefIdentity(ref: string): string {
  if (!ref) return ref;
  try {
    const url = new URL(ref);
    if (url.protocol !== "http:" && url.protocol !== "https:") return ref;
    return `${url.origin}${url.pathname}`;
  } catch {
    return ref;
  }
}
