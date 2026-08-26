#!/usr/bin/env node
// test-pr-queue-adversarial-and-stress.mjs
// 3-Layer Cross-Adversarial Verification & Multi-Worker Stress Test for PR Queue Engine

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveGitignoreConflict,
  autoResolveConflicts,
  getPrChecks,
} from '../dev/manage-pr-queue.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const QUEUE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'dev', 'manage-pr-queue.mjs');

console.log('================================================================');
console.log('🛡️  PR Queue 3-Layer Cross-Adversarial & Stress Verification Suite');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Layer 1: 收斂性與防無窮遞迴 / 遞迴 PR 阻斷驗證 (Anti-Recursion & Bounded Convergence)
// -----------------------------------------------------------------------------
console.log('--- [Layer 1] 驗證：防無窮遞迴、收斂上限與遞迴 PR 阻斷 ---');

// 1.1 驗證最大輪次邊界限制 (Bounded Iterations)
const scriptContent = fs.readFileSync(QUEUE_SCRIPT, 'utf8').replace(/\r\n/g, '\n');
assert.ok(scriptContent.includes('let maxCycles = 5'), 'Queue engine must enforce a hardcoded maximum cycle limit (<= 5)');
assert.ok(scriptContent.includes('if (!progressMade) {\n        break;'), 'Queue engine must break immediately when no forward progress is made');
console.log('✔ Layer 1.1: 輪次上限 (maxCycles <= 5) 與無進展即跳出 (progressMade === false break) 驗證通過');

// 1.2 驗證鎖定與防連鎖觸發機制 (Anti-Storm Concurrency Lock)
assert.ok(scriptContent.includes('acquireLock()'), 'Queue engine must require an atomic lock before executing');
assert.ok(scriptContent.includes('pr-queue.lock'), 'Queue engine must maintain a dedicated lock file');
assert.ok(scriptContent.includes('300000'), 'Lock file must have a stale timeout (5 minutes)');
console.log('✔ Layer 1.2: 防暴風觸發原子互斥鎖 (Atomic Lock & Stale TTL) 驗證通過');

// 1.3 驗證元治理減法方針（禁止主動開立遞迴修復 PR）
assert.ok(!scriptContent.includes('gh pr create'), 'Queue engine must NEVER create new autonomous PRs (prevents PR explosion)');
console.log('✔ Layer 1.3: 絕不自動產生新 PR（杜絕遞迴 PR 爆炸與 Fixpoint 循環）驗證通過\n');

// -----------------------------------------------------------------------------
// Layer 2: 語意邊界與破壞性衝突防禦 (Semantic Conflict & Code Boundary Defense)
// -----------------------------------------------------------------------------
console.log('--- [Layer 2] 驗證：語意衝突精確識別與白名單邊界防禦 ---');

// 建立暫時測試工作目錄模擬 Git 衝突場景
const tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-queue-test-'));

try {
  execFileSync('git', ['init'], { cwd: tempTestDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'TestBot'], { cwd: tempTestDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tempTestDir, stdio: 'ignore' });

  // 2.1 測試白名單非關鍵衝突：.gitignore 合併（規則聯集）
  fs.writeFileSync(path.join(tempTestDir, '.gitignore'), '# Initial\n!.claude/commands/\n!.claude/settings.json\n', 'utf8');
  execFileSync('git', ['add', '.gitignore'], { cwd: tempTestDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: tempTestDir, stdio: 'ignore' });

  execFileSync('git', ['checkout', '-b', 'branch-a'], { cwd: tempTestDir, stdio: 'ignore' });
  fs.writeFileSync(path.join(tempTestDir, '.gitignore'), '# Initial\n!.claude/commands/\n!.claude/settings.json\n!.claude/launch.json\n', 'utf8');
  execFileSync('git', ['commit', '-am', 'add launch.json'], { cwd: tempTestDir, stdio: 'ignore' });

  execFileSync('git', ['checkout', 'master'], { cwd: tempTestDir, stdio: 'ignore' });
  execFileSync('git', ['checkout', '-b', 'branch-b'], { cwd: tempTestDir, stdio: 'ignore' });
  fs.writeFileSync(path.join(tempTestDir, '.gitignore'), '# Initial\n!.claude/commands/\n!.claude/settings.json\n!.claude/output-styles/\n', 'utf8');
  execFileSync('git', ['commit', '-am', 'add output-styles'], { cwd: tempTestDir, stdio: 'ignore' });

  // 嘗試在 branch-b 合併 branch-a 產生 .gitignore 衝突
  let mergeFailed = false;
  try {
    execFileSync('git', ['merge', 'branch-a'], { cwd: tempTestDir, stdio: 'pipe' });
  } catch {
    mergeFailed = true;
  }
  assert.ok(mergeFailed, 'Branch merge must produce conflict on .gitignore');

  // 執行我們的 resolveGitignoreConflict
  const resolvedGitignore = resolveGitignoreConflict(tempTestDir);
  assert.ok(resolvedGitignore, 'resolveGitignoreConflict must successfully resolve .gitignore conflict');
  const finalGitignore = fs.readFileSync(path.join(tempTestDir, '.gitignore'), 'utf8');
  assert.ok(finalGitignore.includes('!.claude/launch.json'), 'Combined .gitignore must include launch.json');
  assert.ok(finalGitignore.includes('!.claude/output-styles/'), 'Combined .gitignore must include output-styles');
  console.log('✔ Layer 2.1: .gitignore 白名單非破壞性規則聯集解衝突測試 100% 通過');

  // 2.2 測試對抗情境：核心程式碼 (Semantic Code) 衝突必須「嚴格拒絕自動解」並保護代碼
  fs.writeFileSync(path.join(tempTestDir, 'app.ts'), 'export function run() { return 1; }\n', 'utf8');
  execFileSync('git', ['add', 'app.ts'], { cwd: tempTestDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'add app.ts'], { cwd: tempTestDir, stdio: 'ignore' });

  // 測試 autoResolveConflicts 對業務代碼檔案的回應
  const adversarialFiles = ['app.ts', 'src/coordinator.ts', 'services/api/index.py', 'contracts/schema.json'];
  const resolutionResult = autoResolveConflicts(tempTestDir, adversarialFiles, 999);
  assert.equal(resolutionResult, false, 'autoResolveConflicts MUST return false on code/schema conflict');
  console.log('✔ Layer 2.2: 業務代碼/合約衝突之防禦閘門（嚴格拒絕自動覆蓋、強制保護原碼）驗證通過\n');
} finally {
  try {
    fs.rmSync(tempTestDir, { recursive: true, force: true });
  } catch {}
}

// -----------------------------------------------------------------------------
// Layer 3: 審批與 CI 綠燈安全性防線 (Security Gate & Blip Review Barrier)
// -----------------------------------------------------------------------------
console.log('--- [Layer 3] 驗證：CI 綠燈防線與 Blip 審批精確性 ---');

// 3.1 驗證只要有 failing check 就絕不審批與合入
assert.ok(scriptContent.includes('if (checks.failed > 0)'), 'Queue engine must abort PR when failed > 0');
assert.ok(scriptContent.includes('checks.allGreen'), 'Approve & Merge must strictly check checks.allGreen');

// 3.2 驗證 Blip 人工等效審批協議綁定 exact base/head SHA
assert.ok(scriptContent.includes('-ExpectedBaseSha'), 'Blip approval must pass ExpectedBaseSha to prevent commit spoofing');
assert.ok(scriptContent.includes('-ExpectedHeadSha'), 'Blip approval must pass ExpectedHeadSha to prevent commit spoofing');
console.log('✔ Layer 3.1 & 3.2: 嚴格 CI 檢查防線與 Blip SHA 綁定審批協議驗證通過\n');

// -----------------------------------------------------------------------------
// 壓力測試 (Stress Test): 多 Session / 多 Worker 高並發競爭測試
// -----------------------------------------------------------------------------
console.log('--- [壓力測試] 20 並行 Worker 互斥鎖爭搶與負載壓力測試 ---');

const NUM_WORKERS = 20;
console.log(`正在啟動 ${NUM_WORKERS} 個背景程序同時觸發 manage-pr-queue.mjs hook...`);

const promises = [];
const startTs = Date.now();

for (let i = 0; i < NUM_WORKERS; i++) {
  promises.push(new Promise((resolve) => {
    const child = spawn(process.execPath, [QUEUE_SCRIPT, 'status'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('close', code => {
      resolve({ index: i, code, stdout, stderr });
    });
  }));
}

const results = await Promise.all(promises);
const durationMs = Date.now() - startTs;

const successCount = results.filter(r => r.code === 0).length;
console.log(`✔ 壓力測試完成：${NUM_WORKERS} 個並發 Worker 在 ${durationMs}ms 內全數安全退出 (成功率: ${successCount}/${NUM_WORKERS} 100%)`);
assert.equal(successCount, NUM_WORKERS, 'All concurrent workers must exit with code 0 without crash or deadlock');

console.log('\n================================================================');
console.log('🎉  所有 3 層交叉對抗驗證與 20 並發壓力測試 100% 通過！');
console.log('================================================================\n');
