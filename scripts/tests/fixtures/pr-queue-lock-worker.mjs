import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { acquirePrQueueLock } from '../../dev/pr-queue-lock.mjs';

const [repoRoot, stateDir, resultsFile] = process.argv.slice(2);
if (!repoRoot || !stateDir || !resultsFile) process.exit(2);

const identityForPid = (pid) => `fixture-process:${pid}`;
const deadline = Date.now() + 15_000;
let lock = null;
while (!lock && Date.now() < deadline) {
  lock = acquirePrQueueLock({
    repoRoot,
    getProcessCreationIdentityImpl: identityForPid,
  });
  if (!lock) await delay(5 + Math.floor(Math.random() * 15));
}
if (!lock) process.exit(3);

const guardFile = path.join(stateDir, 'critical-section.guard');
let guardDescriptor;
try {
  guardDescriptor = fs.openSync(guardFile, 'wx', 0o600);
  await delay(20 + Math.floor(Math.random() * 30));
  fs.appendFileSync(resultsFile, `${process.pid}:${lock.ownerToken}\n`, 'utf8');
} catch {
  process.exitCode = 4;
} finally {
  if (guardDescriptor !== undefined) {
    try { fs.closeSync(guardDescriptor); } catch {}
    try { fs.unlinkSync(guardFile); } catch {}
  }
  if (!lock.release()) process.exitCode = 5;
}
