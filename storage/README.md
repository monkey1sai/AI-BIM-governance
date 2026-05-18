# Demo Runtime Storage Folder

Put local demo `.ifc` files in this folder when running `_worker` step ①/②.
Put local demo `.usdc` files in this folder when running the Docker-first Kit
Manager MVP at `http://127.0.0.1:5174`.

The worker reads this folder through `WORKER_DEV_STORAGE_ROOT` and only returns
relative source metadata to the browser UI. Large BIM files remain ignored by
git; do not commit real project models here.
