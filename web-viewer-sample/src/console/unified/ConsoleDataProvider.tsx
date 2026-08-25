// UnifiedConsole — ConsoleDataProvider（unified-console-runtime-truth design §1.4）：頁面資料來源的單一注入點。
// production 由 UnifiedShell 注入 live 單例 coordinatorStatusStore；vitest 以 coordinatorClient 層 spy 注入 mock；
// 不存在 fixture／preview provider（D1=P）。
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { CoordinatorStatusStore, coordinatorStatusStore, useCoordinatorStatus } from "./coordinatorStatusStore";
import type { CoordinatorStatusSnapshot, EndpointKey } from "./coordinatorStatusStore";

const ConsoleDataContext = createContext<CoordinatorStatusStore>(coordinatorStatusStore);

export function ConsoleDataProvider({ store, children }: { store: CoordinatorStatusStore; children: ReactNode }) {
  return <ConsoleDataContext.Provider value={store}>{children}</ConsoleDataContext.Provider>;
}

/** 頁面訂閱端點（keys 為模組層常數）並取得整份快照。 */
export function useConsoleData(keys: readonly EndpointKey[]): CoordinatorStatusSnapshot {
  return useCoordinatorStatus(useContext(ConsoleDataContext), keys);
}
