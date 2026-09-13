"""Negative fixture admission checks, including Python's optimized interpreter.

Uses a disposable linked-worktree-shaped directory and a loopback coordinator
double. No IFC, real service, existing policy, or repository state is modified.
"""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class FixtureAdmissionTest(unittest.TestCase):
    def test_invalid_evidence_never_publishes_fixture_or_policy(self):
        scenarios = {
            "status": "rule run did not succeed",
            "digest": "rule run source digest mismatch",
            "tenant": "rule run tenant mismatch",
            "failed_count": "expected original 68 FAIL and revised 0 FAIL",
            "created_count": "expected 68 created issues",
            "final_digest": "IFC digest changed before policy publication",
        }
        for optimized in (False, True):
            for scenario, message in scenarios.items():
                with self.subTest(optimized=optimized, scenario=scenario), tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    (root / '.git').write_text('gitdir: test-only')
                    script = root / 'web-viewer-sample/e2e/support/prepare-a1-delivery.py'
                    script.parent.mkdir(parents=True)
                    shutil.copyfile(Path(__file__).with_name(script.name), script)
                    run = root / 'artifacts/e2e/a1-delivery/guard-test'
                    run.mkdir(parents=True)
                    original = root / 'original.ifc'
                    original.write_bytes(b'not an IFC; negative admission only')
                    fixture = {'original_sha256': 'original-digest', 'revised_sha256': 'revised-digest',
                               'original_file': str(original), 'revised_file': str(original),
                               'revised_model_version_id': 'revised-test'}
                    fixture_path = run / 'library-fixture.json'
                    policy_path = run / 'owner-remediation-policy.json'
                    fixture_path.write_text(json.dumps(fixture))
                    policy_path.write_text(json.dumps({'version': 1, 'expires_at_ms': 0, 'cases': []}))
                    before = (fixture_path.read_bytes(), policy_path.read_bytes())

                    class Handler(BaseHTTPRequestHandler):
                        def log_message(self, *args):
                            pass

                        def do_POST(self):
                            self.rfile.read(int(self.headers.get('Content-Length', '0')))
                            if '/issues/from-rule-run/' in self.path:
                                body = {'created': 67 if scenario == 'created_count' else 68,
                                        'issue_ids': [f'issue-{i}' for i in range(68)]}
                            else:
                                body = {'rule_run_id': 'revised' if self.path.endswith('_revised') else 'original'}
                            self.respond(body)

                        def do_GET(self):
                            if '/issues/' in self.path:
                                self.respond({'issue': {'ifc_guid': 'test-guid'}})
                                return
                            label = self.path.rsplit('/', 1)[1]
                            self.respond({'status': 'failed' if scenario == 'status' else 'succeeded',
                                          'summary': {'source_sha256': 'wrong' if scenario == 'digest' else fixture[label + '_sha256'],
                                                      'failed': 1 if scenario == 'failed_count' else (68 if label == 'original' else 0)},
                                          'source_metadata': {'tenant_id': 'wrong' if scenario == 'tenant' else 'tenant_library_validation'}})

                        def respond(self, body):
                            self.send_response(200)
                            self.send_header('Content-Type', 'application/json')
                            self.end_headers()
                            self.wfile.write(json.dumps(body).encode())

                    server = None
                    for port in range(8005, 8010):
                        try:
                            server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
                            break
                        except OSError:
                            continue
                    self.assertIsNotNone(server, 'no free fixture-allowed loopback port')
                    thread = threading.Thread(target=server.serve_forever, daemon=True)
                    thread.start()
                    try:
                        (run / 'stack-manifest.json').write_text(json.dumps({
                            'worktree_root': str(root), 'stack_kind': 'isolated_branch_stack',
                            'base_urls': {'coordinator': f'http://127.0.0.1:{server.server_port}'}, 'head_sha': 'test-only'}))
                        result = subprocess.run([sys.executable, *(['-O'] if optimized else []), str(script),
                                                 'run', str(root), 'guard-test', '--original', str(original)],
                                                capture_output=True, text=True, timeout=20)
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn(message, result.stderr)
                        self.assertEqual((fixture_path.read_bytes(), policy_path.read_bytes()), before)
                    finally:
                        server.shutdown()
                        server.server_close()
                        thread.join()


if __name__ == '__main__':
    unittest.main()
