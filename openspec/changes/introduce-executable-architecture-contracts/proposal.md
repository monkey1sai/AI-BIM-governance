# Proposal: Introduce Executable Architecture Contracts

## Why

`docs/plans/` 已能描述目標功能、服務分工與 AI Coding 交付語意，但 narrative documents 不能單獨阻止 AI implementation 形成錯誤依賴、重複 ownership、browser bypass、資料落地違規或不足的 runtime readiness 判定。

目前 architecture issues 多半在功能完成後，由人工 review 或 `$improve-codebase-architecture` 才發現。這會形成：

```text
完成 task
→ 事後發現 structural erosion
→ 再重構
→ 下一個 task 重複相同問題
```

本 change 將最重要的架構鐵律轉成 machine-readable contract 與 semantic validator，使 repo 能採用 no-new-violation architecture ratchet。

## Ownership

- **Owning repo/folder:** `AI-BIM-governance` root architecture governance (`architecture/`, `scripts/`, `tests/`, `openspec/`).
- **Product service ownership:** unchanged; no capability is moved between coordinator, streaming, governance, viewer, or Kit Manager.
- **Persistent product data:** none added. The JSON files are repository contracts, not runtime customer records.
- **Boundary preservation:** the change records existing cloud/edge, service, browser, and evidence boundaries; it does not move GPU runtime, large artifacts, or governance persistence.

## What Changes

1. 新增 `architecture/architecture-contract.json`，聲明：
   - service responsibilities and unique ownership；
   - allowed service dependency edges；
   - browser HTTP / WebRTC boundaries；
   - company cloud metadata-only 與 customer-edge artifact residency；
   - Kit-side + browser-side readiness evidence；
   - architecture invariants、delta policy、exception policy。
2. 新增 JSON Schema：
   - `architecture-contract.schema.json`；
   - `architecture-delta.schema.json`。
3. 新增 `architecture/deltas/<change-id>.json`，讓 governed changes 先聲明 intended architecture delta。
4. 新增 standard-library semantic validator，處理 JSON Schema 難以表示的 cross-object constraints。
5. 新增 root pytest contract，測試 canonical contract 與 fail-closed negative cases。
6. 把 `architecture/**` 與 validator 路徑接入既有 `verification-manifest.json` 的 root-contract / agent-governance / security dispatch，不新增第二條平行 verify pipeline。

## Non-Goals

本 change 不會：

- 重構任何 product service；
- 改 public HTTP / event / database contract；
- 宣稱現有 source graph 已完全符合 desired architecture；
- 新增 production dependency；
- 在第一版導入 dependency-cruiser、Import Linter 或 executable state-machine runtime；
- 取代 `docs/plans` 的 human-readable intent 或現有 frontend/runtime evidence gates。

## Impact

- **Runtime behavior:** none。
- **Public API / event / DB schema:** none。
- **Repository governance:** additive。
- **Verification:** architecture-only changes 將觸發 root contracts、agent governance 與 secret scan。
- **Developer workflow:** Lane G / S 架構變更需附 architecture delta；exceptions 需 owner、ADR、理由及 expiry。
