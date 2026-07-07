// 可決定性 harness 用的 element mapping fixture（對構表④ demo 資料）。
// 僅在 harness 模式（VITE_VIEWER_HARNESS=1 或 dev ?harness=1）下使用，絕不進入 production 串流路徑。
// 誠實鐵律：每筆都標 mock:true + mapping_method:"fake_for_smoke_test"，讓 MappingTable 既有的
// isFakeMappingItem 機制顯示 fake badge / 逐列 fake 標示，不冒充真實對映（見 src/types/mapping.ts）。
// 命名比照 usdStageTree.ts 的 harness:// 前綴慣例，guid 用 HARNESS-DEMO-* 避免與真資料混淆。
import type { ElementMappingItem } from "../../types/mapping";

export const harnessMappingItems: ElementMappingItem[] = [
  {
    mock: true,
    ifc_guid: "HARNESS-DEMO-GUID-001",
    ifc_class: "IfcWall",
    name: "Wall_001（harness demo）",
    usd_prim_path: "/World/Building/Level_1/Wall_001",
    mapping_method: "fake_for_smoke_test",
  },
  {
    mock: true,
    ifc_guid: "HARNESS-DEMO-GUID-002",
    ifc_class: "IfcDoor",
    name: "Door_001（harness demo）",
    usd_prim_path: "/World/Building/Level_1/Door_001",
    mapping_method: "fake_for_smoke_test",
  },
  {
    mock: true,
    ifc_guid: "HARNESS-DEMO-GUID-003",
    ifc_class: "IfcSlab",
    name: "Slab_002（harness demo）",
    usd_prim_path: "/World/Building/Level_2/Slab_002",
    mapping_method: "fake_for_smoke_test",
  },
];
