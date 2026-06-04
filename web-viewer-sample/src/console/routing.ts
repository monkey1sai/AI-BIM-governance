// web-viewer-sample/src/console/routing.ts
// operator console 路由判定（純函式，便於測試）。pathname 限 ROOT /console[/...] 或 hash #/console[/...]
// 掛 OperatorConsole；其餘維持既有 viewer <App/>（含 ?session= bootstrap）。
// pathname 只認根層 /console（避免 /foo/console 之類巢狀路徑誤判為 operator console）。
export function isOperatorConsolePath(pathname: string, hash: string): boolean {
  if (/^\/console(?:\/|$)/.test(pathname)) return true;
  if (/^#\/?console(\/|$)/.test(hash)) return true;
  return false;
}
