# Tasks

- [ ] Add Docker Compose runtime file.
- [ ] Add Dockerfiles for Python, Node, Kit Manager API/Web, and GPU streaming scaffold.
- [ ] Add Kit Manager API service.
- [ ] Add Kit Manager Web frontend.
- [ ] Add scripts for start / stop / health check.
- [ ] Add Docker-first runbook and architecture docs.
- [ ] Update README primary path to Docker-first runtime.
- [ ] Mark host-local runtime as legacy/debug.
- [ ] Validate OpenSpec: `npx openspec validate introduce-ai-bim-runtime-manager-docker-kit-mvp --strict`.
- [ ] Validate Compose: `docker compose -f compose.runtime-manager.yml --env-file .env.runtime-manager.docker config`.
- [ ] Run core profile.
- [ ] Run GPU profile or record blocked evidence if Linux Kit launcher / GPU runtime is missing.
- [ ] Confirm all changed files are under 500 lines.
