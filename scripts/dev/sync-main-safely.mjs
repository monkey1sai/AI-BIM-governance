#!/usr/bin/env node
/**
 * Safely synchronize the local main branch with origin/main across all AI agent sessions.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

function git(args, cwd = REPO_ROOT) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export function syncMainSafely(targetDir = REPO_ROOT) {
  try {
    const isGit = git(['rev-parse', '--is-inside-work-tree'], targetDir);
    if (isGit !== 'true') return;

    const root = git(['rev-parse', '--show-toplevel'], targetDir) || targetDir;
    const branch = git(['branch', '--show-current'], root);
    if (branch !== 'main') {
      return;
    }

    const status = git(['status', '--porcelain'], root);
    if (status) {
      process.stdout.write('[Sync-Main] 工作區有未提交的變更 (Dirty)，略過自動 pull 以保護本地程式碼。\n');
      return;
    }

    git(['fetch', 'origin', 'main', '--quiet'], root);
    const behind = parseInt(git(['rev-list', '--count', 'HEAD..origin/main'], root) || '0', 10);
    const ahead = parseInt(git(['rev-list', '--count', 'origin/main..HEAD'], root) || '0', 10);

    if (behind > 0 && ahead === 0) {
      git(['merge', '--ff-only', 'origin/main'], root);
      const head = git(['rev-parse', '--short', 'HEAD'], root);
      process.stdout.write(`[Sync-Main] 已成功將 main 快進同步至 origin/main (落後 ${behind} 個 commit -> 目前 HEAD: ${head})。\n`);
    } else if (ahead > 0) {
      process.stdout.write(`[Sync-Main] 本地 main 領先遠端 ${ahead} 個 commit，略過自動同步。\n`);
    } else {
      process.stdout.write('[Sync-Main] main 與 origin/main 已完全同步。\n');
    }
  } catch (err) {
    // Hooks should never throw or interrupt agent
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  syncMainSafely();
}
