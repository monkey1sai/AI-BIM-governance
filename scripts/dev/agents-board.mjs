#!/usr/bin/env node
// agents-board — 多終端機/多 CLI(Claude Code、Codex、Grok)並行 session 感知看板。
// 看板落在主 checkout 的 .agents/board/(gitignored;worktree 透過 git-common-dir 共用同一塊)。
// 契約與各 CLI 整合方式見 docs/agents/parallel-session-board.md。
// 用法:
//   node scripts/dev/agents-board.mjs register --agent codex [--session <id>] [--task "..."]
//   node scripts/dev/agents-board.mjs update   --agent codex [--session <id>] [--task "..."] [--status active|idle|ended] [--file <path>]
//   node scripts/dev/agents-board.mjs status   [--json] [--no-prune]
//   node scripts/dev/agents-board.mjs done     --agent codex [--session <id>]
//   node scripts/dev/agents-board.mjs hook     --event SessionStart|UserPromptSubmit|PostToolUse|Stop|SessionEnd   (讀 stdin JSON;Claude Code hooks 專用)
//   node scripts/dev/agents-board.mjs codex-notify '<json>'   (Codex config.toml notify 專用)

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { syncMainSafely } from './sync-main-safely.mjs';
import { triggerPrQueueHook } from './manage-pr-queue.mjs';
import { cleanupOrphanDevProcesses } from './cleanup-orphan-dev-processes.mjs';

const STALE_MINUTES = 120;
const PRUNE_ENDED_HOURS = 24;
const PRUNE_ANY_HOURS = 72;
const EVENTS_MAX_BYTES = 512 * 1024;
const RECENT_FILES_MAX = 5;
const TASK_MAX_CHARS = 160;

const SCRIPT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function normalizeForCompare(p) {
  const abs = path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

// 解析看板位置:主 checkout 根目錄 /.agents/board(worktree 內執行也會解析回主 checkout)
function resolveBoardDir(cwd) {
  if (process.env.AGENTS_BOARD_DIR) return path.resolve(process.env.AGENTS_BOARD_DIR);
  const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
  if (!commonDir) return '';
  return path.join(path.dirname(commonDir), '.agents', 'board');
}

function sessionsDir(boardDir) {
  return path.join(boardDir, 'sessions');
}

function sanitizeId(id) {
  return String(id || '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 24) || 'unknown';
}

function sanitizeTask(text) {
  return String(text || '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim().slice(0, TASK_MAX_CHARS);
}

function nowIso() {
  return new Date().toISOString();
}

function minutesSince(iso) {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 60000;
}

function relTime(iso) {
  const m = minutesSince(iso);
  if (!Number.isFinite(m)) return '時間未知';
  if (m < 1) return '剛剛';
  if (m < 60) return `${Math.floor(m)} 分鐘前`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} 小時前`;
  return `${Math.floor(m / (60 * 24))} 天前`;
}

function readSessions(boardDir) {
  const dir = sessionsDir(boardDir);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      data._file = path.join(dir, name);
      out.push(data);
    } catch {
      // 壞檔忽略,交給 prune 淘汰
    }
  }
  return out;
}

function writeSession(boardDir, record) {
  const dir = sessionsDir(boardDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${record.agent}--${record.session}.json`);
  const tmp = `${file}.tmp-${process.pid}`;
  const { _file, ...clean } = record;
  fs.writeFileSync(tmp, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

function appendEvent(boardDir, event) {
  fs.mkdirSync(boardDir, { recursive: true });
  const file = path.join(boardDir, 'events.jsonl');
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > EVENTS_MAX_BYTES) {
      fs.renameSync(file, path.join(boardDir, 'events.1.jsonl'));
    }
  } catch {
    // 輪替失敗不阻斷主流程
  }
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
}

function readRecentEvents(boardDir, limit) {
  const file = path.join(boardDir, 'events.jsonl');
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-limit).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function pruneSessions(boardDir) {
  for (const s of readSessions(boardDir)) {
    const ageH = minutesSince(s.updatedAt) / 60;
    const dead = (s.status === 'ended' && ageH > PRUNE_ENDED_HOURS) || ageH > PRUNE_ANY_HOURS;
    if (dead) {
      try { fs.unlinkSync(s._file); } catch { /* 忽略 */ }
    }
  }
}

function upsertSession(boardDir, { agent, session, cwd, task, status, file }) {
  const existing = readSessions(boardDir).find((s) => s.agent === agent && s.session === session);
  const record = existing || {
    agent,
    session,
    status: 'active',
    task: '',
    cwd: '',
    branch: '',
    startedAt: nowIso(),
    updatedAt: nowIso(),
    recentFiles: [],
  };
  if (cwd) {
    record.cwd = cwd;
    record.branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) || record.branch;
  }
  if (task) record.task = sanitizeTask(task);
  if (status) record.status = status;
  if (file) {
    let rel = file;
    const root = path.dirname(path.dirname(boardDir));
    if (normalizeForCompare(file).startsWith(normalizeForCompare(root) + (process.platform === 'win32' ? '\\' : path.sep))) {
      rel = path.relative(root, file).split(path.sep).join('/');
    }
    record.recentFiles = [rel, ...(record.recentFiles || []).filter((f) => f !== rel)].slice(0, RECENT_FILES_MAX);
  }
  record.updatedAt = nowIso();
  writeSession(boardDir, record);
  return record;
}

function formatSessionLine(s) {
  const stale = s.status !== 'ended' && minutesSince(s.updatedAt) > STALE_MINUTES ? ' (stale)' : '';
  const branch = s.branch ? ` branch=${s.branch}` : '';
  const task = s.task ? ` task="${s.task}"` : '';
  return `${s.agent} [${s.status}]${stale} ${s.session}${branch}${task} (${relTime(s.updatedAt)})`;
}

function printStatus(boardDir, asJson, shouldPrune = true) {
  if (shouldPrune) pruneSessions(boardDir);
  const order = { active: 0, idle: 1, ended: 2 };
  const sessions = readSessions(boardDir)
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
  const events = readRecentEvents(boardDir, 12);
  if (asJson) {
    const clean = sessions.map(({ _file, ...s }) => s);
    process.stdout.write(`${JSON.stringify({ boardDir, sessions: clean, recentEvents: events }, null, 2)}\n`);
    return;
  }
  const lines = [`=== agents-board @ ${boardDir} ===`];
  if (sessions.length === 0) {
    lines.push('(目前沒有登錄中的 session)');
  }
  for (const s of sessions) {
    lines.push(`- ${formatSessionLine(s)}`);
    if ((s.recentFiles || []).length > 0) lines.push(`    files: ${s.recentFiles.join(', ')}`);
  }
  if (events.length > 0) {
    lines.push('--- 最近事件 ---');
    for (const e of events) {
      lines.push(`${(e.ts || '').slice(5, 16).replace('T', ' ')} ${e.agent} ${e.session} ${e.event}${e.detail ? ` ${e.detail}` : ''}`);
    }
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function detectHookAgent() {
  if (process.env.AGENTS_BOARD_AGENT) return sanitizeId(process.env.AGENTS_BOARD_AGENT);
  if (process.env.CLAUDECODE || process.env.CLAUDE_PROJECT_DIR) return 'claude';
  return 'cli';
}

function resolveManualSession(boardDir, agent, requested) {
  if (requested) return sanitizeId(requested);
  if (process.env.AGENTS_BOARD_SESSION) return sanitizeId(process.env.AGENTS_BOARD_SESSION);
  const candidates = readSessions(boardDir).filter((s) => s.agent === agent && s.status !== 'ended');
  if (candidates.length === 1) return candidates[0].session;
  return '';
}

function runManual(command, args) {
  const cwd = process.cwd();
  const boardDir = resolveBoardDir(cwd);
  if (!boardDir) {
    process.stderr.write('agents-board: 不在 git repo 內,無法解析看板位置(或設定 AGENTS_BOARD_DIR)\n');
    process.exit(1);
  }
  if (command === 'status') {
    printStatus(boardDir, Boolean(args.json), !Boolean(args['no-prune']));
    return;
  }
  const agent = sanitizeId(args.agent || detectHookAgent());
  if (command === 'register') {
    const session = args.session ? sanitizeId(args.session) : (process.env.AGENTS_BOARD_SESSION ? sanitizeId(process.env.AGENTS_BOARD_SESSION) : randomBytes(3).toString('hex'));
    pruneSessions(boardDir);
    const record = upsertSession(boardDir, { agent, session, cwd, task: args.task, status: 'active' });
    appendEvent(boardDir, { ts: nowIso(), agent, session, event: 'register', detail: record.branch || '' });
    process.stdout.write(`registered agent=${agent} session=${session}(後續指令帶 --session ${session})\n`);
    printStatus(boardDir, false);
    triggerPrQueueHook(true);
    return;
  }
  const session = resolveManualSession(boardDir, agent, args.session);
  if (!session) {
    process.stderr.write(`agents-board: 找不到唯一的 ${agent} session;請帶 --session <id>(見 status 輸出)\n`);
    process.exit(1);
  }
  if (command === 'update') {
    upsertSession(boardDir, { agent, session, cwd, task: args.task, status: args.status, file: args.file });
    if (args.task) appendEvent(boardDir, { ts: nowIso(), agent, session, event: 'task', detail: sanitizeTask(args.task) });
    process.stdout.write(`updated agent=${agent} session=${session}\n`);
    return;
  }
  if (command === 'done') {
    upsertSession(boardDir, { agent, session, cwd, status: 'ended' });
    appendEvent(boardDir, { ts: nowIso(), agent, session, event: 'done', detail: '' });
    process.stdout.write(`done agent=${agent} session=${session}\n`);
    syncMainSafely(cwd);
    cleanupOrphanDevProcesses();
    triggerPrQueueHook(true);
    return;
  }
  process.stderr.write(`agents-board: 未知指令 ${command}\n`);
  process.exit(1);
}

// Claude Code hooks 入口:讀 stdin JSON;永遠 exit 0、不寫 stderr,避免干擾 agent 對話。
function runHook(args) {
  let payload = {};
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    payload = {};
  }
  const event = String(args.event || payload.hook_event_name || '');
  const cwd = payload.cwd || process.cwd();
  const boardDir = resolveBoardDir(cwd);
  if (!boardDir || !event) return;
  const agent = detectHookAgent();
  const session = sanitizeId(String(payload.session_id || 'unknown').slice(0, 8));

  if (event === 'SessionStart') {
    pruneSessions(boardDir);
    syncMainSafely(cwd);
    cleanupOrphanDevProcesses();
    triggerPrQueueHook(true);
    const others = readSessions(boardDir).filter((s) => !(s.agent === agent && s.session === session) && s.status !== 'ended');
    upsertSession(boardDir, { agent, session, cwd, task: '(session 已啟動)', status: 'active' });
    appendEvent(boardDir, { ts: nowIso(), agent, session, event: 'session-start', detail: '' });
    if (others.length > 0) {
      const lines = ['[agents-board] 偵測到其他並行 agent session:'];
      for (const s of others.slice(0, 6)) lines.push(`- ${formatSessionLine(s)}`);
      lines.push('動工前先確認不與上述 session 的 branch/檔案相撞;查看板:node scripts/dev/agents-board.mjs status(契約:docs/agents/parallel-session-board.md)');
      process.stdout.write(`${lines.join('\n')}\n`);
    }
    return;
  }
  if (event === 'UserPromptSubmit') {
    const prompt = sanitizeTask(payload.prompt);
    upsertSession(boardDir, { agent, session, cwd, task: prompt || undefined, status: 'active' });
    if (prompt) appendEvent(boardDir, { ts: nowIso(), agent, session, event: 'task', detail: prompt });
    return;
  }
  if (event === 'PostToolUse') {
    const input = payload.tool_input || {};
    const file = input.file_path || input.notebook_path || '';
    upsertSession(boardDir, { agent, session, cwd, status: 'active', file: file || undefined });
    if (file) {
      appendEvent(boardDir, { ts: nowIso(), agent, session, event: 'edit', detail: String(file) });
    }
    return;
  }
  if (event === 'Stop') {
    upsertSession(boardDir, { agent, session, cwd, status: 'idle' });
    cleanupOrphanDevProcesses();
    triggerPrQueueHook(true);
    return;
  }
  if (event === 'SessionEnd') {
    upsertSession(boardDir, { agent, session, cwd, status: 'ended' });
    appendEvent(boardDir, { ts: nowIso(), agent, session, event: 'session-end', detail: '' });
    syncMainSafely(cwd);
    cleanupOrphanDevProcesses();
    triggerPrQueueHook(true);
  }
}

// Codex config.toml notify 入口:payload JSON 走 argv;只處理本 repo 的 turn,其他 repo 靜默跳過。
function runCodexNotify(jsonArg) {
  let payload = {};
  try {
    payload = JSON.parse(jsonArg || '{}');
  } catch {
    return;
  }
  const type = String(payload.type || '');
  if (type && type !== 'agent-turn-complete') return;
  const cwd = payload.cwd || payload['working-directory'] || process.cwd();
  const boardDir = resolveBoardDir(cwd);
  if (!boardDir) return;
  const boardRoot = path.dirname(path.dirname(boardDir));
  if (!process.env.AGENTS_BOARD_DIR && normalizeForCompare(boardRoot) !== normalizeForCompare(SCRIPT_REPO_ROOT)) return;
  const session = sanitizeId(String(payload['thread-id'] || payload['session-id'] || payload['conversation-id'] || 'notify').slice(0, 8));
  const inputMessages = Array.isArray(payload['input-messages']) ? payload['input-messages'] : (Array.isArray(payload.input_messages) ? payload.input_messages : []);
  const task = sanitizeTask(inputMessages[0] || '');
  upsertSession(boardDir, { agent: 'codex', session, cwd, task: task || undefined, status: 'idle' });
  appendEvent(boardDir, { ts: nowIso(), agent, session, event: 'turn-complete', detail: task });
  cleanupOrphanDevProcesses();
  triggerPrQueueHook(true);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) {
    process.stderr.write('用法見檔頭註解或 docs/agents/parallel-session-board.md\n');
    process.exit(1);
  }
  if (command === 'hook') {
    try {
      runHook(parseArgs(rest));
    } catch {
      // hooks 絕不因看板失敗而干擾 agent
    }
    process.exit(0);
  }
  if (command === 'codex-notify') {
    try {
      runCodexNotify(rest[0]);
    } catch {
      // notify 絕不拋錯
    }
    process.exit(0);
  }
  runManual(command, parseArgs(rest));
}

main();
