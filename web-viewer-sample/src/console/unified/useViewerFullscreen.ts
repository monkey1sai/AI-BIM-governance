import { useCallback, useEffect, useRef, useState } from "react";

/** Expand the existing workspace ancestor, including its sibling viewport host.
 * Never move/remount the iframe or change session/lease ownership. */
export function useViewerFullscreen() {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const backgroundRef = useRef<Element[]>([]);
  const [expanded, setExpanded] = useState(false);

  const restore = useCallback(() => {
    targetRef.current?.removeAttribute("data-viewer-expanded");
    targetRef.current = null;
    backgroundRef.current.forEach(element => element.removeAttribute("inert"));
    backgroundRef.current = [];
    setExpanded(false);
    buttonRef.current?.focus({ preventScroll: true });
  }, []);

  const enter = useCallback(() => {
    const target = workspaceRef.current?.closest<HTMLElement>("[data-uc='page-root']");
    if (!target || targetRef.current) return;
    targetRef.current = target;
    target.setAttribute("data-viewer-expanded", "true");
    // Covered navigation must not remain reachable by Tab or assistive tech.
    const shell = target.closest(".uc-root");
    if (shell) {
      let branch: Element = target;
      while (branch !== shell && branch.parentElement) {
        const parent = branch.parentElement;
        for (const sibling of Array.from(parent.children)) {
          if (sibling !== branch && !sibling.hasAttribute("inert")) {
            sibling.setAttribute("inert", "");
            backgroundRef.current.push(sibling);
          }
        }
        branch = parent;
      }
    }
    setExpanded(true);
    // In-app fullscreen is intentional: embedded hosts may revoke native
    // fullscreen when focus changes. CSS expansion requires no permission.
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && targetRef.current) restore();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const target = targetRef.current;
      target?.removeAttribute("data-viewer-expanded");
      targetRef.current = null;
      backgroundRef.current.forEach(element => element.removeAttribute("inert"));
      backgroundRef.current = [];
    };
  }, [restore]);

  return { workspaceRef, buttonRef, expanded, enter, exit: restore };
}
