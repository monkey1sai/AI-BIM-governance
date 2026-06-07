// web-viewer-sample/src/console/routing.ts
// operator console 路由判定（純函式，便於測試）。掛 OperatorConsole；其餘維持既有 viewer <App/>（含 ?session= bootstrap）。
// 認得三種入口：
//   1. ROOT /console[/...]（dev）或 hash #/console[/...] —— 顯式 console 路徑，永遠 console（與 ?session= 無關）。
//   2. coordinator :8004 服務的 /ui pathname —— CH-E 正規 console 入口；viewer 改走 /ui/open 302 至
//      viewer origin（server-side redirect，不經此 SPA path），故 /ui 預設掛 console。
//   3. 短 hash #(coordinator|intake|runtime|review|kit|demo-control)，允許 #/ 前綴（spec 用 #/kit、#/demo-control）。
// pathname 只認根層 /console（避免 /foo/console 巢狀誤判）。/ui 與短 hash 讓位給 viewer 的 ?session= 進件
// （viewer attach 優先），避免覆寫既有 viewer 入口。
const SHORT_CONSOLE_HASH = /^#\/?(coordinator|intake|runtime|review|kit|demo-control)$/;
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
