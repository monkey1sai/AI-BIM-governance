// web-viewer-sample/src/console/routing.ts
// operator console 路由判定（純函式，便於測試）。掛 EdgeConsole / UI shell；其餘維持既有 viewer <App/>（含 ?session= bootstrap）。
// 認得三種入口：
//   1. ROOT /console[/...]（dev）或 hash #/console[/...] —— 顯式 console 路徑，永遠 console（與 ?session= 無關）。
//   2. coordinator :8004 服務的 /ui pathname —— CH-E 正規 console 入口；viewer 改走 /ui/open 302 至
//      viewer origin（server-side redirect，不經此 SPA path），故 /ui 預設掛 console。
//   3. prototype/product console 短 hash，允許 #/ 前綴（例如 #/a1、#/viewer、#/minio）。
// pathname 只認根層 /console（避免 /foo/console 巢狀誤判）。/ui 與短 hash 讓位給 viewer 的 ?session= 進件
// （viewer attach 優先），避免覆寫既有 viewer 入口。
const PRODUCT_CONSOLE_ROUTES = [
  "home", "overview",
  "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10",
  "viewer", "gpu",
  "conv", "pipeline", "sessions", "instances", "minio",
  "issues", "reports", "runtime", "admin", "spec",
  "coordinator", "intake", "review", "semantic",
  "version-diff", "federation", "apps",
  "kit", "demo-control",
  // IA v2（UnifiedConsole）：原 #a1/#a4 讓位給 workspace，legacy 單頁深連結改掛以下兩鍵。
  "a1-workbench", "semantic-search",
];
// F8-route（2026-07-10）：EdgeConsole 另有 `app/<slug>` 動態 case（A5–A10 願景詳頁；A4 已 live #a4，
// data.ts A1A10[].route="app/..."）——固定字串清單涵蓋不到，補前綴匹配（slug 限 [a-z0-9-]+，
// 空 slug 與相似字首不放行）。影響面：僅裸 viewer 來源（dev :5173 根路徑）的深連結判定；
// 正式入口 :8004/ui 由 pathname 分支先命中，不經此 regex。
const SHORT_CONSOLE_HASH = new RegExp(`^#/?(${PRODUCT_CONSOLE_ROUTES.join("|")}|app/[a-z0-9-]+)(?:\\?.*)?$`);
export function isOperatorConsolePath(pathname: string, hash: string, search = ""): boolean {
  // 顯式 console 路徑：永遠 console。
  if (/^\/console(?:\/|$)/.test(pathname)) return true;
  if (/^#\/?console(\/|$)/.test(hash)) return true;
  // /ui pathname 與短 hash：讓位給 viewer ?session= 進件（理論上不同時出現，但保險）。
  const hasSession = new URLSearchParams(search).has("session");
  if (hasSession) return false;
  if (/^\/ui(?:\/|$)/.test(pathname)) return true;
  if (SHORT_CONSOLE_HASH.test(hash)) return true;
  return false;
}
