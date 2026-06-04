/*
 * SPDX-FileCopyrightText: Copyright (c) 2024 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: LicenseRef-NvidiaProprietary
 *
 * NVIDIA CORPORATION, its affiliates and licensors retain all intellectual
 * property and proprietary rights in and to this material, related
 * documentation and any modifications thereto. Any use, reproduction,
 * disclosure or distribution of this material and related documentation
 * without an express license agreement from NVIDIA CORPORATION or
 * its affiliates is strictly prohibited.
 */

import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import OperatorConsole from "./console/OperatorConsole";
import { isOperatorConsolePath } from "./console/routing";
import "./index.css";
import "./styles/demo-theme.css";

// fast-ifc-link-demo-loop §6.1:解析 ?session=lwv_xxx | review_session_xxx,
// 寫進 window.__INITIAL_SESSION_FROM_QUERY__ 供 App / Window bootstrap 階段接手,
// 跳過 NVIDIA Forms onboarding,直接走 stream-config attach 路徑。
declare global {
    interface Window {
        __INITIAL_SESSION_FROM_QUERY__?: string | null;
    }
}
const initialQueryParams = new URLSearchParams(window.location.search);
const initialSession = initialQueryParams.get("session");
if (initialSession && /^(lwv_|review_session_)[A-Za-z0-9_]+$/.test(initialSession)) {
    window.__INITIAL_SESSION_FROM_QUERY__ = initialSession;
    console.info(`[fast-mvp] auto-attach session from query string:${initialSession}`);
} else {
    window.__INITIAL_SESSION_FROM_QUERY__ = null;
}

// /console[/...] 或 #/console[/...] 掛統一治理控制台 operator 三頁；其餘維持既有 viewer App 不變。
const useOperatorConsole = isOperatorConsolePath(window.location.pathname, window.location.hash);
ReactDOM.createRoot(document.getElementById("root")!).render(
    useOperatorConsole ? <OperatorConsole /> : <App />
);
