import assert from "node:assert/strict";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { publishStagedDirectory } from "./sync-design-assets.mjs";

const backupPrefix = ".design-assets-backup-";
const sandbox = mkdtempSync(join(tmpdir(), "design-assets-publication-"));

function seedDirectory(path, marker) {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "marker.txt"), `${marker}\n`, "utf8");
}

function marker(path) {
    return readFileSync(join(path, "marker.txt"), "utf8").trim();
}

function createCase(name) {
    const destinationParent = join(sandbox, name);
    const destination = join(destinationParent, "design-assets");
    const stage = join(destinationParent, ".design-assets-stage-test");
    const backup = join(destinationParent, `${backupPrefix}${name}`);
    seedDirectory(destination, "old");
    seedDirectory(stage, "new");
    return { destinationParent, destination, stage, backup };
}

function publicationOptions(testCase, overrides = {}) {
    return {
        destinationParent: testCase.destinationParent,
        destination: testCase.destination,
        guardPath: (path) => resolve(path),
        pathExists: existsSync,
        inspectEntries: () => [],
        moveDirectory: renameSync,
        validatePublication: () => {},
        removeDirectory: (path) => rmSync(path, { recursive: true }),
        allocateBackupPath: () => testCase.backup,
        ...overrides,
    };
}

try {
    {
        const testCase = createCase("stage-rename-failure");
        let moveCount = 0;
        assert.throws(
            () => publishStagedDirectory(testCase.stage, publicationOptions(testCase, {
                moveDirectory(source, target) {
                    moveCount += 1;
                    if (moveCount === 2) throw new Error("injected stage rename failure");
                    renameSync(source, target);
                },
            })),
            /injected stage rename failure/,
        );
        assert.equal(marker(testCase.destination), "old");
        assert.equal(marker(testCase.stage), "new");
        assert.equal(existsSync(testCase.backup), false);
    }

    {
        const testCase = createCase("post-publish-validation");
        assert.throws(
            () => publishStagedDirectory(testCase.stage, publicationOptions(testCase, {
                validatePublication() {
                    throw new Error("injected post-publish validation failure");
                },
            })),
            /injected post-publish validation failure/,
        );
        assert.equal(marker(testCase.destination), "old");
        assert.equal(marker(testCase.stage), "new");
        assert.equal(existsSync(testCase.backup), false);
    }

    {
        const testCase = createCase("rejected-move-back-failure");
        let moveCount = 0;
        assert.throws(
            () => publishStagedDirectory(testCase.stage, publicationOptions(testCase, {
                moveDirectory(source, target) {
                    moveCount += 1;
                    if (moveCount === 3) throw new Error("injected rejected-publication move-back failure");
                    renameSync(source, target);
                },
                validatePublication() {
                    throw new Error("injected post-publish validation failure");
                },
            })),
            /additionally failed to move the rejected publication back to staging/,
        );
        assert.equal(marker(testCase.destination), "new");
        assert.equal(existsSync(testCase.stage), false);
        assert.equal(marker(testCase.backup), "old");
    }

    {
        const testCase = createCase("backup-restore-failure");
        let moveCount = 0;
        assert.throws(
            () => publishStagedDirectory(testCase.stage, publicationOptions(testCase, {
                moveDirectory(source, target) {
                    moveCount += 1;
                    if (moveCount === 4) throw new Error("injected backup restore failure");
                    renameSync(source, target);
                },
                validatePublication() {
                    throw new Error("injected post-publish validation failure");
                },
            })),
            /additionally failed to restore the previous directory/,
        );
        assert.equal(existsSync(testCase.destination), false);
        assert.equal(marker(testCase.stage), "new");
        assert.equal(marker(testCase.backup), "old");
    }

    {
        const testCase = createCase("backup-cleanup-failure");
        assert.throws(
            () => publishStagedDirectory(testCase.stage, publicationOptions(testCase, {
                removeDirectory() {
                    throw new Error("injected backup cleanup failure");
                },
            })),
            /backup was retained for manual inspection/,
        );
        assert.equal(marker(testCase.destination), "new");
        assert.equal(existsSync(testCase.stage), false);
        assert.equal(marker(testCase.backup), "old");
    }

    console.log("[test-sync-design-assets-publication] passed");
} finally {
    rmSync(sandbox, { recursive: true, force: true });
}
