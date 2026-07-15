// 同步設計資產：repo 根 docs/plans/assets/*.png 與 docs/plans/uploads/*.png
// → web-viewer-sample/public/design-assets/（UnifiedConsole viewport 底圖 vp-*.png
// 與 A5–A10 概念稿 ai-bim-geo-viewer-A*.png 的產品落點）。
// dev / build / build:ui 前置執行；冪等（重跑覆蓋同名檔）；來源目錄缺失時 fail-fast。
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const sources = [
    resolve(repoRoot, "docs", "plans", "assets"),
    resolve(repoRoot, "docs", "plans", "uploads"),
];
const dest = resolve(here, "..", "public", "design-assets");

const missing = sources.filter((dir) => !existsSync(dir));
if (missing.length > 0) {
    console.error("[sync-design-assets] missing source directory(ies):");
    for (const dir of missing) console.error(`  - ${dir}`);
    console.error("[sync-design-assets] expected docs/plans/assets/ and docs/plans/uploads/ at repo root; aborting.");
    process.exit(1);
}

mkdirSync(dest, { recursive: true });

let copied = 0;
for (const src of sources) {
    for (const name of readdirSync(src)) {
        if (!name.toLowerCase().endsWith(".png")) continue;
        copyFileSync(join(src, name), join(dest, name));
        copied += 1;
    }
}
console.log(`[sync-design-assets] copied ${copied} png -> ${dest}`);
