// 可決定性 harness 用的 USD stage 樹 + element mapping fixture。
// 僅在明確 VITE_VIEWER_HARNESS=1 且 route ?harness=1，或 Playwright route-stub 下使用，
// 絕不進入 production 串流路徑。形狀對齊 Window.tsx 的 USDPrimType / mapping.ts 的 ElementMappingDocument。

export interface HarnessPrim {
  name?: string;
  path: string;
  usd_prim_type?: string;
  ifc_guid?: string;
  children?: HarnessPrim[];
}

// 與 buildOpenStageRequest 的 url 對齊；harness 永遠回報這個 stage 已載入。
export const HARNESS_STAGE_URL = "harness://stage/World/sample-building.usd";

// 一棟小建築：World → Building（Level_1 / Level_2）+ Site。葉節點帶 ifc_guid 供反查 fixture。
export const harnessStageTree: HarnessPrim = {
  name: "World",
  path: "/World",
  usd_prim_type: "Xform",
  children: [
    {
      name: "Building",
      path: "/World/Building",
      usd_prim_type: "Xform",
      children: [
        {
          name: "Level_1",
          path: "/World/Building/Level_1",
          usd_prim_type: "Xform",
          children: [
            { name: "Wall_001", path: "/World/Building/Level_1/Wall_001", usd_prim_type: "Mesh", ifc_guid: "GUID-WALL-001" },
            { name: "Door_001", path: "/World/Building/Level_1/Door_001", usd_prim_type: "Mesh", ifc_guid: "GUID-DOOR-001" },
          ],
        },
        {
          name: "Level_2",
          path: "/World/Building/Level_2",
          usd_prim_type: "Xform",
          children: [
            { name: "Slab_002", path: "/World/Building/Level_2/Slab_002", usd_prim_type: "Mesh", ifc_guid: "GUID-SLAB-002" },
          ],
        },
      ],
    },
    { name: "Site", path: "/World/Site", usd_prim_type: "Xform", children: [] },
  ],
};

// 扁平索引：path → node，供 harnessChildrenFor 直接查。
const flatIndex: Map<string, HarnessPrim> = (() => {
  const map = new Map<string, HarnessPrim>();
  const walk = (node: HarnessPrim) => {
    map.set(node.path, node);
    (node.children ?? []).forEach(walk);
  };
  walk(harnessStageTree);
  return map;
})();

// 回傳指定 path 的「直接子節點」（不含本身）。對 "/World" 回傳 [Building, Site]。
// children 只帶 name/path/usd_prim_type（對齊 Kit getChildrenResponse 的精簡形狀，孫節點 lazy）。
export function harnessChildrenFor(primPath: string): Array<{ name?: string; path: string; usd_prim_type?: string }> {
  const node = flatIndex.get(primPath) ?? (primPath === "/World" ? harnessStageTree : undefined);
  if (!node || !node.children) return [];
  return node.children.map((child) => ({ name: child.name, path: child.path, usd_prim_type: child.usd_prim_type }));
}

// 由 usd_prim_path 反查 ifc_guid（fixture）。
export function harnessGuidForPrim(primPath: string): string | null {
  return flatIndex.get(primPath)?.ifc_guid ?? null;
}
