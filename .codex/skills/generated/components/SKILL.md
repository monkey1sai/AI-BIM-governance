---
name: components
description: "Skill for the Components area of AI-BIM-governance. 26 symbols across 6 files."
---

# Components

26 symbols | 6 files | Cohesion: 100%

## When to Use

- Working with code in `web-viewer-sample/`
- Understanding how DemoControlPanel, ConversionSummaryCard, App work
- Modifying components-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `web-viewer-sample/src/components/DemoControlPanel.tsx` | DemoControlPanel, ViewerSignal, InteractionLabCardView, RepoGuideCardView, DemoFlowStepView (+7) |
| `web-viewer-sample/src/components/ConversionSummaryCard.tsx` | isDevEnvironment, defaultFetchFallback, pickConversionJobId, formatNumber, formatRatio (+3) |
| `apps/kit-manager-web/src/components/StatusPanel.tsx` | classifyState, StatusPanel |
| `apps/kit-manager-web/src/components/KitManagerPage.tsx` | KitManagerPage, refresh |
| `apps/kit-manager-web/src/App.tsx` | App |
| `apps/kit-manager-web/src/components/UsdcChecklist.tsx` | UsdcChecklist |

## Entry Points

Start here when exploring this area:

- **`DemoControlPanel`** (Function) — `web-viewer-sample/src/components/DemoControlPanel.tsx:202`
- **`ConversionSummaryCard`** (Function) — `web-viewer-sample/src/components/ConversionSummaryCard.tsx:144`
- **`App`** (Function) — `apps/kit-manager-web/src/App.tsx:3`
- **`UsdcChecklist`** (Function) — `apps/kit-manager-web/src/components/UsdcChecklist.tsx:8`
- **`StatusPanel`** (Function) — `apps/kit-manager-web/src/components/StatusPanel.tsx:39`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `DemoControlPanel` | Function | `web-viewer-sample/src/components/DemoControlPanel.tsx` | 202 |
| `ConversionSummaryCard` | Function | `web-viewer-sample/src/components/ConversionSummaryCard.tsx` | 144 |
| `App` | Function | `apps/kit-manager-web/src/App.tsx` | 3 |
| `UsdcChecklist` | Function | `apps/kit-manager-web/src/components/UsdcChecklist.tsx` | 8 |
| `StatusPanel` | Function | `apps/kit-manager-web/src/components/StatusPanel.tsx` | 39 |
| `KitManagerPage` | Function | `apps/kit-manager-web/src/components/KitManagerPage.tsx` | 6 |
| `refresh` | Function | `apps/kit-manager-web/src/components/KitManagerPage.tsx` | 20 |
| `ViewerSignal` | Function | `web-viewer-sample/src/components/DemoControlPanel.tsx` | 834 |
| `InteractionLabCardView` | Function | `web-viewer-sample/src/components/DemoControlPanel.tsx` | 863 |
| `RepoGuideCardView` | Function | `web-viewer-sample/src/components/DemoControlPanel.tsx` | 917 |
| `DemoFlowStepView` | Function | `web-viewer-sample/src/components/DemoControlPanel.tsx` | 975 |
| `flowButtonStyle` | Function | `web-viewer-sample/src/components/DemoControlPanel.tsx` | 1041 |
| `withSessionId` | Function | `web-viewer-sample/src/components/DemoControlPanel.tsx` | 1057 |
| `inferKind` | Function | `web-viewer-sample/src/components/DemoControlPanel.tsx` | 1064 |
| `shortLabel` | Function | `web-viewer-sample/src/components/DemoControlPanel.tsx` | 1072 |
| `mappingOptionLabel` | Function | `web-viewer-sample/src/components/DemoControlPanel.tsx` | 1079 |
| `LogBlock` | Function | `web-viewer-sample/src/components/DemoControlPanel.tsx` | 1087 |
| `TextLogBlock` | Function | `web-viewer-sample/src/components/DemoControlPanel.tsx` | 1117 |
| `isDevEnvironment` | Function | `web-viewer-sample/src/components/ConversionSummaryCard.tsx` | 73 |
| `defaultFetchFallback` | Function | `web-viewer-sample/src/components/ConversionSummaryCard.tsx` | 92 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `App → ClassifyState` | intra_community | 4 |
| `App → Refresh` | intra_community | 3 |
| `App → UsdcChecklist` | intra_community | 3 |

## How to Explore

1. `gitnexus_context({name: "DemoControlPanel"})` — see callers and callees
2. `gitnexus_query({query: "components"})` — find related execution flows
3. Read key files listed above for implementation details
