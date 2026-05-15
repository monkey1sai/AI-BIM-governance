# README update instruction

Replace the README primary startup section with Docker-first commands:

```powershell
Copy-Item .env.runtime-manager.docker.example .env.runtime-manager.docker
.\scripts\start-runtime-manager-docker.ps1 -Build
.\scripts\check-runtime-manager-docker.ps1

# GPU Kit runtime
.\scripts\start-runtime-manager-docker.ps1 -Build -WithGpu
.\scripts\check-runtime-manager-docker.ps1 -WithGpu
```

Move host-local commands to a `Legacy / debug only` section. Do not remove them
until Docker smoke passes and reviewers approve the transition.
