// web-viewer-sample/src/console/routing.ts
// operator console 路由判定（純函式，便於測試）。pathname 限 ROOT /console[/...] 或 hash #/console[/...]
// 掛 OperatorConsole；其餘維持既有 viewer <App/>（含 ?session= bootstrap）。
// pathname 只認根層 /console（避免 /foo/console 之類巢狀路徑誤判為 operator console）。
// W8：另支援短 hash #coordinator / #intake / #runtime（spec），但僅在 query 無 session= 時生效
//     —— viewer 的 ?session= 進件優先，避免覆寫既有 viewer attach 入口。
const SHORT_CONSOLE_HASH = /^#(coordinator|intake|runtime)$/;
export function isOperatorConsolePath(pathname: string, hash: string, search = ""): boolean {
  if (/^\/console(?:\/|$)/.test(pathname)) return true;
  if (/^#\/?console(\/|$)/.test(hash)) return true;
  if (SHORT_CONSOLE_HASH.test(hash)) {
    const hasSession = new URLSearchParams(search).has("session");
    if (!hasSession) return true;
  }
  return false;
}
