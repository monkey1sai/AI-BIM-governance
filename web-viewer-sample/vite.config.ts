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
import { defineConfig } from "vite";
import { viteExternalsPlugin } from 'vite-plugin-externals';
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        viteExternalsPlugin({
            GFN: 'GFN'
        }),
    ],
    server: {
        fs: {
            // design token 權威在 repo 根 docs/plans/（vite root 之外）；dev server 需顯式放行。
            allow: [".", "../docs/plans"],
        },
    },
});
