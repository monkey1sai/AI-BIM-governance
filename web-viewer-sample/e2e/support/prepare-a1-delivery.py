"""Owner-authorized isolated fixtures; no MinIO, deployment or original IFC writes."""
import argparse, hashlib, json, shutil, time, urllib.request
from pathlib import Path
from datetime import datetime, timezone

SHA = '8fe7efdbbf56d42b8a6b73c4a580e1f3d6a364afec7aa903a852a7ef2759ddce'
VERSION = '24e598ab-be3d-4dbb-a1aa-60b0ba610618'
p = argparse.ArgumentParser(); p.add_argument('phase', choices=['prepare', 'run']); p.add_argument('root'); p.add_argument('run_id'); p.add_argument('--original', required=True)
a = p.parse_args(); ORIGINAL = Path(a.original).resolve(); root = Path(a.root).resolve(); run = root / 'artifacts/e2e/a1-delivery' / a.run_id
assert root.name == 'codex-a1-delivery-regression' and a.run_id.replace('-', '').isalnum()
run.mkdir(parents=True, exist_ok=True)
fixture_file = run / 'library-fixture.json'
def sha(path): return hashlib.file_digest(path.open('rb'), 'sha256').hexdigest()
def write(path, value): path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
if a.phase == 'prepare':
    import ifcopenshell
    import ifcopenshell.api.pset.add_pset
    import ifcopenshell.api.pset.edit_pset
    assert not fixture_file.exists() and not (run / 'stack-manifest.json').exists()
    assert sha(ORIGINAL) == SHA
    sources = run / 'state/coordinator/storage'
    sources.mkdir(parents=True, exist_ok=False)
    original, revised = sources / 'original.ifc', sources / 'revised-validation-only.ifc'
    shutil.copyfile(ORIGINAL, original)
    library = root / 'storage/library-validation/architecture'
    library.mkdir(parents=True, exist_ok=True)
    assert not (library / 'original.ifc').exists()
    shutil.copyfile(ORIGINAL, library / 'original.ifc')
    model = ifcopenshell.open(str(original))
    original_guids = sorted(e.GlobalId for e in model.by_type('IfcElement'))
    doors = model.by_type('IfcDoor')
    for door in doors:
        pset = ifcopenshell.api.pset.add_pset(model, product=door, name='Pset_DoorCommon')
        ifcopenshell.api.pset.edit_pset(model, pset=pset, properties={'FireRating': 'VALIDATION_ONLY_NOT_CERTIFIED'})
    model.write(str(revised))
    shutil.copyfile(revised, library / 'revised-validation-only.ifc')
    assert sorted(e.GlobalId for e in model.by_type('IfcElement')) == original_guids
    assert sha(ORIGINAL) == SHA and sha(original) == SHA
    revised_sha = sha(revised); now = datetime.now(timezone.utc).isoformat()
    jobs = []
    for label, path, version, digest in [('original', original, VERSION, SHA), ('revised', revised, 'slice12-library-revised-v1', revised_sha)]:
        jobs.append({'ifc_ready_job_id': 'ifcready_slice12_' + label, 'status': 'accepted', 'idempotent_replay': False,
            'correlation_id': 'slice12-' + label, 'idempotency_key': 'slice12-' + label, 'intake_source': 'external',
            'tenant_id': 'tenant_library_validation', 'project_id': 'project_library_validation',
            'project_display_name': '許良宇圖書館－隔離整改驗證', 'category': 'architecture',
            'external_model_version_id': version, 'source_ifc_ref': 'local-validation-fixture:' + label,
            'source_ifc_etag': digest, 'conversion_job_id': None, 'conversion_status': None,
            'conversion_authority': None, 'download_status': 'downloaded', 'host_local_path': str(path),
            'local_path': str(path), 'created_at': now, 'updated_at': now})
    state = run / 'state/coordinator'; state.mkdir(parents=True, exist_ok=True)
    assert not (state / 'external-ifc-ready.json').exists()
    write(state / 'external-ifc-ready.json', {'jobs': jobs})
    write(fixture_file, {'fixture_kind': 'owner-seeded-local-derived-ifc', 'original_sha256': SHA,
        'revised_sha256': revised_sha, 'original_model_version_id': VERSION, 'revised_model_version_id': 'slice12-library-revised-v1',
        'original_file': str(original), 'revised_file': str(revised), 'doors_updated': len(doors), 'element_guid_count': len(original_guids),
        'local_original_key': 'library-validation/architecture/original.ifc', 'local_revised_key': 'library-validation/architecture/revised-validation-only.ifc',
        'purpose': 'Verify property-required FAIL to PASS, explicit human confirmation, history and reopen. FireRating is a validation marker, not certification. No original IFC, MinIO, conversion or Kit mutation.'})
    write(run / 'owner-remediation-policy.json', {'version': 1, 'expires_at_ms': 0, 'cases': []})
    print(json.dumps({'phase': 'prepared', 'original_sha256': SHA, 'revised_sha256': revised_sha, 'doors_updated': len(doors), 'element_guids_preserved': len(original_guids)}))
else:
    manifest = json.loads((run / 'stack-manifest.json').read_text(encoding='utf-8-sig'))
    assert manifest['worktree_root'].lower() == str(root).lower() and manifest['stack_kind'] == 'isolated_branch_stack'
    base = manifest['base_urls']['coordinator']; assert base in [f'http://127.0.0.1:{n}' for n in range(8005, 8010)]
    fixture = json.loads(fixture_file.read_text(encoding='utf-8')); assert 'original_run_id' not in fixture
    def api(path, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(base + '/api/governance/' + path, data=data, headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req, timeout=120) as response: return json.load(response)
    summaries = {}
    for label in ['original', 'revised']:
        result = api('rule-runs/for-ifc-ready/ifcready_slice12_' + label, {'rule_set': 'default-governance'})
        run_id = result['rule_run_id']; deadline = time.time() + 120
        while time.time() < deadline:
            record = api('rule-runs/' + run_id)
            if record['status'] not in ['queued', 'running']: break
            time.sleep(0.4)
        assert record['status'] == 'succeeded', record
        assert record['summary']['source_sha256'] == fixture[label + '_sha256']
        assert record['source_metadata']['tenant_id'] == 'tenant_library_validation'
        fixture[label + '_run_id'] = run_id; summaries[label] = record['summary']
    assert summaries['original']['failed'] == 68 and summaries['revised']['failed'] == 0
    created = api('issues/from-rule-run/' + fixture['original_run_id'], {})
    assert created['created'] == 68
    cases = []
    for index, issue_id in enumerate(created['issue_ids']):
        issue = api('issues/' + issue_id)['issue']
        if index < 2:
            prefix = 'e2e' if index == 0 else 'iab'
            fixture[prefix + '_issue_id'] = issue_id; fixture[prefix + '_guid'] = issue['ifc_guid']
        cases.append({'issue_id': issue_id, 'tenant_id': 'tenant_library_validation', 'project_id': 'project_library_validation',
            'ifc_guid': issue['ifc_guid'], 'rule_code': 'DOOR-FIRERATING-REQUIRED',
            'original': {'model_version_id': VERSION, 'run_id': fixture['original_run_id'], 'source_sha256': SHA},
            'revised': {'model_version_id': fixture['revised_model_version_id'], 'run_id': fixture['revised_run_id'], 'source_sha256': fixture['revised_sha256']},
            'operations': ['history','confirm','reopen']})
    assert sha(ORIGINAL) == SHA and sha(Path(fixture['original_file'])) == SHA and sha(Path(fixture['revised_file'])) == fixture['revised_sha256']
    write(run / 'owner-remediation-policy.json', {'version': 1, 'expires_at_ms': int(time.time()*1000) + 8*3600*1000, 'cases': cases})
    fixture['summaries'] = summaries; fixture['head_sha'] = manifest['head_sha']; write(fixture_file, fixture)
    print(json.dumps(fixture, ensure_ascii=True))
