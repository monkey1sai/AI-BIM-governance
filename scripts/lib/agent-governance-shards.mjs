// Agent Governance shard selection.
//
// The suite used to declare a fixed four-leg matrix, so every governance-scoped PR paid four
// Windows runners (4x checkout --depth=0 + setup-node + setup-python) to skip 56-80% of the
// steps in each leg. Selection moves that decision to the scope job: the matrix is built from
// this module's output instead of a literal list.
//
// Selection is NOT a gate. It decides where a step runs, never whether the repository is
// verified — scope's agent_governance boolean still owns that. `core` is always selected, so
// the matrix can never be empty and the aggregator's fail-closed logic is untouched.

import { createHash } from 'node:crypto';

export const AGENT_GOVERNANCE_SHARDS_VERSION = 'agent-governance-shards/v1';

const SHARD_ID = /^[a-z][a-z0-9-]{0,31}$/;

export class AgentGovernanceShardsError extends Error {
  constructor(code, field, message) {
    super(message);
    this.name = 'AgentGovernanceShardsError';
    this.code = code;
    this.field = field;
  }
}

function fail(code, field, message) {
  throw new AgentGovernanceShardsError(code, field, message);
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('shards_invalid', label, `${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('shards_invalid', label, `${label} must have exactly the keys ${expected.join(', ')}.`);
  }
}

function stringArray(value, label) {
  if (!Array.isArray(value)) fail('shards_invalid', label, `${label} must be an array.`);
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || item.length === 0) fail('shards_invalid', `${label}[${index}]`, `${label}[${index}] must be a non-empty string.`);
  }
  return value;
}

export function validateShardPolicy(policy) {
  exactKeys(policy, ['$schema', 'schema_version', 'authority', 'purpose', 'not_a_gate', 'shards'], 'shards');
  if (policy.schema_version !== AGENT_GOVERNANCE_SHARDS_VERSION) fail('shards_invalid', 'schema_version', 'Unsupported shard policy schema version.');
  // The declaration may only choose where work runs. A future edit that widens this string is a
  // mechanism change and must be caught here rather than silently granting the file authority.
  if (policy.authority !== 'shard_selection_only') fail('shards_invalid', 'authority', 'Shard policy authority must stay shard_selection_only.');
  if (!Array.isArray(policy.shards) || policy.shards.length < 2 || policy.shards.length > 16) {
    fail('shards_invalid', 'shards', 'shards must declare between 2 and 16 legs.');
  }
  const seen = new Set();
  let alwaysCount = 0;
  for (const [index, shard] of policy.shards.entries()) {
    exactKeys(shard, ['id', 'always', 'title', 'reason', 'path_globs'], `shards[${index}]`);
    if (typeof shard.id !== 'string' || !SHARD_ID.test(shard.id)) fail('shards_invalid', `shards[${index}].id`, 'Shard id is not a lowercase slug.');
    if (seen.has(shard.id)) fail('shards_invalid', `shards[${index}].id`, `Duplicate shard id ${shard.id}.`);
    seen.add(shard.id);
    if (typeof shard.always !== 'boolean') fail('shards_invalid', `shards[${index}].always`, 'always must be a boolean.');
    for (const field of ['title', 'reason']) {
      if (typeof shard[field] !== 'string' || shard[field].length === 0) fail('shards_invalid', `shards[${index}].${field}`, `${field} must be a non-empty string.`);
    }
    stringArray(shard.path_globs, `shards[${index}].path_globs`);
    if (shard.always) {
      alwaysCount += 1;
      if (shard.path_globs.length > 0) fail('shards_invalid', `shards[${index}].path_globs`, 'An always-selected shard must not also declare path globs.');
    } else if (shard.path_globs.length === 0) {
      // Otherwise the leg is unreachable: never always-on and matched by nothing.
      fail('shards_invalid', `shards[${index}].path_globs`, 'A conditional shard must declare at least one path glob.');
    }
  }
  if (alwaysCount < 1) fail('shards_invalid', 'shards', 'At least one shard must be always-selected so the matrix is never empty.');
  return policy;
}

// Same glob dialect the verification manifest uses: ** spans separators, * does not.
function globToRegExp(glob) {
  let out = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*') {
      if (glob[index + 1] === '*') {
        const skipSlash = glob[index + 2] === '/';
        out += skipSlash ? '(?:.*/)?' : '.*';
        index += skipSlash ? 2 : 1;
      } else {
        out += '[^/]*';
      }
    } else if (char === '?') {
      out += '[^/]';
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`${out}$`);
}

function matches(path, globs) {
  return globs.some((glob) => globToRegExp(glob).test(path));
}

/**
 * Select the shards a changed-path set can actually exercise.
 *
 * @param {object} policy   validated agent-governance-shards/v1 document
 * @param {object} options
 * @param {string[]} options.changedPaths  repository-relative changed paths
 * @param {boolean} options.full           true when the plan dispatched full (self-change)
 * @returns {{shards: string[], reasons: object, full: boolean, policy_sha256: string}}
 */
export function selectShards(policy, { changedPaths = [], full = false } = {}) {
  validateShardPolicy(policy);
  stringArray(changedPaths, 'changedPaths');
  const reasons = {};
  const selected = [];
  for (const shard of policy.shards) {
    if (shard.always) {
      selected.push(shard.id);
      reasons[shard.id] = 'always';
      continue;
    }
    if (full) {
      // A full dispatch means the change touched the verification mechanism itself, so no
      // path-based narrowing is trustworthy: run every leg.
      selected.push(shard.id);
      reasons[shard.id] = 'full_dispatch';
      continue;
    }
    const hit = changedPaths.find((path) => matches(path, shard.path_globs));
    if (hit !== undefined) {
      selected.push(shard.id);
      reasons[shard.id] = `changed_path:${hit}`;
    }
  }
  if (selected.length === 0) fail('shards_invalid', 'shards', 'Selection produced an empty matrix; an always-selected shard is required.');
  return Object.freeze({
    shards: Object.freeze(selected),
    reasons: Object.freeze(reasons),
    full,
    policy_sha256: createHash('sha256').update(`${JSON.stringify(policy)}\n`).digest('hex'),
  });
}
