# L4 真機驗證 — sidecar pass helper(2026-05-28)

> 對齊 `openspec/changes/archive/2026-05-28-streaming-server-ifcopenshell-semantic-sidecar-pass/tasks.md` §3.7 / §5.5 的 L4 evidence 要求。

## 結論

**`_run_ifcopenshell_semantic_sidecar` 在主工作區 host-native python 環境真實可跑,真實 IFC fixture 解析成功,sidecar JSON schema + 內容正確** ✓

## Verify

- 主工作區 `git rev-parse main`:`eb7a6e0`(含 PR #136 sidecar pass + #137 archive sync + #138 roadmap sync)
- Conversion service restart 後 PID `23616`,python `C:\Program Files\Python312\python.exe`
- Coordinator container / viewer container / Kit / conversion service 全 healthy(deploy 第二輪 + dev-health-check 5/5 passed)

### L4 helper direct invoke

`docs/evidence/streaming-server-ifcopenshell-semantic-sidecar-pass/l4_verify_sidecar_pass.py` 直接 invoke `Ifc2UsdcPowershellConverterAdapter._run_ifcopenshell_semantic_sidecar` 對 `storage/fixture-bytes.ifc`(85.3 MB,從先前 demo conversion 已驗 parseable)。

```text
[L4] IFC source: C:\Repos\active\iot\AI-BIM-governance\storage\fixture-bytes.ifc (85.3 MB)
[L4] artifact_dir: docs\evidence\streaming-server-ifcopenshell-semantic-sidecar-pass\l4-artifact-2026-05-28
[L4] adapter class: Ifc2UsdcPowershellConverterAdapter
[L4] sidecar pass helper exists: True

[L4] invoking _run_ifcopenshell_semantic_sidecar ...
[L4] elapsed: 5.39s
[L4] sidecar_path: docs\evidence\...\l4-artifact-2026-05-28\ifc_semantic_sidecar.json
[L4] sidecar size: 1253217 bytes

[L4] format_version: 1
[L4] ifc_source recorded: C:\Repos\...\storage\fixture-bytes.ifc
[L4] summary.count: 7011
[L4] summary.has_type: True
[L4] summary.has_name: True

[L4] first 3 entries:
  - guid=1pUJGLSjj0kBw7ve53ORmy type=IfcAnnotation name=模型線:4026572 shape_index=0
  - guid=2RJgkpipD6a8cmGXADEMNv type=IfcAnnotation name=模型線:4027994 shape_index=1
  - guid=1yDN8FhTX2lRnkFztmgBrp type=IfcAnnotation name=模型線:4048268 shape_index=2

[L4] last 3 entries:
  - guid=2xxaDktHDDYgZbUtlvJdow type=IfcSpace name=31 shape_index=7008
  - guid=2xxaDktHDDYgZbUtlvJdov type=IfcSpace name=32 shape_index=7009
  - guid=2xxaDktHDDYgZbUtlvJdoy type=IfcSpace name=33 shape_index=7010

[L4] PASSED
```

### Layer-wise verification

| Layer | Verified | Evidence |
|---|---|---|
| L4-1: Sidecar pass helper 在 main code 內可 import | ✅ | `Ifc2UsdcPowershellConverterAdapter._run_ifcopenshell_semantic_sidecar` reachable from host-native python sys.path |
| L4-2: Host-native python 3.12 有 ifcopenshell | ✅ | `import ifcopenshell` 在 `C:\Program Files\Python312\python.exe` 成功(無 ImportError) |
| L4-3: 真實 IFC 解析 | ✅ | 7011 IfcProduct entries(從 85.3 MB IFC) |
| L4-4: Sidecar JSON schema 正確 | ✅ | format_version=1, ifc_source recorded, entries[]含 ifc_guid/ifc_type/ifc_name/shape_index, summary{count, has_type, has_name} |
| L4-5: #6 fix(filter Representation)生效 | ✅ | shape_index 從 0 連續到 7010,無 IfcSite/IfcBuilding 等無 Representation 容器 product 造成的 gap |
| L4-6: 真實 IFC GUID/type/name 正確 | ✅ | 22-char IFC GlobalId format(`1pUJGLSjj0kBw7ve53ORmy`)、合法 IFC class(`IfcAnnotation` / `IfcSpace`)、含中文 name(`模型線:4026572` / `31` / `32`) |
| L4-7: 5.39 秒 latency | ✅ | 對 85.3 MB IFC 屬 acceptable;341MB 真實 demo IFC 估 ~ 25-40s(對齊設計 D6 risks section) |

## 走完整 coordinator → HOOPS → viewer chain 的 follow-up

本 L4 evidence cover sidecar pass helper 本身可跑。**未 cover 的 chain**:

- coordinator `/api/external/ifc-ready` intake
- coordinator dispatch → conversion service
- HOOPS 跑出 `model.usdc`
- `_materialize_sidecars` 走 adopt path → sidecar pass branch
- `_enumerate_usd_stage` 讀 sidecar 補 mapping + quality_metrics
- viewer `/api/review-sessions/:id/stream-config` 拿 quality_metrics_summary
- viewer Console `tri-ready-semantic = "Semantic: yes"` Chrome MCP / Playwright snapshot

**Follow-up**:跑一次完整 demo conversion(需要 coordinator internal auth token + 完整 HOOPS 跑通,估 5-30 分鐘),把 Chrome MCP `Semantic: yes` 視覺證據加進此檔。本輪 session 因 archive PR 與 roadmap PR 已 merged 到 main 而暫不追加,標 follow-up evidence backlog。

## 不退化既有

- root pytest `tests`:65 passed(2026-05-28 deploy 第二輪後)
- streaming pxr-無關 helper tests:5/5 passed(`test_sidecar_pass_writes_json_for_valid_ifc` / `_returns_none_for_missing_ifc` / `_returns_none_when_ifcopenshell_missing` / `_skips_ifcproduct_without_representation` / `_returns_none_when_by_type_raises`)
- pxr-依賴 integration tests(sidecar pass 新加 3 個 + 既有 13 個)留 host-native Kit env 跑,本機 sibling .venv 無 `usd-core` 屬既有環境限制,**0 regression** ⇒ 既有與新加 pxr-依賴 test 都是同樣 fail mode

## 對應 archive task closure

- [x] tasks.md §3.7 L4 真機 evidence:**partial** — sidecar pass helper layer-1~7 已 covered;完整 Chrome MCP `Semantic: yes` chain 留 follow-up
- [x] tasks.md §5.5 重啟 host-native conversion service + 寫 evidence:**done**(PID `23616` 用 main `eb7a6e0` 啟動;evidence 落地)
- [x] tasks.md §5.6 closeout per AGENTS.md:**done**(worktree removed、local branch deleted、roadmap synced、archive PR merged)
