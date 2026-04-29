# BIM Metadata Storage

> 13 nodes · cohesion 0.21

## Key Concepts

- **_s3_storage** (9 connections) — `plans/IFC_TO_USDC_CONVERSION_API_IMPLEMENTATION_PLAN.md`
- **_bim-control** (8 connections) — `plans/IFC_TO_USDC_CONVERSION_API_IMPLEMENTATION_PLAN.md`
- **Artifact Discovery Flow** (5 connections) — `plans/BIM_REVIEW_COORDINATOR_WEB_VIEWER_EXECUTION_PLAN.md`
- **POST /api/model-versions/{model_version_id}/conversion-result** (3 connections) — `contracts/bim-control-fake-api.md`
- **Artifact Metadata** (3 connections) — `contracts/bim-control-fake-api.md`
- **Metadata and File Bytes Stay Separate** (3 connections) — `contracts/bim-control-fake-api.md`
- **POST /api/review-sessions/{session_id}/annotations** (2 connections) — `contracts/bim-control-fake-api.md`
- **Annotation Metadata** (2 connections) — `contracts/bim-control-fake-api.md`
- **Conversion Result** (2 connections) — `contracts/conversion-api.md`
- **Annotation Persistence Flow** (2 connections) — `contracts/coordinator-socket-events.md`
- **Socket.IO annotationCreate** (2 connections) — `contracts/coordinator-socket-events.md`
- **GET /api/model-versions/{model_version_id}/artifacts** (1 connections) — `contracts/bim-control-fake-api.md`
- **Fake BIM Control API Contract** (1 connections) — `contracts/bim-control-fake-api.md`

## Relationships

- No strong cross-community connections detected

## Source Files

- `contracts/bim-control-fake-api.md`
- `contracts/conversion-api.md`
- `contracts/coordinator-socket-events.md`
- `plans/BIM_REVIEW_COORDINATOR_WEB_VIEWER_EXECUTION_PLAN.md`
- `plans/IFC_TO_USDC_CONVERSION_API_IMPLEMENTATION_PLAN.md`

## Audit Trail

- EXTRACTED: 39 (91%)
- INFERRED: 4 (9%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*