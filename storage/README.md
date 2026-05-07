# Demo IFC Source Folder

Put local demo `.ifc` files in this folder when running `_worker` step ①/②.

The worker reads this folder through `WORKER_DEV_STORAGE_ROOT` and only returns
relative source metadata to the browser UI. Large BIM files remain ignored by
git; do not commit real project models here.
