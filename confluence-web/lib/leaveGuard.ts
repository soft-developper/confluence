"use client";

import { useEffect } from "react";

/**
 * Asks before leaving while a transfer is running (confluence:leave-guard).
 *
 * Closing or reloading the tab gets the browser's own "Leave site?" prompt. In-app links
 * (tabs, header, footer) change the page without a reload, so the browser never asks; for
 * those, a click on a same-site link is intercepted and the user is asked first. Funds are
 * never at risk from leaving, but the live progress view is lost, and a pending wallet
 * prompt could appear on another page.
 */
export const LEAVE_MESSAGE =
  "A transfer is still in progress. If you leave this page you'll lose the live progress view (your funds stay safe). Leave anyway?";

export function useLeaveGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return; // other sites open normally
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // same page (anchors)
      if (window.confirm(LEAVE_MESSAGE)) return;
      e.preventDefault();
      e.stopPropagation(); // capture phase on document: the link's own handler never runs
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [active]);
}
