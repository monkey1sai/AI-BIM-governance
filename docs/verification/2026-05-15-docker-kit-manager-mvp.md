# Docker Kit Manager MVP Verification - 2026-05-15

## Scope

Change id: `introduce-ai-bim-runtime-manager-docker-kit-mvp`

Worktree:

```txt
C:\Repos\active\iot\AI-BIM-governance\.worktrees\introduce-ai-bim-runtime-manager-docker-kit-mvp
```

The MVP path is Docker Compose first. Host-local Kit was not used as pass evidence.

## Results

| Check | Result | Evidence |
|---|---|---|
| OpenSpec strict validation | pass | `npx openspec validate introduce-ai-bim-runtime-manager-docker-kit-mvp --strict` |
| Compose config | pass | `docker compose -f compose.runtime-manager.yml --env-file .env.runtime-manager.docker config` |
| GPU profile config | pass | `docker compose -f compose.runtime-manager.yml --env-file .env.runtime-manager.docker --profile gpu config` includes `streaming-server` with NVIDIA GPU reservation |
| Kit Manager API compile | pass | `python -m compileall services\kit-manager-api\app` |
| Kit Manager Web image build | pass | `docker build -f infra/docker/kit-manager-web.Dockerfile --progress=plain -t ai-bim-kit-manager-web-test .` |
| Web viewer image build | pass | `docker build -f infra/docker/web-viewer-sample.Dockerfile --progress=plain -t ai-bim-web-viewer-sample-test .` |
| Core Docker profile start | pass | `.\scripts\start-runtime-manager-docker.ps1 -Build` |
| Core Docker health check | pass | `.\scripts\check-runtime-manager-docker.ps1` returned ok for `_bim-control`, `_worker`, coordinator, viewer, Kit Manager API, and Kit Manager Web |
| Kit Manager UI | pass | `npx playwright screenshot --wait-for-timeout=2000 http://127.0.0.1:5174 .tmp\kit-manager-5174.png` |
| `.usdc` discovery | pass | API listed `usdc_docker-kit-manager-smoke.usdc` from worktree `storage/` |
| Open selected in Kit | recorded blocked | API returned `status=blocked`, `control_status=blocked_runtime_control_unavailable` |
| Close instance | recorded blocked | API returned `status=blocked`, `control_status=blocked_runtime_control_unavailable` |
| GPU Kit runtime | blocked | Host GPU exists, but Linux Kit launcher is missing in the worktree |
| GitNexus detect changes | pass | `npx gitnexus detect-changes --repo <worktree> --scope all` reported risk `medium` and affected only Kit Manager open / close flows |

## Core Runtime Endpoint Evidence

`.\scripts\check-runtime-manager-docker.ps1`:

```txt
[ok] bim-control http://127.0.0.1:8001/health
[ok] worker http://127.0.0.1:8005/health
[ok] coordinator http://127.0.0.1:8004/health
[ok] viewer http://127.0.0.1:5173
[ok] kit-manager-api http://127.0.0.1:8010/health
[ok] kit-manager-web http://127.0.0.1:5174
```

Kit Manager API open / close smoke:

```txt
ArtifactId   : usdc_docker-kit-manager-smoke.usdc
OpenStatus   : blocked
OpenControl  : blocked_runtime_control_unavailable
CloseStatus  : blocked
CloseControl : blocked_runtime_control_unavailable
```

## GPU Runtime Blocker

Host GPU observation:

```txt
NVIDIA GeForce RTX 4060 Ti, 580.97
```

Linux Kit launcher check:

```txt
Test-Path bim-streaming-server\_build\linux-x86_64\release\ezplus.bim_review_stream_streaming.kit.sh
False
```

Because the Linux Kit launcher is missing, `.\scripts\start-runtime-manager-docker.ps1 -Build -WithGpu` was not used as pass evidence. The MVP records the Kit control path as blocked instead of falling back to host-local Kit.

## File Size Gate

Changed source and documentation files are under 500 lines:

```txt
README.md                                                                            198
compose.runtime-manager.yml                                                          140
docs/verification/2026-05-15-docker-kit-manager-mvp.md                                73
services/kit-manager-api/app/kit_service.py                                           62
openspec/changes/introduce-ai-bim-runtime-manager-docker-kit-mvp/specs/.../spec.md    32
apps/kit-manager-web/package.json                                                     22
openspec/changes/introduce-ai-bim-runtime-manager-docker-kit-mvp/tasks.md             14
storage/README.md                                                                      7
infra/docker/web-viewer-sample.Dockerfile                                              6
apps/kit-manager-web/src/vite-env.d.ts                                                 1
```

## Notes

- `storage/docker-kit-manager-smoke.usdc` was created only as local smoke data. It remains ignored by git.
- `.env.runtime-manager.docker` was copied from `.env.runtime-manager.docker.example` inside the worktree only. It is local runtime input and is not intended for commit.
- The first core Docker build exposed two contract issues that were fixed in this change: Kit Manager Web lacked React/Vite type declarations, and the viewer Docker build needed `web-viewer-sample/.npmrc` for NVIDIA package resolution.
- GitNexus MCP did not initially know this `.worktrees/` path, so the worktree was indexed with `npx gitnexus analyze .` before running detect changes.
