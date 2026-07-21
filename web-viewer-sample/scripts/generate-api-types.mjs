#!/usr/bin/env node
// C1 契約生成切片：FastAPI openapi.json → TypeScript 型別，消滅前端手抄重複。
//
// 流程：
//   1) 以 Python 匯出 governance-service 與 kit-manager-api 的 openapi.json（落地到 OS 暫存目錄，不進 repo）。
//   2) 以 `npx -y openapi-typescript@7` 生成 TS 型別，寫入各 package 自己的 src/generated/（生成物入版控，
//      build/typecheck 不依賴 Python）。
//
// 再生成：cd web-viewer-sample && npm run generate:api-types
//   - Python 直譯器解析順序：環境變數 API_TYPES_PYTHON → <repoRoot>/.venv（Windows: Scripts/python.exe）→ PATH 上的 python。
//   - governance-service import 時會開 DB（db.Store），故匯出時以 GOV_DB_PATH 指向暫存檔，避免在 repo 內產生 storage 檔案。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const isWindows = process.platform === "win32";

function resolvePython() {
  if (process.env.API_TYPES_PYTHON) return process.env.API_TYPES_PYTHON;
  const venvPython = isWindows
    ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
    : path.join(repoRoot, ".venv", "bin", "python");
  if (existsSync(venvPython)) return venvPython;
  return "python";
}

const python = resolvePython();
const workDir = mkdtempSync(path.join(tmpdir(), "api-typegen-"));

// 匯出 openapi.json：Python 直接把 JSON 寫進 argv[1]（不走 stdout，避免 import 期輸出污染）。
const EXPORT_SNIPPET = String.raw`
import json, sys
spec = app.openapi()
with open(sys.argv[1], "w", encoding="utf-8") as fh:
    json.dump(spec, fh, ensure_ascii=False)
`;

const services = [
  {
    name: "governance-service",
    cwd: path.join(repoRoot, "governance-service"),
    importLine: "from app import app",
    env: { GOV_DB_PATH: path.join(workDir, "governance-openapi-export.db") },
    specFile: path.join(workDir, "governance-service.openapi.json"),
  },
  {
    name: "kit-manager-api",
    cwd: path.join(repoRoot, "services", "kit-manager-api"),
    importLine: "from app.main import app",
    env: {},
    specFile: path.join(workDir, "kit-manager-api.openapi.json"),
  },
];

// 每個 package 只用自己 src/generated/ 的檔，不跨 package import。
// kit-manager-api 的型別因此生成兩份（web-viewer-sample 的 coordinatorClient 亦消費 KitInstanceState）。
const outputs = [
  {
    service: "governance-service",
    dest: path.join(repoRoot, "web-viewer-sample", "src", "generated", "governance-api.ts"),
  },
  {
    service: "kit-manager-api",
    dest: path.join(repoRoot, "web-viewer-sample", "src", "generated", "kit-manager-api.ts"),
  },
  {
    service: "kit-manager-api",
    dest: path.join(repoRoot, "apps", "kit-manager-web", "src", "generated", "kit-manager-api.ts"),
  },
];

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: ["ignore", "inherit", "inherit"], ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} 結束碼 ${result.status}`);
  }
}

function header(serviceName) {
  return [
    "// GENERATED FILE - DO NOT EDIT.",
    `// 由 ${serviceName}（FastAPI）的 openapi.json 生成。`,
    "// 再生成：cd web-viewer-sample && npm run generate:api-types",
    "//（腳本：web-viewer-sample/scripts/generate-api-types.mjs）",
    "",
  ].join("\n");
}

try {
  for (const service of services) {
    console.log(`[generate-api-types] 匯出 ${service.name} openapi.json ...`);
    run(python, ["-c", `${service.importLine}\n${EXPORT_SNIPPET}`, service.specFile], {
      cwd: service.cwd,
      env: { ...process.env, ...service.env },
    });
  }

  const generatedByService = new Map();
  for (const service of services) {
    console.log(`[generate-api-types] openapi-typescript 生成 ${service.name} 型別 ...`);
    const tsFile = `${service.specFile}.ts`;
    run("npx", ["-y", "openapi-typescript@7", service.specFile, "-o", tsFile], {
      cwd: repoRoot,
      // Windows 上 npx 是 .cmd shim，Node 20+ 需經 shell 執行。
      shell: isWindows,
    });
    generatedByService.set(service.name, readFileSync(tsFile, "utf-8"));
  }

  for (const output of outputs) {
    mkdirSync(path.dirname(output.dest), { recursive: true });
    writeFileSync(output.dest, header(output.service) + generatedByService.get(output.service), "utf-8");
    console.log(`[generate-api-types] 已寫入 ${path.relative(repoRoot, output.dest)}`);
  }
  console.log("[generate-api-types] 完成。");
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
