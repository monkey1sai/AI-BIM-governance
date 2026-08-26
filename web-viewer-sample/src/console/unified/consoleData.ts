// UnifiedConsole — 頁面資料來源 context 與訂閱 hook（unified-console-runtime-truth design §1.4）。
// 與 <ConsoleDataProvider> 分檔（比照 coordinatorStatusStore.ts）：.tsx 只留元件，避免 react-refresh/only-export-components。
import { createContext, useContext } from "react";
import { CoordinatorStatusStore, coordinatorStatusStore, useCoordinatorStatus } from "./coordinatorStatusStore";
import type { CoordinatorStatusSnapshot, EndpointKey } from "./coordinatorStatusStore";

export const ConsoleDataContext = createContext<CoordinatorStatusStore>(coordinatorStatusStore);

/** 頁面訂閱端點（keys 為模組層常數）並取得整份快照。 */
export function useConsoleData(keys: readonly EndpointKey[]): CoordinatorStatusSnapshot {
  return useCoordinatorStatus(useContext(ConsoleDataContext), keys);
}
