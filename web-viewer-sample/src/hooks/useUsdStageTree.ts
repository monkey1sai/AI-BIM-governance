import { useState, useCallback, useMemo } from "react";

export interface USDPrimNode {
  name?: string;
  path: string;
  children?: USDPrimNode[];
  type?: string;
}

export interface UseUsdStageTreeOptions {
  initialPrims?: USDPrimNode[];
  onPrimFocus?: (primPath: string) => void;
  onPrimHighlight?: (primPaths: string[]) => void;
}

export interface UseUsdStageTreeReturn {
  usdPrims: USDPrimNode[];
  setUsdPrims: (prims: USDPrimNode[]) => void;
  selectedPrims: Set<string>;
  expandedPaths: Set<string>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredPrims: USDPrimNode[];
  toggleExpand: (primPath: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  selectPrim: (primPath: string, multiSelect?: boolean) => void;
  clearSelection: () => void;
  resetTree: () => void;
  findNodeByPath: (path: string) => USDPrimNode | null;
}

function filterPrimsRecursive(nodes: USDPrimNode[], query: string): USDPrimNode[] {
  if (!query.trim()) return nodes;
  const q = query.toLowerCase();
  const results: USDPrimNode[] = [];

  for (const node of nodes) {
    const nameMatch = (node.name || "").toLowerCase().includes(q) || (node.path || "").toLowerCase().includes(q);
    const filteredChildren = node.children ? filterPrimsRecursive(node.children, query) : [];

    if (nameMatch || filteredChildren.length > 0) {
      results.push({
        ...node,
        children: filteredChildren.length > 0 ? filteredChildren : node.children,
      });
    }
  }

  return results;
}

function collectAllPaths(nodes: USDPrimNode[]): string[] {
  const paths: string[] = [];
  function traverse(n: USDPrimNode) {
    paths.push(n.path);
    if (n.children) {
      n.children.forEach(traverse);
    }
  }
  nodes.forEach(traverse);
  return paths;
}

export function useUsdStageTree(options: UseUsdStageTreeOptions = {}): UseUsdStageTreeReturn {
  const [usdPrims, setUsdPrims] = useState<USDPrimNode[]>(options.initialPrims || []);
  const [selectedPrims, setSelectedPrims] = useState<Set<string>>(new Set());
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState<string>("");

  const toggleExpand = useCallback((primPath: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(primPath)) {
        next.delete(primPath);
      } else {
        next.add(primPath);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedPaths(new Set(collectAllPaths(usdPrims)));
  }, [usdPrims]);

  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set());
  }, []);

  const selectPrim = useCallback((primPath: string, multiSelect = false) => {
    setSelectedPrims((prev) => {
      const next = multiSelect ? new Set(prev) : new Set<string>();
      if (next.has(primPath)) {
        next.delete(primPath);
      } else {
        next.add(primPath);
      }
      return next;
    });
    options.onPrimFocus?.(primPath);
  }, [options]);

  const clearSelection = useCallback(() => {
    setSelectedPrims(new Set());
  }, []);

  const resetTree = useCallback(() => {
    setSelectedPrims(new Set());
    setExpandedPaths(new Set());
    setSearchQuery("");
  }, []);

  const findNodeByPath = useCallback((targetPath: string): USDPrimNode | null => {
    function search(nodes: USDPrimNode[]): USDPrimNode | null {
      for (const node of nodes) {
        if (node.path === targetPath) return node;
        if (node.children) {
          const found = search(node.children);
          if (found) return found;
        }
      }
      return null;
    }
    return search(usdPrims);
  }, [usdPrims]);

  const filteredPrims = useMemo(() => {
    return filterPrimsRecursive(usdPrims, searchQuery);
  }, [usdPrims, searchQuery]);

  return {
    usdPrims,
    setUsdPrims,
    selectedPrims,
    expandedPaths,
    searchQuery,
    setSearchQuery,
    filteredPrims,
    toggleExpand,
    expandAll,
    collapseAll,
    selectPrim,
    clearSelection,
    resetTree,
    findNodeByPath,
  };
}
