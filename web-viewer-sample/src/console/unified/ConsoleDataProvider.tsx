// UnifiedConsole — ConsoleDataProvider（unified-console-runtime-truth design §1.4）：頁面資料來源的單一注入點。
// production 由 UnifiedShell 注入 live 單例 coordinatorStatusStore；vitest 以 coordinatorClient 層 spy 注入 mock；
// 不存在 fixture／preview provider（D1=P）。context 與 useConsoleData hook 見 ./consoleData。
import type { ReactNode } from "react";
import { ConsoleDataContext } from "./consoleData";
import type { CoordinatorStatusStore } from "./coordinatorStatusStore";

export function ConsoleDataProvider({ store, children }: { store: CoordinatorStatusStore; children: ReactNode }) {
  return <ConsoleDataContext.Provider value={store}>{children}</ConsoleDataContext.Provider>;
}
