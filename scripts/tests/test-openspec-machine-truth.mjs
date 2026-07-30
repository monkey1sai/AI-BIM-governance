import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectSourceObservations } from './verify-openspec-machine-truth.mjs';
import {
  MachineTruthInputError,
  evaluateOpenSpecMachineTruth,
} from '../lib/openspec-machine-truth.mjs';

const SUBJECT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const RECONCILED_SOURCE_IDS = [
  'a4-console-convergence',
  'a4-semantic-search-model-qa',
  'isolated-branch-stack-browser-e2e',
  'minio-folderview-and-baseline-disclosure',
];

function write(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, 'utf8');
}

function projection(ledger) {
  return {
    schema_version: 'openspec-now-view/v1',
    scope: 'current',
    changes: ledger.changes.filter(({ status }) => status !== 'archived').map(({ id, status }) => ({ id, status })),
  };
}

function githubProjection(ledger) {
  return {
    schema_version: 'openspec-github-lifecycle-state/v1',
    scope: 'current',
    repository_subject: SUBJECT,
    changes: ledger.changes.filter(({ status }) => status !== 'archived').map(({ id }) => ({ id, prs: [] })),
  };
}

function openSpecProjection(ledger) {
  return {
    changes: ledger.changes
      .filter(({ status }) => status !== 'archived')
      .map(({ id, status, task_ledger: tasks }) => ({
        name: id,
        status: status === 'completed' ? 'complete' : 'in-progress',
        completedTasks: tasks.completed,
        totalTasks: tasks.total,
      })),
  };
}

function machineChange(id, status = 'active', completed = 1, total = 2) {
  return {
    id,
    status,
    owner: 'fixture-owner',
    current_slice: status === 'active' ? 'fixture slice' : null,
    blocked_by: [],
    last_verified: '2026-07-28T00:00:00Z',
    task_ledger: { completed, total },
    evidence_refs: [
      `openspec/changes/${id}/proposal.md`,
      `openspec/changes/${id}/tasks.md`,
    ],
    subject_commit: SUBJECT,
    archive_debt: null,
  };
}

function makeWorkspace(changes = [machineChange('alpha')]) {
  const tempRoot = process.env.AI_BIM_TEST_TEMP_ROOT || tmpdir();
  mkdirSync(tempRoot, { recursive: true });
  const repoRoot = mkdtempSync(path.join(tempRoot, 'openspec-machine-truth-'));
  mkdirSync(path.join(repoRoot, 'openspec', 'changes', 'archive'), { recursive: true });
  const ledger = { schema_version: 'openspec-lifecycle-ledger/v1', changes };
  for (const change of changes) {
    if (change.status === 'archived') continue;
    const directory = path.join(repoRoot, 'openspec', 'changes', change.id);
    const proposal = change.status === 'deferred'
      ? '> **Status: deferred 2026-07-28** — thaw when fixture is ready.\n\n# Fixture\n'
      : change.status === 'held'
        ? '> **Status: held 2026-07-28** — bounded hold.\n\n# Fixture\n'
        : change.status === 'completed'
          ? '> **Status: completed 2026-07-28** — ready to archive.\n\n# Fixture\n'
          : '# Fixture\n';
    const tasks = [
      ...Array.from({ length: change.task_ledger.completed }, () => '- [x] done'),
      ...Array.from({ length: change.task_ledger.total - change.task_ledger.completed }, () => '- [ ] todo'),
    ].join('\n');
    write(path.join(directory, 'proposal.md'), proposal);
    write(path.join(directory, 'tasks.md'), `${tasks}\n`);
  }
  return {
    repoRoot,
    ledger,
    nowText: `<!-- lifecycle-ledger:start -->\n\`\`\`json\n${JSON.stringify(projection(ledger))}\n\`\`\`\n<!-- lifecycle-ledger:end -->`,
    githubState: githubProjection(ledger),
    openSpecList: openSpecProjection(ledger),
    previousLedger: null,
    subjectCommit: SUBJECT,
  };
}

function withWorkspace(callback, changes) {
  const input = makeWorkspace(changes);
  try {
    return callback(input);
  } finally {
    rmSync(input.repoRoot, { recursive: true, force: true });
  }
}

test('consistent active and deferred lifecycle sources produce a stable report', () => {
  withWorkspace((input) => {
    const deferred = machineChange('beta', 'deferred', 0, 1);
    input.ledger.changes.push(deferred);
    const directory = path.join(input.repoRoot, 'openspec', 'changes', 'beta');
    write(path.join(directory, 'proposal.md'), '> **Status: deferred 2026-07-28** — thaw on approval.\n');
    write(path.join(directory, 'tasks.md'), '- [ ] todo\n');
    input.nowText = `<!-- lifecycle-ledger:start -->\n\`\`\`json\n${JSON.stringify(projection(input.ledger))}\n\`\`\`\n<!-- lifecycle-ledger:end -->`;
    input.githubState = githubProjection(input.ledger);
    input.openSpecList = openSpecProjection(input.ledger);
    const first = evaluateOpenSpecMachineTruth(input);
    const second = evaluateOpenSpecMachineTruth(input);
    assert.equal(first.result, 'consistent');
    assert.equal(first.summary.change_count, 2);
    assert.deepEqual(first, second);
  });
});

test('missing owner and unknown lifecycle fail schema validation', () => {
  withWorkspace((input) => {
    delete input.ledger.changes[0].owner;
    assert.throws(() => evaluateOpenSpecMachineTruth(input), MachineTruthInputError);
  });
  withWorkspace((input) => {
    input.ledger.changes[0].status = 'mystery';
    assert.throws(() => evaluateOpenSpecMachineTruth(input), MachineTruthInputError);
  });
});

test('blocked_by cycle and missing blocker are exact mismatches', () => {
  const alpha = machineChange('alpha');
  const beta = machineChange('beta');
  alpha.blocked_by = ['beta'];
  beta.blocked_by = ['alpha', 'missing'];
  withWorkspace((input) => {
    const report = evaluateOpenSpecMachineTruth(input);
    assert.equal(report.result, 'mismatch');
    assert.ok(report.mismatches.some(({ reason }) => reason === 'cycle_detected'));
    assert.ok(report.mismatches.some(({ reason, actual }) => reason === 'blocker_missing' && actual === 'missing'));
  }, [alpha, beta]);
});

test('trusted subject binds ledger and GitHub snapshot without conflating a PR head', () => {
  withWorkspace((input) => {
    input.ledger.changes[0].subject_commit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    input.sourceObservations = [{
      change_id: 'alpha',
      subject_commit: input.ledger.changes[0].subject_commit,
      changed_paths: [],
    }];
    input.githubState.changes[0].prs.push({
      number: 42,
      state: 'open',
      head_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    const report = evaluateOpenSpecMachineTruth(input);
    assert.ok(!report.mismatches.some(({ field }) => field === 'subject_commit'));
    assert.ok(!report.mismatches.some(({ field }) => field === 'github.prs.head_sha'));

    input.githubState.repository_subject = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const staleGitHub = evaluateOpenSpecMachineTruth(input);
    assert.ok(staleGitHub.mismatches.some(({ reason, field }) => reason === 'subject_mismatch' && field === 'github.repository_subject'));
  });
});

test('row source observations permit historical snapshots and attribute drift only to the owning row', () => {
  const alpha = machineChange('alpha');
  const beta = machineChange('beta');
  alpha.subject_commit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  beta.subject_commit = 'cccccccccccccccccccccccccccccccccccccccc';
  withWorkspace((input) => {
    input.sourceObservations = [
      { change_id: 'alpha', subject_commit: alpha.subject_commit, changed_paths: ['openspec/changes/beta/proposal.md'] },
      { change_id: 'beta', subject_commit: beta.subject_commit, changed_paths: [] },
    ];
    const accepted = evaluateOpenSpecMachineTruth(input);
    assert.equal(accepted.result, 'consistent');
    assert.equal(input.githubState.repository_subject, SUBJECT);

    input.sourceObservations[0].changed_paths = ['openspec/changes/alpha/proposal.md'];
    const drifted = evaluateOpenSpecMachineTruth(input);
    assert.ok(drifted.mismatches.some(({ change_id: id, reason }) => id === 'alpha' && reason === 'source_changed_since_subject'));
    assert.ok(!drifted.mismatches.some(({ change_id: id, reason }) => id === 'beta' && reason === 'source_changed_since_subject'));
  }, [alpha, beta]);
});

test('current ledger keeps reconciled source snapshots clean', () => {
  const ledger = JSON.parse(readFileSync(path.join(process.cwd(), 'openspec/lifecycle-ledger.json'), 'utf8'));
  const observed = collectSourceObservations(process.cwd(), ledger).sourceObservations
    .filter(({ change_id: id }) => RECONCILED_SOURCE_IDS.includes(id));

  assert.deepEqual(observed.map(({ change_id: id }) => id), RECONCILED_SOURCE_IDS);
  assert.deepEqual(observed.map(({ changed_paths: paths }) => paths), [[], [], [], []]);
});

test('row source observations fail closed on missing, duplicate, or mismatched identity', () => {
  const alpha = machineChange('alpha');
  const beta = machineChange('beta');
  withWorkspace((input) => {
    input.sourceObservations = [{ change_id: 'alpha', subject_commit: SUBJECT, changed_paths: [] }];
    assert.throws(() => evaluateOpenSpecMachineTruth(input), MachineTruthInputError);

    input.sourceObservations = [
      { change_id: 'alpha', subject_commit: SUBJECT, changed_paths: [] },
      { change_id: 'alpha', subject_commit: SUBJECT, changed_paths: [] },
    ];
    assert.throws(() => evaluateOpenSpecMachineTruth(input), MachineTruthInputError);

    input.sourceObservations = [
      { change_id: 'alpha', subject_commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', changed_paths: [] },
      { change_id: 'beta', subject_commit: SUBJECT, changed_paths: [] },
    ];
    assert.throws(() => evaluateOpenSpecMachineTruth(input), MachineTruthInputError);
  }, [alpha, beta]);
});

test('evidence refs require canonical forward-slash paths and exact tracked spelling', () => {
  withWorkspace((input) => {
    input.ledger.changes[0].evidence_refs.push('docs/evidence/./shared.json');
    assert.throws(() => evaluateOpenSpecMachineTruth(input), MachineTruthInputError);

    input.ledger.changes[0].evidence_refs.pop();
    input.ledger.changes[0].evidence_refs.push('docs/evidence/shared.json');
    write(path.join(input.repoRoot, 'docs/evidence/shared.json'), '{}\n');
    input.trackedEvidencePaths = [
      'openspec/changes/alpha/proposal.md',
      'openspec/changes/alpha/tasks.md',
      'docs/evidence/Shared.json',
    ];
    assert.throws(() => evaluateOpenSpecMachineTruth(input), MachineTruthInputError);
  });
});

test('shared evidence drift is attributed only to rows whose snapshot observed that path', () => {
  const alpha = machineChange('alpha');
  const beta = machineChange('beta');
  withWorkspace((input) => {
    write(path.join(input.repoRoot, 'docs/evidence/shared.json'), '{}\n');
    for (const change of input.ledger.changes) change.evidence_refs.push('docs/evidence/shared.json');
    input.sourceObservations = [
      { change_id: 'alpha', subject_commit: SUBJECT, changed_paths: ['docs/evidence/shared.json'] },
      { change_id: 'beta', subject_commit: SUBJECT, changed_paths: [] },
    ];
    const report = evaluateOpenSpecMachineTruth(input);
    assert.ok(report.mismatches.some(({ change_id: id, reason }) => id === 'alpha' && reason === 'evidence_changed_since_subject'));
    assert.ok(!report.mismatches.some(({ change_id: id, reason }) => id === 'beta' && reason === 'evidence_changed_since_subject'));
  }, [alpha, beta]);
});

test('source observation path budgets fail closed for structured and legacy input', () => {
  withWorkspace((input) => {
    input.sourceChangedPaths = Array.from({ length: 10_001 }, (_, index) => `docs/evidence/${index}.json`);
    assert.throws(() => evaluateOpenSpecMachineTruth(input), MachineTruthInputError);

    input.sourceChangedPaths = [];
    input.sourceObservations = [{
      change_id: 'alpha', subject_commit: SUBJECT,
      changed_paths: Array.from({ length: 10_001 }, (_, index) => `docs/evidence/${index}.json`),
    }];
    assert.throws(() => evaluateOpenSpecMachineTruth(input), MachineTruthInputError);

    input.sourceObservations = [{
      change_id: 'alpha', subject_commit: SUBJECT,
      changed_paths: Array.from({ length: 2_050 }, (_, index) => `docs/evidence/${index}-${'a'.repeat(1_000)}.json`),
    }];
    assert.throws(() => evaluateOpenSpecMachineTruth(input), MachineTruthInputError);
  });
});

test('mismatch output is bounded at 10,000 records and fails closed at 10,001', () => {
  const changes = Array.from({ length: 51 }, (_, index) => machineChange(`bounded-${index}`, 'held'));
  withWorkspace((input) => {
    for (const [index, change] of input.ledger.changes.entries()) {
      const missing = index < 50 ? 198 : 100;
      change.evidence_refs = [
        `openspec/changes/${change.id}/proposal.md`,
        `openspec/changes/${change.id}/tasks.md`,
        ...Array.from({ length: missing }, (_, item) => `docs/evidence/${change.id}-${item}.json`),
      ];
    }
    const bounded = evaluateOpenSpecMachineTruth(input);
    assert.equal(bounded.mismatches.length, 10_000);

    input.ledger.changes[50].evidence_refs.push('docs/evidence/overflow.json');
    assert.throws(() => evaluateOpenSpecMachineTruth(input), MachineTruthInputError);
  }, changes);
});

test('invalid terminal transition and removed history fail closed', () => {
  withWorkspace((input) => {
    const before = structuredClone(input.ledger);
    before.changes[0].status = 'archived';
    before.changes.push(machineChange('removed', 'active'));
    input.previousLedger = before;
    const report = evaluateOpenSpecMachineTruth(input);
    assert.ok(report.mismatches.some(({ reason }) => reason === 'transition_invalid'));
    assert.ok(report.mismatches.some(({ reason, change_id: id }) => reason === 'change_removed' && id === 'removed'));
  });
});

test('NOW, proposal, task and GitHub coverage divergence identify exact source fields', () => {
  withWorkspace((input) => {
    input.nowText = input.nowText.replace('"status":"active"', '"status":"deferred"');
    input.githubState.changes = [];
    write(path.join(input.repoRoot, 'openspec', 'changes', 'alpha', 'proposal.md'),
      '> **Status: deferred 2026-07-28** — thaw on approval.\n');
    write(path.join(input.repoRoot, 'openspec', 'changes', 'alpha', 'tasks.md'), '- [ ] todo\n- [ ] todo\n');
    const report = evaluateOpenSpecMachineTruth(input);
    assert.ok(report.mismatches.some(({ code, field }) => code === 'projection' && field === 'now.status'));
    assert.ok(report.mismatches.some(({ code, field }) => code === 'github' && field === 'github.changes'));
    assert.ok(report.mismatches.some(({ code, field }) => code === 'lifecycle' && field === 'proposal.status'));
    assert.ok(report.mismatches.some(({ code, field }) => code === 'task_ledger' && field === 'task_ledger.completed'));
  });
});

test('WIP budget and missing evidence are reported without inferring activity from checkboxes', () => {
  const changes = Array.from({ length: 7 }, (_, index) => machineChange(`change-${index + 1}`, 'active', 0, 1));
  withWorkspace((input) => {
    input.ledger.changes[0].evidence_refs.push('openspec/changes/change-1/missing.txt');
    const report = evaluateOpenSpecMachineTruth(input);
    assert.ok(report.mismatches.some(({ reason }) => reason === 'budget_exceeded'));
    assert.ok(report.mismatches.some(({ reason }) => reason === 'evidence_target_missing'));
  }, changes);
});

test('repository escape in evidence is an input error', () => {
  withWorkspace((input) => {
    input.ledger.changes[0].evidence_refs.push('../outside.txt');
    assert.throws(() => evaluateOpenSpecMachineTruth(input), (error) =>
      error instanceof MachineTruthInputError && error.code === 'artifact_untrusted');
  });
});

test('archived entries require archive location and completed tasks', () => {
  const archived = machineChange('alpha', 'archived', 0, 1);
  archived.evidence_refs = [
    'openspec/changes/archive/2026-07-28-alpha/proposal.md',
    'openspec/changes/archive/2026-07-28-alpha/tasks.md',
  ];
  withWorkspace((input) => {
    const directory = path.join(input.repoRoot, 'openspec', 'changes', 'archive', '2026-07-28-alpha');
    write(path.join(directory, 'proposal.md'), '> **Status: adopted 2026-07-28** — completed.\n');
    write(path.join(directory, 'tasks.md'), '- [ ] unfinished\n');
    const report = evaluateOpenSpecMachineTruth(input);
    assert.ok(report.mismatches.some(({ reason }) => reason === 'archive_incomplete'));
  }, [archived]);
});

test('typed historical archive debt requires trusted-subject provenance', () => {
  const archived = machineChange('alpha', 'archived', 0, 1);
  archived.archive_debt = {
    reason: 'historical_task_ledger_debt',
    unchecked_tasks: 1,
    unsupported_checkboxes: 0,
    owner: 'repository-maintainer',
    review_due: '2026-08-31',
  };
  archived.evidence_refs = [
    'openspec/changes/archive/2026-07-28-alpha/proposal.md',
    'openspec/changes/archive/2026-07-28-alpha/tasks.md',
  ];
  withWorkspace((input) => {
    const directory = path.join(input.repoRoot, 'openspec', 'changes', 'archive', '2026-07-28-alpha');
    write(path.join(directory, 'proposal.md'), '> **Status: adopted 2026-07-28** — completed.\n');
    write(path.join(directory, 'tasks.md'), '- [ ] historical debt\n');
    const unproven = evaluateOpenSpecMachineTruth(input);
    assert.ok(unproven.mismatches.some(({ reason }) => reason === 'archive_debt_unproven'));

    input.baselineArchiveTasks = { alpha: { completed: 0, total: 1, unsupported: 0 } };
    const report = evaluateOpenSpecMachineTruth(input);
    assert.equal(report.result, 'consistent_with_accepted_debt');
    assert.equal(report.summary.archive_debt_count, 1);
  }, [archived]);
});

test('typed archive debt may be inherited unchanged from a previous archived ledger row', () => {
  const archived = machineChange('alpha', 'archived', 0, 1);
  archived.archive_debt = {
    reason: 'historical_task_ledger_debt',
    unchecked_tasks: 1,
    unsupported_checkboxes: 0,
    owner: 'repository-maintainer',
    review_due: '2026-08-31',
  };
  archived.evidence_refs = [
    'openspec/changes/archive/2026-07-28-alpha/proposal.md',
    'openspec/changes/archive/2026-07-28-alpha/tasks.md',
  ];
  withWorkspace((input) => {
    const directory = path.join(input.repoRoot, 'openspec', 'changes', 'archive', '2026-07-28-alpha');
    write(path.join(directory, 'proposal.md'), '> **Status: adopted 2026-07-28** — completed.\n');
    write(path.join(directory, 'tasks.md'), '- [ ] historical debt\n');
    input.previousLedger = structuredClone(input.ledger);
    const report = evaluateOpenSpecMachineTruth(input);
    assert.equal(report.result, 'consistent_with_accepted_debt');
    assert.equal(report.summary.archive_debt_count, 1);
  }, [archived]);
});

test('every archive identity is tracked once in the ledger', () => {
  withWorkspace((input) => {
    const first = path.join(input.repoRoot, 'openspec', 'changes', 'archive', '2026-07-28-orphan');
    const second = path.join(input.repoRoot, 'openspec', 'changes', 'archive', '2026-07-29-orphan');
    for (const directory of [first, second]) {
      write(path.join(directory, 'proposal.md'), '> **Status: adopted 2026-07-28** — complete.\n');
      write(path.join(directory, 'tasks.md'), '- [x] done\n');
    }
    const report = evaluateOpenSpecMachineTruth(input);
    assert.ok(report.mismatches.some(({ reason }) => reason === 'archive_entry_untracked'));
    assert.ok(report.mismatches.some(({ reason }) => reason === 'archive_identity_duplicate'));
  });
});

test('source and evidence changes after the observed subject fail closed', () => {
  withWorkspace((input) => {
    input.sourceChangedPaths = ['openspec/changes/alpha/proposal.md'];
    const report = evaluateOpenSpecMachineTruth(input);
    assert.ok(report.mismatches.some(({ reason }) => reason === 'source_changed_since_subject'));
    assert.ok(report.mismatches.some(({ reason }) => reason === 'evidence_changed_since_subject'));
  });
});

test('raw GitHub PR observations reject ambiguous mappings but not unrelated PR heads', () => {
  const alpha = machineChange('alpha');
  const beta = machineChange('beta');
  withWorkspace((input) => {
    const observedPr = { number: 7, state: 'open', head_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' };
    input.githubState.changes[0].prs.push(observedPr);
    input.githubState.changes[1].prs.push(observedPr);
    const report = evaluateOpenSpecMachineTruth(input);
    assert.ok(report.mismatches.some(({ reason }) => reason === 'pr_duplicate'));
    assert.ok(!report.mismatches.some(({ field }) => field === 'github.prs.head_sha'));
  }, [alpha, beta]);
});

test('linked repository source directories are rejected', (context) => {
  withWorkspace((input) => {
    const original = path.join(input.repoRoot, 'openspec', 'changes', 'alpha');
    const target = path.join(input.repoRoot, 'linked-alpha-target');
    renameSync(original, target);
    try {
      symlinkSync(target, original, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (error.code === 'EPERM') {
        context.skip('junction creation is unavailable');
        return;
      }
      throw error;
    }
    assert.throws(() => evaluateOpenSpecMachineTruth(input), (error) =>
      error instanceof MachineTruthInputError && error.code === 'artifact_untrusted');
  });
});
