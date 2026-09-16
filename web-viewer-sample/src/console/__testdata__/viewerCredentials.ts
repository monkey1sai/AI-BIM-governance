// 測試用 Viewer Credentials 設定：取代已移除的 reviewEnv.userToken / reviewEnv.viewerLeaseToken 全域欄位。
// 於建構 App 前設定；有值時以 borrowed adapter 注入，等同嵌入 viewer 已收到父視窗送來的憑證。
// 都為空時不注入，App 依模式自建（頂層 primary 會透過 CoordinatorClient 真的 claim）。
import { reviewEnv } from "../../config/env";
import {
    createBorrowedViewerCredentials,
    type BorrowedViewerCredentials,
} from "../../clients/viewerCredentials";

export const testCredentials = { userToken: "", leaseToken: "" };

export function resetTestCredentials(): void {
    testCredentials.userToken = "";
    testCredentials.leaseToken = "";
}

export function withTestCredentials<P extends object>(props: P): P & { viewerCredentials?: BorrowedViewerCredentials } {
    if (!testCredentials.userToken && !testCredentials.leaseToken) return props;
    return {
        ...props,
        viewerCredentials: createBorrowedViewerCredentials({
            sourceClientId: reviewEnv.sourceClientId,
            initial: { ...testCredentials },
        }),
    };
}
