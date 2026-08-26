#!/usr/bin/env node
// cleanup-orphan-dev-processes.mjs — Automated Orphan Process Garbage Collection Engine
// Recovers leaked coordinator tsx servers, hung git processes, stale lockfiles, and dangling worktrees
// across all AI CLI sessions (Codex, Claude, AGY, Grok).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function isPidAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // Alive but lacks permission
  }
}

function resolveBoardDir(cwd = SCRIPT_REPO_ROOT) {
  if (process.env.AGENTS_BOARD_DIR) return path.resolve(process.env.AGENTS_BOARD_DIR);
  return path.join(cwd, '.agents', 'board');
}

export function cleanupStaleLocks(boardDir = resolveBoardDir()) {
  let cleaned = 0;
  if (!fs.existsSync(boardDir)) return cleaned;
  const lockFile = path.join(boardDir, 'pr-queue.lock');
  if (fs.existsSync(lockFile)) {
    try {
      const content = fs.readFileSync(lockFile, 'utf8');
      const data = JSON.parse(content || '{}');
      if (data.pid && !isPidAlive(data.pid)) {
        fs.unlinkSync(lockFile);
        cleaned++;
      } else if (data.timestamp && (Date.now() - data.timestamp > 300000)) {
        // Expired TTL > 5 min
        fs.unlinkSync(lockFile);
        cleaned++;
      }
    } catch {
      try { fs.unlinkSync(lockFile); cleaned++; } catch {}
    }
  }
  return cleaned;
}

export function pruneGitWorktrees(repoRoot = SCRIPT_REPO_ROOT) {
  try {
    execFileSync('git', ['worktree', 'prune'], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

export function cleanupOrphanDevProcesses(silent = true) {
  const result = {
    killed: [],
    prunedWorktrees: false,
    staleLocksCleaned: 0
  };

  try {
    result.staleLocksCleaned = cleanupStaleLocks();
    result.prunedWorktrees = pruneGitWorktrees();

    if (process.platform === 'win32') {
      const psCmd = `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq "node.exe" -and ($_.CommandLine -like "*bim-review-coordinator*" -or $_.CommandLine -like "*tsx src/index.ts*")) -or ($_.Name -eq "git.exe") } | Select-Object ProcessId, ParentProcessId, Name, CommandLine | ConvertTo-Json -Compress`;
      const raw = execFileSync('powershell', ['-NoProfile', '-Command', psCmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (raw) {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = [];
        }
        const candidates = Array.isArray(parsed) ? parsed : [parsed];
        for (const proc of candidates) {
          if (!proc || !proc.ProcessId || proc.ProcessId === process.pid) continue;
          const pid = proc.ProcessId;
          const ppid = proc.ParentProcessId;
          const cmd = String(proc.CommandLine || '');
          const name = String(proc.Name || '');

          let isOrphan = false;

          if (name === 'node.exe' && (cmd.includes('bim-review-coordinator') || cmd.includes('tsx src/index.ts'))) {
            // Coordinator server: if parent is dead OR cmdline points to a non-existent or tmp worktree
            if (!isPidAlive(ppid)) {
              isOrphan = true;
            } else {
              const match = cmd.match(/[A-Za-z]:\\[^"'\s]+\.worktrees\\[^"'\s\\]+/i);
              if (match && (!fs.existsSync(match[0]) || match[0].includes('tmp-pr-'))) {
                isOrphan = true;
              }
            }
          } else if (name === 'git.exe') {
            // Hung git commands without an active parent
            if (!isPidAlive(ppid)) {
              isOrphan = true;
            }
          }

          if (isOrphan) {
            try {
              process.kill(pid, 'SIGKILL');
              result.killed.push({ pid, name, cmd });
              if (!silent) {
                process.stdout.write(`[cleanup-orphan-dev-processes] Terminated orphan process: ${name} (PID: ${pid})\n`);
              }
            } catch {}
          }
        }
      }
    }
  } catch (err) {
    if (!silent) {
      process.stderr.write(`[cleanup-orphan-dev-processes] Error during cleanup: ${err.message}\n`);
    }
  }

  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const res = cleanupOrphanDevProcesses(false);
  process.stdout.write(`[cleanup-orphan-dev-processes] Cleanup complete: ${res.killed.length} process(es) killed, locks cleaned: ${res.staleLocksCleaned}\n`);
}
