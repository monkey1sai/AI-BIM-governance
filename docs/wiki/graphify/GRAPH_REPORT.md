# Graph Report - docs/graphify-corpus  (2026-04-29)

## Corpus Check
- Corpus is ~8,058 words - fits in a single context window. You may not need a graph.

## Summary
- 78 nodes · 123 edges · 7 communities detected
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_DataChannel Runtime Validation|DataChannel Runtime Validation]]
- [[_COMMUNITY_BIM Metadata Storage|BIM Metadata Storage]]
- [[_COMMUNITY_Monorepo Local Runtime|Monorepo Local Runtime]]
- [[_COMMUNITY_Mapping Index Artifacts|Mapping Index Artifacts]]
- [[_COMMUNITY_Review Session WebRTC|Review Session WebRTC]]
- [[_COMMUNITY_Conversion API Pipeline|Conversion API Pipeline]]
- [[_COMMUNITY_Issue Highlight Collaboration|Issue Highlight Collaboration]]

## God Nodes (most connected - your core abstractions)
1. `_s3_storage` - 9 edges
2. `element_mapping.json` - 9 edges
3. `DataChannel highlightPrimsRequest` - 9 edges
4. `bim-streaming-server` - 8 edges
5. `_bim-control` - 8 edges
6. `DataChannel openStageRequest` - 8 edges
7. `Local Service Startup Sequence` - 8 edges
8. `_conversion-service` - 7 edges
9. `Conversion Job` - 7 edges
10. `AI-BIM-governance Single Root Repo` - 5 edges

## Surprising Connections (you probably didn't know these)
- `Use One Root Repo Instead of Nested Git` --conceptually_related_to--> `Local Development Runbook`  [INFERRED]
  git/nested-repo-remotes.md → contracts/local-dev-runbook.md
- `localhost:8003 Conversion Service` --serves--> `_conversion-service`  [EXTRACTED]
  contracts/conversion-api.md → plans/IFC_TO_USDC_CONVERSION_API_IMPLEMENTATION_PLAN.md
- `Use One Root Repo Instead of Nested Git` --conceptually_related_to--> `bim-streaming-server`  [INFERRED]
  git/nested-repo-remotes.md → plans/IFC_TO_USDC_CONVERSION_API_IMPLEMENTATION_PLAN.md
- `_s3_storage` --owns--> `IFC Source File`  [EXTRACTED]
  plans/IFC_TO_USDC_CONVERSION_API_IMPLEMENTATION_PLAN.md → contracts/conversion-api.md
- `localhost:8002 Fake Storage` --serves--> `_s3_storage`  [EXTRACTED]
  contracts/conversion-api.md → plans/IFC_TO_USDC_CONVERSION_API_IMPLEMENTATION_PLAN.md

## Hyperedges (group relationships)
- **Conversion Artifact Closed Loop** — service_conversion_service, service_s3_storage, service_bim_control, service_review_coordinator, service_web_viewer, service_bim_streaming_server [INFERRED 0.90]
- **Review Issue to 3D Runtime Loop** — data_review_issue, data_element_mapping, data_usd_prim_path, dc_highlight_prims_request, service_bim_streaming_server, socket_highlight_request [INFERRED 0.88]
- **Single Repo Operational Context** — repo_ai_bim_governance, doc_nested_repo_remote_record, doc_local_runbook, doc_ifc_usdc_plan, doc_review_web_plan [INFERRED 0.82]

## Communities

### Community 0 - "DataChannel Runtime Validation"
Cohesion: 0.21
Nodes (15): USDC Runtime Model, DataChannel clearHighlightRequest, DataChannel highlightPrimsRequest, DataChannel highlightPrimsResult, DataChannel openStageRequest, DataChannel openedStageResult, Streaming DataChannel Events Contract, IFC to USDC Conversion API Plan (+7 more)

### Community 1 - "BIM Metadata Storage"
Cohesion: 0.21
Nodes (13): GET /api/model-versions/{model_version_id}/artifacts, POST /api/review-sessions/{session_id}/annotations, POST /api/model-versions/{model_version_id}/conversion-result, Annotation Metadata, Artifact Metadata, Conversion Result, Fake BIM Control API Contract, Annotation Persistence Flow (+5 more)

### Community 2 - "Monorepo Local Runtime"
Cohesion: 0.18
Nodes (13): Local Development Runbook, Nested Repo Remote Record, Local Service Startup Sequence, Nested .git Backup Outside Workspace, GitHub Root Remote monkey1sai/AI-BIM-governance, localhost:5173 Web Viewer, localhost:8001 Fake BIM Control, localhost:8002 Fake Storage (+5 more)

### Community 3 - "Mapping Index Artifacts"
Cohesion: 0.2
Nodes (12): Conversion Job, element_mapping.json, IFC Source File, IFC GlobalId / GUID, ifc_index.json, Mapping Summary, usd_index.json, USD Prim Path (+4 more)

### Community 4 - "Review Session WebRTC"
Cohesion: 0.18
Nodes (12): GET /api/model-versions/{model_version_id}/review-bootstrap, GET /api/review-sessions/{session_id}/stream-config, POST /api/review-sessions, Review Session State, WebRTC Stream Config, Review Session Bootstrap Flow, 127.0.0.1:49100 WebRTC Signaling, localhost:8004 Review Coordinator (+4 more)

### Community 5 - "Conversion API Pipeline"
Cohesion: 0.33
Nodes (7): GET /api/conversions/{job_id}/result, POST /api/conversions, IFC to USDC Conversion API Contract, Review Session API Contract, Conversion Publish Flow, Conversion Service Pluggable Not Rewritten, _conversion-service

### Community 6 - "Issue Highlight Collaboration"
Cohesion: 0.47
Nodes (6): GET /api/model-versions/{model_version_id}/review-issues, Review Issue Metadata, BIM Review Coordinator + Web Viewer Execution Plan, Coordinator Socket Events Contract, Issue to 3D Highlight Flow, Socket.IO highlightRequest

## Knowledge Gaps
- **18 isolated node(s):** `Fake BIM Control API Contract`, `Nested Repo Remote Record`, `GitHub Root Remote monkey1sai/AI-BIM-governance`, `Mapping Summary`, `GET /api/conversions/{job_id}/result` (+13 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `_bim-control` connect `BIM Metadata Storage` to `Monorepo Local Runtime`, `Conversion API Pipeline`, `Issue Highlight Collaboration`?**
  _High betweenness centrality (0.219) - this node is a cross-community bridge._
- **Why does `DataChannel highlightPrimsRequest` connect `DataChannel Runtime Validation` to `Mapping Index Artifacts`, `Issue Highlight Collaboration`?**
  _High betweenness centrality (0.173) - this node is a cross-community bridge._
- **Why does `element_mapping.json` connect `Mapping Index Artifacts` to `BIM Metadata Storage`, `Review Session WebRTC`, `Issue Highlight Collaboration`?**
  _High betweenness centrality (0.158) - this node is a cross-community bridge._
- **What connects `Fake BIM Control API Contract`, `Nested Repo Remote Record`, `GitHub Root Remote monkey1sai/AI-BIM-governance` to the rest of the system?**
  _18 weakly-connected nodes found - possible documentation gaps or missing edges._