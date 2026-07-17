// 同步設計資產：repo 根 docs/plans/assets/*.png 與 docs/plans/uploads/*.png
// → web-viewer-sample/public/design-assets/（UnifiedConsole viewport 底圖 vp-*.png
// 與 A5–A10 概念稿 ai-bim-geo-viewer-A*.png 的產品落點）。
// dev / build / build:ui 前置執行；來源缺失時只接受 SHA-256 manifest 封存的 deployment staging。
import { createHash, randomUUID } from "node:crypto";
import {
    closeSync,
    copyFileSync,
    existsSync,
    fstatSync,
    lstatSync,
    mkdtempSync,
    openSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmdirSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const sources = [
    resolve(repoRoot, "docs", "plans", "assets"),
    resolve(repoRoot, "docs", "plans", "uploads"),
];
const destParent = resolve(here, "..", "public");
const dest = join(destParent, "design-assets");
const manifestName = ".deployment-manifest.json";
const manifestSchema = "design-assets/v1";
const lockName = ".design-assets-sync.lock";
const backupPrefix = ".design-assets-backup-";

function sha256(filePath) {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function fail(message) {
    throw new Error(`[sync-design-assets] ${message}`);
}

function lstatIfPresent(targetPath) {
    try {
        return lstatSync(targetPath);
    } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") return null;
        throw error;
    }
}

function assertNoSymlinkChain(targetPath) {
    const full = resolve(targetPath);
    const rel = relative(repoRoot, full);
    const parentPrefix = `..${process.platform === "win32" ? "\\" : "/"}`;
    if (rel === ".." || rel.startsWith(parentPrefix) || isAbsolute(rel)) {
        fail(`path escaped repository root: ${full}`);
    }

    const root = parse(full).root;
    let current = root;
    for (const segment of full.slice(root.length).split(/[\\/]/).filter(Boolean)) {
        current = join(current, segment);
        const item = lstatIfPresent(current);
        if (item === null) break;
        if (item.isSymbolicLink()) {
            fail(`path contains symbolic link or junction: ${current}`);
        }
        if (current !== full && !item.isDirectory()) {
            fail(`path ancestor is not a directory: ${current}`);
        }
    }
    return full;
}

function enterDesignAssetLock() {
    const parent = assertNoSymlinkChain(destParent);
    if (!lstatIfPresent(parent)?.isDirectory()) fail(`destination parent is missing: ${parent}`);
    const lockPath = join(parent, lockName);
    assertNoSymlinkChain(lockPath);

    let fd;
    try {
        fd = openSync(lockPath, "wx");
    } catch (error) {
        fail(`sync is already running or left a stale lock: ${lockPath}`);
    }
    const identity = fstatSync(fd);
    return {
        release() {
            closeSync(fd);
            const current = lstatIfPresent(lockPath);
            if (
                current === null ||
                current.isSymbolicLink() ||
                !current.isFile() ||
                current.dev !== identity.dev ||
                current.ino !== identity.ino
            ) {
                fail(`lock identity changed before release: ${lockPath}`);
            }
            unlinkSync(lockPath);
        },
    };
}

function withDesignAssetLock(action) {
    const lock = enterDesignAssetLock();
    let primaryError;
    try {
        return action();
    } catch (error) {
        primaryError = error;
        throw error;
    } finally {
        try {
            lock.release();
        } catch (error) {
            if (primaryError) {
                console.error(`[sync-design-assets] lock cleanup failed after primary error: ${error instanceof Error ? error.message : String(error)}`);
            } else {
                throw error;
            }
        }
    }
}

function assertNoBackupResidue() {
    const residue = readdirSync(destParent, { withFileTypes: true })
        .filter((entry) => entry.name.startsWith(backupPrefix));
    if (residue.length > 0) {
        fail(`backup residue requires manual inspection: ${residue.map((entry) => join(destParent, entry.name)).join(", ")}`);
    }
}

function replaceableEntries(directory) {
    const dir = assertNoSymlinkChain(directory);
    if (!existsSync(dir)) return [];
    if (!lstatSync(dir).isDirectory()) fail(`destination is not a directory: ${dir}`);

    return readdirSync(dir, { withFileTypes: true }).map((entry) => {
        const entryPath = join(dir, entry.name);
        if (entry.isSymbolicLink()) fail(`inventory contains symbolic link or junction: ${entryPath}`);
        if (!entry.isFile()) fail(`inventory contains unexpected directory or special entry: ${entryPath}`);
        if (entry.name !== manifestName && !entry.name.toLowerCase().endsWith(".png")) {
            fail(`inventory contains unexpected file: ${entryPath}`);
        }
        return { name: entry.name, path: entryPath };
    });
}

function readAndValidateManifest(directory) {
    const dir = assertNoSymlinkChain(directory);
    const inventory = replaceableEntries(dir);
    const manifestPath = join(dir, manifestName);
    if (!existsSync(manifestPath)) fail(`prestaged manifest is missing: ${manifestPath}`);

    let manifest;
    try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
        fail(`prestaged manifest is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (manifest?.schema_version !== manifestSchema || !Array.isArray(manifest.files) || manifest.files.length === 0) {
        fail("prestaged manifest schema/files are invalid");
    }

    const expectedNames = [];
    for (const entry of manifest.files) {
        if (
            typeof entry?.name !== "string" ||
            entry.name !== entry.name.split(/[\\/]/).at(-1) ||
            !entry.name.toLowerCase().endsWith(".png") ||
            typeof entry.sha256 !== "string" ||
            !/^[0-9a-f]{64}$/.test(entry.sha256)
        ) {
            fail("prestaged manifest contains an invalid file entry");
        }
        if (expectedNames.includes(entry.name)) fail(`prestaged manifest contains duplicate name: ${entry.name}`);
        expectedNames.push(entry.name);
        const assetPath = join(dir, entry.name);
        if (!existsSync(assetPath) || sha256(assetPath) !== entry.sha256) {
            fail(`prestaged asset hash mismatch: ${entry.name}`);
        }
    }

    const expectedInventory = [manifestName, ...expectedNames].sort();
    const actualInventory = inventory.map((entry) => entry.name).sort();
    if (JSON.stringify(expectedInventory) !== JSON.stringify(actualInventory)) {
        fail("prestaged directory is not a sealed manifest inventory");
    }
    return manifest;
}

function removeReplaceableDirectory(directory) {
    if (!existsSync(directory)) return;
    const entries = replaceableEntries(directory);
    for (const entry of entries) {
        assertNoSymlinkChain(directory);
        const current = lstatIfPresent(entry.path);
        if (current === null || current.isSymbolicLink() || !current.isFile()) {
            fail(`cleanup identity changed before unlink: ${entry.path}`);
        }
        unlinkSync(entry.path);
    }
    assertNoSymlinkChain(directory);
    rmdirSync(directory);
}

export function publishStagedDirectory(stagePath, options = {}) {
    const destinationParent = options.destinationParent ?? destParent;
    const destinationPath = options.destination ?? dest;
    const guardPath = options.guardPath ?? assertNoSymlinkChain;
    const pathExists = options.pathExists ?? existsSync;
    const inspectEntries = options.inspectEntries ?? replaceableEntries;
    const moveDirectory = options.moveDirectory ?? renameSync;
    const validatePublication = options.validatePublication ?? readAndValidateManifest;
    const removeDirectory = options.removeDirectory ?? removeReplaceableDirectory;
    const allocateBackupPath = options.allocateBackupPath ??
        (() => join(destinationParent, `${backupPrefix}${randomUUID().replaceAll("-", "")}`));

    const stage = guardPath(stagePath);
    const destination = guardPath(destinationPath);
    const backupPath = guardPath(allocateBackupPath());
    if (pathExists(backupPath)) fail(`backup path already exists: ${backupPath}`);

    let claimedBackup = false;
    let newPublished = false;
    try {
        if (pathExists(destination)) {
            inspectEntries(destination);
            moveDirectory(destination, backupPath);
            claimedBackup = true;
            inspectEntries(backupPath);
        }
        moveDirectory(stage, destination);
        newPublished = true;
        validatePublication(destination);
    } catch (error) {
        if (newPublished && pathExists(destination) && !pathExists(stage)) {
            try {
                moveDirectory(destination, stage);
                newPublished = false;
            } catch (rollbackError) {
                fail(`publication failed (${error instanceof Error ? error.message : String(error)}); additionally failed to move the rejected publication back to staging (${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)})`);
            }
        }
        if (claimedBackup && !pathExists(destination)) {
            try {
                moveDirectory(backupPath, destination);
                claimedBackup = false;
            } catch (rollbackError) {
                fail(`publication failed (${error instanceof Error ? error.message : String(error)}); additionally failed to restore the previous directory (${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)})`);
            }
        }
        throw error;
    }

    if (claimedBackup) {
        try {
            removeDirectory(backupPath);
        } catch (error) {
            fail(`new design assets are valid, but the claimed backup was retained for manual inspection at ${backupPath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

function inspectSourceDirectories() {
    const present = [];
    const missing = [];
    for (const source of sources) {
        const sourcePath = assertNoSymlinkChain(source);
        const item = lstatIfPresent(source);
        if (item === null) {
            missing.push(source);
            continue;
        }
        if (!item.isDirectory()) fail(`source exists but is not a directory: ${sourcePath}`);
        present.push(sourcePath);
    }
    if (missing.length > 0) {
        if (missing.length !== sources.length) fail(`source directory is partially missing: ${missing.join(", ")}`);
        return [];
    }
    return present;
}

function collectSourceFiles(sourceDirectories) {
    const files = [];
    const names = new Set();
    for (const sourcePath of sourceDirectories) {
        for (const entry of readdirSync(sourcePath, { withFileTypes: true })) {
            if (!entry.name.toLowerCase().endsWith(".png")) continue;
            const sourceFile = join(sourcePath, entry.name);
            if (entry.isSymbolicLink() || !entry.isFile()) fail(`source PNG is not a regular file: ${sourceFile}`);
            if (names.has(entry.name)) fail(`source directories contain duplicate PNG name: ${entry.name}`);
            names.add(entry.name);
            files.push({ name: entry.name, path: sourceFile });
        }
    }
    if (files.length === 0) fail("source directories contain no PNG files");
    return files;
}

function syncFromSources(sourceDirectories) {
    assertNoSymlinkChain(destParent);
    if (!existsSync(destParent) || !lstatSync(destParent).isDirectory()) {
        fail(`destination parent is missing: ${destParent}`);
    }
    replaceableEntries(dest);
    const sourceFiles = collectSourceFiles(sourceDirectories);
    const stagePath = mkdtempSync(join(destParent, ".design-assets-stage-"));
    let published = false;
    try {
        for (const source of sourceFiles) copyFileSync(source.path, join(stagePath, source.name));
        const files = sourceFiles
            .map(({ name }) => ({ name, sha256: sha256(join(stagePath, name)) }))
            .sort((left, right) => left.name.localeCompare(right.name));
        writeFileSync(
            join(stagePath, manifestName),
            `${JSON.stringify({ schema_version: manifestSchema, files }, null, 2)}\n`,
            "utf8",
        );
        readAndValidateManifest(stagePath);
        publishStagedDirectory(stagePath);
        published = true;
    } finally {
        if (!published && existsSync(stagePath)) {
            try {
                removeReplaceableDirectory(stagePath);
            } catch (error) {
                console.error(`[sync-design-assets] temporary staging cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    const manifest = readAndValidateManifest(dest);
    console.log(`[sync-design-assets] copied ${manifest.files.length} png -> ${dest}`);
}

function main() {
    try {
        assertNoSymlinkChain(repoRoot);
        withDesignAssetLock(() => {
            assertNoBackupResidue();
            const sourceDirectories = inspectSourceDirectories();
            if (sourceDirectories.length === 0) {
                const manifest = readAndValidateManifest(dest);
                console.log(`[sync-design-assets] verified ${manifest.files.length} prestaged png from ${dest}`);
            } else {
                syncFromSources(sourceDirectories);
            }
        });
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
