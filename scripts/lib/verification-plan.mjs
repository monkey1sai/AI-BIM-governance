import { appendFileSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { assertSafeVerificationCommand } from './verification-command-policy.mjs';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';

const MANIFEST_KEYS = ['schema_version', 'unknown_path_policy', 'full_dispatch_globs', 'known_non_code_globs', 'path_classes', 'gates', 'targets', 'quality_policy', 'security_policy', 'artifact_policy'];
const TARGET_KEYS = ['id', 'display_name', 'path_globs', 'owner', 'fast_gates', 'contract_gates', 'slow_evidence_gates', 'required_when', 'skip_reason', 'default_profiles', 'ci_output', 'ci_job', 'result_artifact'];
const GATE_KEYS = ['id', 'capabilities', 'enforcement', 'command', 'cwd', 'evidence_class', 'configured', 'not_configured_reason'];
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const PROFILES = new Set(['developer', 'developer-ts', 'developer-py', 'developer-streaming', 'developer-none']);
const CAPABILITIES = new Set([
  'types', 'lint', 'unit', 'contract', 'build', 'static-analysis', 'deployment-contract',
  'visual', 'runtime', 'secret', 'dependency', 'sast', 'changed-lines-coverage',
]);
const NOT_CONFIGURED_REASONS = new Set([
  'tooling_absent', 'coverage_instrumentation_absent', 'host_runtime_required',
  'hosted_capability_unverified', 'deployment_pipeline_absent',
]);

export class VerificationPlanError extends Error {
  constructor(code, field, message) {
    super(message);
    this.name = 'VerificationPlanError';
    this.code = code;
    this.field = field;
  }
}

function fail(code, field, message) {
  throw new VerificationPlanError(code, field, message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys, field) {
  if (!isObject(value)) fail('manifest_schema_invalid', field, `${field} must be an object.`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail('manifest_schema_invalid', field, `${field} has missing or unknown properties.`);
  }
}

function stringArray(value, field, { nonEmpty = false, id = false, unique = true } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0) || value.length > 100 ||
      value.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 500 || (id && !ID.test(item))) ||
      (unique && new Set(value).size !== value.length)) {
    fail('manifest_schema_invalid', field, `${field} must be a bounded unique string array.`);
  }
}

export function validateVerificationManifest(manifest) {
  exactKeys(manifest, MANIFEST_KEYS, 'manifest');
  if (manifest.schema_version !== 'verification-manifest/v2' || manifest.unknown_path_policy !== 'fail_closed') {
    fail('manifest_schema_invalid', 'manifest.schema_version', 'Unsupported verification manifest contract.');
  }
  stringArray(manifest.full_dispatch_globs, 'manifest.full_dispatch_globs', { nonEmpty: true });
  stringArray(manifest.known_non_code_globs, 'manifest.known_non_code_globs', { nonEmpty: true });
  if (!Array.isArray(manifest.path_classes) || manifest.path_classes.length === 0 || manifest.path_classes.length > 100) {
    fail('manifest_schema_invalid', 'manifest.path_classes', 'path_classes must be a bounded array.');
  }
  const classIds = new Set();
  for (const [index, item] of manifest.path_classes.entries()) {
    exactKeys(item, ['id', 'path_globs'], `manifest.path_classes[${index}]`);
    if (typeof item.id !== 'string' || !ID.test(item.id) || classIds.has(item.id)) {
      fail('manifest_semantic_invalid', `manifest.path_classes[${index}].id`, 'Path-class id is invalid or duplicated.');
    }
    classIds.add(item.id);
    stringArray(item.path_globs, `manifest.path_classes[${index}].path_globs`, { nonEmpty: true });
  }
  if (!Array.isArray(manifest.gates) || manifest.gates.length === 0 || manifest.gates.length > 200) {
    fail('manifest_schema_invalid', 'manifest.gates', 'gates must be a bounded array.');
  }
  const gateById = new Map();
  for (const [index, gate] of manifest.gates.entries()) {
    const field = `manifest.gates[${index}]`;
    exactKeys(gate, GATE_KEYS, field);
    if (typeof gate.id !== 'string' || !ID.test(gate.id) || gateById.has(gate.id)) {
      fail('manifest_semantic_invalid', `${field}.id`, 'Gate id is invalid or duplicated.');
    }
    stringArray(gate.capabilities, `${field}.capabilities`, { nonEmpty: true, id: true });
    if (gate.capabilities.some((capability) => !CAPABILITIES.has(capability))) {
      fail('manifest_schema_invalid', `${field}.capabilities`, 'Gate capability is unknown.');
    }
    if (!['required', 'advisory'].includes(gate.enforcement)) {
      fail('manifest_schema_invalid', `${field}.enforcement`, 'Gate enforcement is invalid.');
    }
    if (gate.configured) {
      exactKeys(gate.command, ['executable', 'args'], `${field}.command`);
      if (!['docker', 'npm', 'npx', 'pwsh', 'python'].includes(gate.command.executable)) {
        fail('manifest_schema_invalid', `${field}.command.executable`, 'Gate executable is unknown.');
      }
      stringArray(gate.command.args, `${field}.command.args`, { unique: false });
      try {
        assertSafeVerificationCommand(gate.command);
      } catch (error) {
        fail('manifest_command_unsafe', `${field}.command`, error.message);
      }
      if (gate.not_configured_reason !== null) {
        fail('manifest_schema_invalid', `${field}.not_configured_reason`, 'Configured gates cannot carry a not-configured reason.');
      }
    } else if (gate.command !== null || !NOT_CONFIGURED_REASONS.has(gate.not_configured_reason)) {
      fail('manifest_schema_invalid', field, 'Not-configured gates require a null command and a closed reason.');
    }
    if (typeof gate.cwd !== 'string' || !gate.cwd || path.isAbsolute(gate.cwd) || gate.cwd.split(/[\\/]/u).includes('..')) {
      fail('manifest_schema_invalid', `${field}.cwd`, 'Gate cwd must be repository-relative.');
    }
    if (!['fast', 'contract', 'slow', 'security'].includes(gate.evidence_class) || typeof gate.configured !== 'boolean') {
      fail('manifest_schema_invalid', field, 'Gate evidence class or configured state is invalid.');
    }
    gateById.set(gate.id, gate);
  }
  if (!Array.isArray(manifest.targets) || manifest.targets.length === 0 || manifest.targets.length > 100) {
    fail('manifest_schema_invalid', 'manifest.targets', 'targets must be a bounded array.');
  }
  const targetIds = new Set();
  for (const [index, target] of manifest.targets.entries()) {
    const field = `manifest.targets[${index}]`;
    exactKeys(target, TARGET_KEYS, field);
    if (typeof target.id !== 'string' || !ID.test(target.id) || targetIds.has(target.id)) {
      fail('manifest_semantic_invalid', `${field}.id`, 'Target id is invalid or duplicated.');
    }
    targetIds.add(target.id);
    if (typeof target.display_name !== 'string' || !target.display_name.trim() ||
        typeof target.owner !== 'string' || !target.owner.trim()) {
      fail('manifest_schema_invalid', field, 'Target display name and owner are required.');
    }
    stringArray(target.path_globs, `${field}.path_globs`, { nonEmpty: true });
    for (const key of ['fast_gates', 'contract_gates', 'slow_evidence_gates']) {
      stringArray(target[key], `${field}.${key}`, { id: true });
      for (const gateId of target[key]) {
        if (!gateById.has(gateId)) fail('manifest_semantic_invalid', `${field}.${key}`, `Unknown gate: ${gateId}`);
      }
    }
    const allGateIds = [...target.fast_gates, ...target.contract_gates, ...target.slow_evidence_gates];
    if (allGateIds.length === 0 || new Set(allGateIds).size !== allGateIds.length) {
      fail('manifest_semantic_invalid', field, 'Target must reference at least one gate exactly once.');
    }
    exactKeys(target.required_when, ['predicate', 'any_of'], `${field}.required_when`);
    if (target.required_when.predicate !== 'changed_path_class') {
      fail('manifest_schema_invalid', `${field}.required_when.predicate`, 'Unknown required_when predicate.');
    }
    stringArray(target.required_when.any_of, `${field}.required_when.any_of`, { nonEmpty: true, id: true });
    for (const classId of target.required_when.any_of) {
      if (!classIds.has(classId)) fail('manifest_semantic_invalid', `${field}.required_when.any_of`, `Unknown path class: ${classId}`);
    }
    if (target.skip_reason !== 'path_not_affected' || !Array.isArray(target.default_profiles) ||
        target.default_profiles.some((profile) => !PROFILES.has(profile)) || new Set(target.default_profiles).size !== target.default_profiles.length) {
      fail('manifest_schema_invalid', field, 'Target skip reason or profile is invalid.');
    }
    if (target.ci_output !== null) {
      if (typeof target.ci_output !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/u.test(target.ci_output)) {
        fail('manifest_semantic_invalid', `${field}.ci_output`, 'CI output is invalid.');
      }
    }
    if (typeof target.ci_job !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._:/()-]{0,199}$/u.test(target.ci_job)) {
      fail('manifest_semantic_invalid', `${field}.ci_job`, 'CI job name is invalid.');
    }
    if (target.result_artifact !== null) {
      exactKeys(target.result_artifact, ['artifact_name_prefix', 'result_path', 'kind', 'schema_version', 'subject_field'], `${field}.result_artifact`);
      const artifact = target.result_artifact;
      if (typeof artifact.artifact_name_prefix !== 'string' || !/^[a-z0-9][a-z0-9-]*-$/u.test(artifact.artifact_name_prefix) ||
          typeof artifact.result_path !== 'string' || !artifact.result_path.startsWith('artifacts/e2e/') ||
          artifact.result_path.includes('\\') || artifact.result_path.includes('\0') || path.isAbsolute(artifact.result_path) ||
          artifact.result_path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
          !['ai-bim-design-system-visual-result', 'ai-bim-functional-runtime-result'].includes(artifact.kind) ||
          ![1, 2].includes(artifact.schema_version) || artifact.subject_field !== 'subject_commit') {
        fail('manifest_semantic_invalid', `${field}.result_artifact`, 'Result artifact contract is invalid.');
      }
    }
  }
  exactKeys(manifest.quality_policy, ['service_targets', 'minimum_capabilities', 'coverage'], 'manifest.quality_policy');
  stringArray(manifest.quality_policy.service_targets, 'manifest.quality_policy.service_targets', { nonEmpty: true, id: true });
  stringArray(manifest.quality_policy.minimum_capabilities, 'manifest.quality_policy.minimum_capabilities', { nonEmpty: true, id: true });
  if (JSON.stringify([...manifest.quality_policy.minimum_capabilities].sort()) !== JSON.stringify(['lint', 'types', 'unit-or-contract'])) {
    fail('manifest_semantic_invalid', 'manifest.quality_policy.minimum_capabilities', 'Quality policy must cover types, lint, and unit-or-contract.');
  }
  exactKeys(manifest.quality_policy.coverage,
    ['mode', 'whole_repository_percentage', 'changed_lines_gate_ids', 'critical_contract_gate_ids'],
    'manifest.quality_policy.coverage');
  const coverage = manifest.quality_policy.coverage;
  if (coverage.mode !== 'changed-lines-and-critical-contracts' || coverage.whole_repository_percentage !== null) {
    fail('manifest_semantic_invalid', 'manifest.quality_policy.coverage', 'Coverage policy must reject a whole-repository vanity percentage.');
  }
  for (const key of ['changed_lines_gate_ids', 'critical_contract_gate_ids']) {
    stringArray(coverage[key], `manifest.quality_policy.coverage.${key}`, { nonEmpty: true, id: true });
    for (const gateId of coverage[key]) {
      if (!gateById.has(gateId)) fail('manifest_semantic_invalid', `manifest.quality_policy.coverage.${key}`, `Unknown gate: ${gateId}`);
    }
  }
  if (coverage.changed_lines_gate_ids.some((gateId) => !gateById.get(gateId).capabilities.includes('changed-lines-coverage')) ||
      coverage.critical_contract_gate_ids.some((gateId) => !gateById.get(gateId).capabilities.includes('contract'))) {
    fail('manifest_semantic_invalid', 'manifest.quality_policy.coverage', 'Coverage policy references the wrong gate capability.');
  }
  exactKeys(manifest.security_policy,
    ['exception_registry', 'exception_max_days', 'scan_gate_ids', 'redacted_output_fields'],
    'manifest.security_policy');
  const security = manifest.security_policy;
  if (typeof security.exception_registry !== 'string' || path.isAbsolute(security.exception_registry) ||
      security.exception_registry.split(/[\\/]/u).some((segment) => !segment || segment === '.' || segment === '..') ||
      !Number.isInteger(security.exception_max_days) || security.exception_max_days < 1 || security.exception_max_days > 365) {
    fail('manifest_semantic_invalid', 'manifest.security_policy', 'Security exception policy is invalid.');
  }
  stringArray(security.scan_gate_ids, 'manifest.security_policy.scan_gate_ids', { nonEmpty: true, id: true });
  for (const gateId of security.scan_gate_ids) {
    const gate = gateById.get(gateId);
    if (!gate || !gate.capabilities.some((capability) => ['secret', 'dependency', 'sast'].includes(capability))) {
      fail('manifest_semantic_invalid', 'manifest.security_policy.scan_gate_ids', `Unknown or non-security gate: ${gateId}`);
    }
  }
  stringArray(security.redacted_output_fields, 'manifest.security_policy.redacted_output_fields', { nonEmpty: true, id: true });
  if (JSON.stringify([...security.redacted_output_fields].sort()) !== JSON.stringify(['raw-output', 'secret-values', 'source-snippets'])) {
    fail('manifest_semantic_invalid', 'manifest.security_policy.redacted_output_fields', 'Security reports must exclude raw output, source snippets, and secret values.');
  }
  exactKeys(manifest.artifact_policy,
    ['attestation_scope', 'attestation_enforcement', 'not_configured_reason', 'deployable_kinds', 'evidence_kinds', 'evidence_bindings', 'excluded_globs'],
    'manifest.artifact_policy');
  const artifacts = manifest.artifact_policy;
  if (artifacts.attestation_scope !== 'deployables-only' || artifacts.attestation_enforcement !== 'not_configured' ||
      artifacts.not_configured_reason !== 'deployment_pipeline_absent') {
    fail('manifest_semantic_invalid', 'manifest.artifact_policy', 'Artifact attestation must remain deployables-only until a release pipeline exists.');
  }
  for (const [key, expected] of [
    ['deployable_kinds', ['binary', 'container']],
    ['evidence_kinds', ['ai-bim-design-system-visual-result', 'ai-bim-functional-runtime-result']],
    ['evidence_bindings', ['sha256', 'subject-commit']],
    ['excluded_globs', ['artifacts/e2e/**']],
  ]) {
    stringArray(artifacts[key], `manifest.artifact_policy.${key}`, { nonEmpty: true, id: key !== 'excluded_globs' });
    if (JSON.stringify([...artifacts[key]].sort()) !== JSON.stringify([...expected].sort())) {
      fail('manifest_semantic_invalid', `manifest.artifact_policy.${key}`, 'Artifact policy does not match the closed allowlist.');
    }
  }
  const targetById = new Map(manifest.targets.map((target) => [target.id, target]));
  for (const targetId of manifest.quality_policy.service_targets) {
    const target = targetById.get(targetId);
    if (!target) fail('manifest_semantic_invalid', 'manifest.quality_policy.service_targets', `Unknown target: ${targetId}`);
    const gateIds = [...target.fast_gates, ...target.contract_gates, ...target.slow_evidence_gates];
    const capabilities = new Set(gateIds.flatMap((gateId) => gateById.get(gateId).capabilities));
    if (!capabilities.has('types') || !capabilities.has('lint') || (!capabilities.has('unit') && !capabilities.has('contract'))) {
      fail('manifest_semantic_invalid', 'manifest.quality_policy.service_targets', `${targetId} lacks a types, lint, or unit/contract policy.`);
    }
  }
  return { gateById };
}

function globRegex(glob) {
  let expression = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      index += 1;
      if (glob[index + 1] === '/') {
        index += 1;
        expression += '(?:.*/)?';
      } else expression += '.*';
    } else if (char === '*') expression += '[^/]*';
    else if (char === '?') expression += '[^/]';
    else expression += char.replace(/[\\^$+.()|{}\[\]]/gu, '\\$&');
  }
  return new RegExp(`${expression}$`, 'u');
}

function matchesAny(filePath, globs) {
  return globs.some((glob) => globRegex(glob).test(filePath));
}

function normalizeChangedPath(value) {
  if (value === '__full__') return value;
  if (typeof value !== 'string' || !value || value.includes('\0') || path.isAbsolute(value) || /^[A-Za-z]:/u.test(value)) {
    fail('changed_path_invalid', 'changed_paths', 'Changed paths must be non-empty repository-relative paths.');
  }
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (normalized.split('/').some((segment) => segment === '' || segment === '..' || segment === '.')) {
    fail('changed_path_invalid', 'changed_paths', 'Changed paths must not traverse or contain empty segments.');
  }
  return normalized;
}

function targetGates(target, gateById) {
  return [...target.fast_gates, ...target.contract_gates, ...target.slow_evidence_gates].map((gateId) => {
    const gate = gateById.get(gateId);
    return {
      id: gate.id,
      capabilities: [...gate.capabilities],
      enforcement: gate.enforcement,
      command: gate.command === null ? null : { executable: gate.command.executable, args: [...gate.command.args] },
      cwd: gate.cwd,
      evidence_class: gate.evidence_class,
      configured: gate.configured,
      not_configured_reason: gate.not_configured_reason,
    };
  });
}

export function createVerificationPlan(manifest, options = {}) {
  const { gateById } = validateVerificationManifest(manifest);
  const changedPaths = [...new Set((options.changedPaths ?? []).map(normalizeChangedPath))].sort((a, b) => a.localeCompare(b, 'en'));
  const defaultProfile = options.defaultProfile ?? null;
  const subjectSha = options.subjectSha ?? null;
  const baseSha = options.baseSha ?? null;
  if (subjectSha !== null && (typeof subjectSha !== 'string' || !COMMIT.test(subjectSha))) {
    fail('invalid_argument', 'subject_sha', 'Subject SHA must be a lowercase full commit id.');
  }
  if (baseSha !== null && (typeof baseSha !== 'string' || !COMMIT.test(baseSha))) {
    fail('invalid_argument', 'base_sha', 'Base SHA must be a lowercase full commit id.');
  }
  if (defaultProfile !== null && !PROFILES.has(defaultProfile)) {
    fail('profile_invalid', 'default_profile', 'The requested verification profile is unknown.');
  }
  if (defaultProfile !== null && (changedPaths.length > 0 || options.full === true)) {
    fail('invalid_argument', 'dispatch_mode', 'A default profile cannot be combined with changed paths or full dispatch.');
  }
  if (defaultProfile === null && changedPaths.length === 0 && options.full !== true) {
    fail('changed_path_required', 'changed_paths', 'At least one changed path or a default profile is required.');
  }
  const requestedFull = changedPaths.includes('__full__') || options.full === true;
  const concretePaths = changedPaths.filter((item) => item !== '__full__');
  const selfChange = concretePaths.some((filePath) => matchesAny(filePath, manifest.full_dispatch_globs));
  const full = requestedFull || selfChange;
  const classIds = new Set();
  const classified = new Set();
  for (const item of manifest.path_classes) {
    for (const filePath of concretePaths) {
      if (matchesAny(filePath, item.path_globs)) {
        classIds.add(item.id);
        classified.add(filePath);
      }
    }
  }
  for (const filePath of concretePaths) {
    if (matchesAny(filePath, manifest.known_non_code_globs)) classified.add(filePath);
  }
  const unknownPaths = full ? [] : concretePaths.filter((filePath) => !classified.has(filePath));
  const failClosed = unknownPaths.length > 0;
  const materialClasses = [...classIds].filter((id) => id !== 'tracked-repository');
  const docsOnly = concretePaths.length > 0 && materialClasses.length === 0 &&
    concretePaths.every((filePath) => matchesAny(filePath, manifest.known_non_code_globs));
  const targets = manifest.targets.map((target) => {
      let required;
      let reason;
      if (failClosed) {
        required = true;
        reason = 'unknown_path_fail_closed';
      } else if (full) {
        required = true;
        reason = requestedFull ? 'full_dispatch_requested' : 'full_dispatch_self_change';
      } else if (defaultProfile !== null) {
        required = target.default_profiles.includes(defaultProfile);
        reason = required ? 'profile_default' : 'profile_not_selected';
      } else {
        required = target.required_when.any_of.some((classId) => classIds.has(classId));
        reason = required ? 'affected_path' : (docsOnly ? 'docs_only' : target.skip_reason);
      }
      return {
        id: target.id,
        display_name: target.display_name,
        owner: target.owner,
        required,
        reason,
        ci_output: target.ci_output,
        ci_job: target.ci_job,
        result_artifact: target.result_artifact === null ? null : structuredClone(target.result_artifact),
        gates: targetGates(target, gateById),
      };
    });
  return {
    schema_version: 'verification-plan/v2',
    manifest_version: manifest.schema_version,
    base_sha: baseSha,
    subject_sha: subjectSha,
    result: failClosed ? 'fail_closed' : 'planned',
    dispatch: full ? 'full' : (defaultProfile === null ? 'affected' : 'profile'),
    changed_paths: changedPaths,
    unknown_paths: unknownPaths,
    targets,
    errors: [],
  };
}

function readJson(filePath, label) {
  const item = lstatSync(filePath);
  if (!item.isFile() || item.isSymbolicLink() || item.size > 2 * 1024 * 1024) {
    fail('input_untrusted', label, `${label} must be a bounded regular file.`);
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(filePath)));
  } catch {
    fail('input_invalid_json', label, `${label} is invalid JSON.`);
  }
}

function parseCli(argv) {
  const result = { paths: [], full: false };
  const valueFlags = new Map([
    ['--manifest', 'manifest'], ['--changed-paths-file', 'changedPathsFile'], ['--changed-paths0-file', 'changedPaths0File'], ['--path', 'path'],
    ['--default-profile', 'defaultProfile'], ['--base', 'baseSha'], ['--subject', 'subjectSha'], ['--json-out', 'jsonOut'], ['--github-output', 'githubOutput'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--full') {
      if (result.full) fail('invalid_argument', 'arguments', '--full was supplied twice.');
      result.full = true;
      continue;
    }
    const key = valueFlags.get(flag);
    const value = argv[index + 1];
    if (!key || value === undefined || value.startsWith('--')) fail('invalid_argument', 'arguments', `Invalid argument: ${flag}`);
    index += 1;
    if (key === 'path') result.paths.push(value);
    else if (result[key] !== undefined) fail('invalid_argument', 'arguments', `Duplicate argument: ${flag}`);
    else result[key] = value;
  }
  if (!result.manifest) result.manifest = path.resolve('scripts/verification-manifest.json');
  return result;
}

function errorEnvelope(error) {
  const known = error instanceof VerificationPlanError;
  return {
    schema_version: 'verification-plan/v2',
    manifest_version: 'unavailable',
    base_sha: null,
    subject_sha: null,
    result: 'input_error',
    dispatch: 'none',
    changed_paths: [],
    unknown_paths: [],
    targets: [],
    errors: [{
      code: known ? error.code : 'unexpected_failure',
      field: known ? error.field : 'input',
      message: known ? error.message : 'Verification plan input could not be processed safely.',
    }],
  };
}

function runCli() {
  try {
    const args = parseCli(process.argv.slice(2));
    const manifest = readJson(path.resolve(args.manifest), 'manifest');
    const changedPaths = [...args.paths];
    if (args.changedPathsFile && args.changedPaths0File) {
      fail('invalid_argument', 'arguments', 'Choose one changed-path file encoding.');
    }
    if (args.changedPathsFile) {
      const item = lstatSync(args.changedPathsFile);
      if (!item.isFile() || item.isSymbolicLink() || item.size > 1024 * 1024) {
        fail('input_untrusted', 'changed_paths_file', 'Changed-path file must be a bounded regular file.');
      }
      changedPaths.push(...new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(args.changedPathsFile))
        .split(/\r?\n/u).filter(Boolean));
    }
    if (args.changedPaths0File) {
      const item = lstatSync(args.changedPaths0File);
      if (!item.isFile() || item.isSymbolicLink() || item.size > 1024 * 1024) {
        fail('input_untrusted', 'changed_paths_file', 'Changed-path file must be a bounded regular file.');
      }
      const bytes = readFileSync(args.changedPaths0File);
      if (bytes.length > 0 && bytes[bytes.length - 1] !== 0) {
        fail('changed_path_invalid', 'changed_paths', 'NUL-delimited changed-path input must end with NUL.');
      }
      changedPaths.push(...new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\0').filter(Boolean));
    }
    const plan = createVerificationPlan(manifest, {
      changedPaths,
      defaultProfile: args.defaultProfile ?? null,
      baseSha: args.baseSha ?? null,
      subjectSha: args.subjectSha ?? null,
      full: args.full,
    });
    const json = `${JSON.stringify(plan)}\n`;
    const digest = createHash('sha256').update(json).digest('hex');
    if (args.jsonOut) writeFileSync(args.jsonOut, json, 'utf8');
    if (args.githubOutput) {
      const outputs = [`plan_result=${plan.result}`, `plan_sha256=${digest}`];
      const ciOutputs = new Map();
      for (const target of plan.targets) {
        if (target.ci_output) ciOutputs.set(target.ci_output, (ciOutputs.get(target.ci_output) ?? false) || target.required);
      }
      for (const [name, required] of [...ciOutputs].sort(([left], [right]) => left.localeCompare(right, 'en'))) {
        outputs.push(`${name}=${required}`);
      }
      appendFileSync(args.githubOutput, `${outputs.join('\n')}\n`, 'utf8');
    }
    process.stdout.write(json);
    process.exitCode = plan.result === 'planned' ? 0 : 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify(errorEnvelope(error))}\n`);
    process.exitCode = 3;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) runCli();
