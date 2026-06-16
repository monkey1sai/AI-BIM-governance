# Tasks: stop-all-single-pid-cleanup

## 1. Fix

- [x] 1.1 Wrap `Get-ChildItem` pid enumeration in `@(...)`.
- [x] 1.2 Add focused single-pid regression test.

## 2. Validation

- [x] 2.1 PowerShell parser check.
- [x] 2.2 `scripts/tests/test-stop-all-single-pid.ps1`.
- [x] 2.3 `npx openspec validate stop-all-single-pid-cleanup --strict`.
- [ ] 2.4 PR review checks pass.
