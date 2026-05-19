# Demo Runtime Storage Folder

Put local demo `.ifc` files directly in this folder when running the B-scheme
intake smoke (`scripts/smoke-bscheme-intake.ps1`).
Put local demo `.usdc` files in this folder when running the Docker-first Kit
Manager MVP at `http://127.0.0.1:5174`.

The smoke reads the current repo's `storage/*.ifc` by default. A different
fixture root can be passed explicitly with `-StorageRoot`.

Large BIM files remain ignored by git; do not commit real project models here.
