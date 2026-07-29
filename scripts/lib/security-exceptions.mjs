const ID = /^[a-z][a-z0-9-]{0,63}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]+$/u;
const SECRET_LIKE = /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{50,}|xox[baprs]-[A-Za-z0-9-]+/u;
const ENTRY_KEYS = ['id', 'gate_id', 'rule_id', 'finding_fingerprint', 'exact_scope', 'owner', 'reason', 'created_on', 'expires_on'];

function reject(message) { throw new Error(message); }
function parseDate(value) {
  if (!DATE.test(value)) return Number.NaN;
  const [year, month, day] = value.split('-').map(Number);
  const result = Date.UTC(year, month - 1, day);
  return new Date(result).toISOString().slice(0, 10) === value ? result : Number.NaN;
}
function exactKeys(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) reject(`${label} has missing or unknown properties.`);
}

export function validateSecurityExceptions(document, manifest, now = new Date()) {
  exactKeys(document, ['schema_version', 'exceptions'], 'security exception ledger');
  if (document.schema_version !== 'security-exceptions/v1' || !Array.isArray(document.exceptions) || document.exceptions.length > 500) {
    reject('Security exception ledger contract is invalid.');
  }
  const allowedGates = new Set(manifest.security_policy.scan_gate_ids);
  const ids = new Set();
  const fingerprints = new Set();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const [index, entry] of document.exceptions.entries()) {
    exactKeys(entry, ENTRY_KEYS, `exceptions[${index}]`);
    if (!ID.test(entry.id) || ids.has(entry.id) || !allowedGates.has(entry.gate_id) || !ID.test(entry.rule_id) ||
        !SHA256.test(entry.finding_fingerprint) || typeof entry.exact_scope !== 'string' || !entry.exact_scope || entry.exact_scope.length > 300 ||
        !SAFE_TEXT.test(entry.exact_scope) || SECRET_LIKE.test(entry.exact_scope) ||
        entry.exact_scope.includes('*') || entry.exact_scope.includes('..') || /^[A-Za-z]:|^[\\/]/u.test(entry.exact_scope) ||
        typeof entry.owner !== 'string' || entry.owner !== entry.owner.trim() || entry.owner.length < 2 || entry.owner.length > 100 ||
        !SAFE_TEXT.test(entry.owner) || SECRET_LIKE.test(entry.owner) ||
        typeof entry.reason !== 'string' || entry.reason !== entry.reason.trim() || entry.reason.length < 8 || entry.reason.length > 300 ||
        !SAFE_TEXT.test(entry.reason) || SECRET_LIKE.test(entry.reason) ||
        !DATE.test(entry.created_on) || !DATE.test(entry.expires_on)) reject(`exceptions[${index}] is invalid.`);
    const fingerprintKey = `${entry.gate_id}\0${entry.rule_id}\0${entry.finding_fingerprint}\0${entry.exact_scope}`;
    if (fingerprints.has(fingerprintKey)) reject(`exceptions[${index}] duplicates a finding scope.`);
    const created = parseDate(entry.created_on);
    const expires = parseDate(entry.expires_on);
    const days = (expires - created) / 86_400_000;
    if (!Number.isFinite(created) || !Number.isFinite(expires) || created > today || expires <= today ||
        days < 1 || days > manifest.security_policy.exception_max_days) {
      reject(`exceptions[${index}] is expired or exceeds the maximum lifetime.`);
    }
    ids.add(entry.id);
    fingerprints.add(fingerprintKey);
  }
  return { exception_count: document.exceptions.length, result: 'valid' };
}
