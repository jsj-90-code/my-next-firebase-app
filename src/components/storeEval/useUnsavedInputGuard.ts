"use client";

import { createElement, useEffect, useRef, useState } from "react";
import { installHistoryNavigationGuard, type HistoryNavigation } from "@/lib/storeEval/historyNavigationGuard";
import { UnsavedInputDialog } from "./UnsavedInputDialog";

/** Warn before discarding this editor through navigation, tab changes or a page reload. */
export function useUnsavedInputGuard(dirty: boolean, busy: boolean) {
  const [pending, setPending] = useState<{ resume: () => void; blockedWhileBusy: boolean } | null>(null);
  const [navigationError, setNavigationError] = useState(false);
  const replayingClick = useRef(false);
  useEffect(() => {
    if (!dirty && !busy) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    function beforeNavigate(event: MouseEvent) {
      if (replayingClick.current || event.defaultPrevented) return;
      if (!(event.target instanceof Element)) return;
      const target = event.target.closest("a[href], [data-leaves-editor]");
      if (!target) return;
      if (target instanceof HTMLAnchorElement) {
        if (target.target === "_blank" || target.hasAttribute("download") || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const url = new URL(target.href, window.location.href);
        if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) return;
      }
      if (!(target instanceof HTMLElement)) return;
      event.preventDefault();
      event.stopPropagation();
      setNavigationError(false);
      setPending({ blockedWhileBusy: busy, resume: () => {
        replayingClick.current = true;
        // The user explicitly discarded the edit; avoid a second prompt on an external link.
        window.removeEventListener("beforeunload", beforeUnload);
        try { target.click(); } finally {
          replayingClick.current = false;
          window.addEventListener("beforeunload", beforeUnload);
        }
      } });
    }
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeNavigate, true);
    const removeHistoryGuard = installHistoryNavigationGuard(
      (window as Window & { navigation?: HistoryNavigation }).navigation,
      () => window.location.href,
      (resume) => { setNavigationError(false); setPending({ resume, blockedWhileBusy: busy }); },
      () => setNavigationError(true),
    );
    return () => {
      removeHistoryGuard();
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", beforeNavigate, true);
    };
  }, [dirty, busy]);
  if (navigationError) return createElement("p", { role: "alert", className: "app-notice app-badge-danger px-3 py-2 text-sm" }, "화면을 이동하지 못했습니다. 입력 내용을 저장한 뒤 다시 이동해주세요.");
  return pending && createElement(UnsavedInputDialog, {
    busy: busy || pending.blockedWhileBusy,
    onStay: () => setPending(null),
    onLeave: () => {
      if (busy) return;
      setPending(null);
      pending.resume();
    },
  });
}
