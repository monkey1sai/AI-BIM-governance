# A4 semantic-search fixture

This is a deliberately tiny, synthetic, non-sensitive IFC4 fixture for deterministic A4 tests and real-API browser acceptance.

- `a4_fire_doors.ifc` contains three `IfcDoor` elements: two on `4F` with `FireRating` 30 and 90, and one on `1F` with `FireRating` 45.
- `element_mapping.json` maps only the low-rated 4F door to `/World/Doors/Low`; the other two doors intentionally remain unmapped.
- Query `找 4F 防火門且 FireRating < 60` yields one mapped match.
- Query `找 4F 防火門且 FireRating > 100` yields no matches.
- Query `IfcDoor` with `limit=1` yields a truthful truncated result while the full candidate contains mapped and unmapped rows.

The files contain no customer model, host path, runtime token, endpoint, or credential. Large/local IFC and generated runtime artifacts remain ignored.
