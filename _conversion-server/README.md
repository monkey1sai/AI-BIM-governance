# _conversion-server alias

`_conversion-server` is an alias name only. The actual local conversion API lives in:

```txt
../_conversion-service
```

Use `CONVERSION_API_BASE=http://127.0.0.1:8003` when a runbook or older note refers to `_conversion-server`.

Do not add duplicated FastAPI service code here.
