type HistoryNavigateEvent = Event & {
  navigationType: string;
  destination: { url: string; key: string; sameDocument: boolean };
};

export type HistoryNavigation = EventTarget & {
  traverseTo(key: string): { finished: Promise<unknown> };
};

/** Protect same-document Back/Forward before the router unmounts the editor.
 * Cross-document navigation uses beforeunload. Never manufacture history entries:
 * the browser retains its normal escape behavior for non-cancelable traversals.
 */
export function installHistoryNavigationGuard(
  navigation: HistoryNavigation | undefined,
  currentUrl: () => string,
  requestLeave: (resume: () => void) => void,
  onError: () => void,
): () => void {
  let approvedKey: string | null = null;
  let active = true;
  function onNavigate(event: Event) {
    const next = event as HistoryNavigateEvent;
    if (approvedKey === next.destination.key) {
      approvedKey = null;
      return;
    }
    if (next.navigationType !== "traverse" || !next.cancelable || !next.destination.sameDocument) return;
    const current = new URL(currentUrl());
    const destination = new URL(next.destination.url);
    if (destination.origin === current.origin && destination.pathname === current.pathname && destination.search === current.search) return;
    next.preventDefault();
    requestLeave(() => {
      if (!active || !navigation) return;
      approvedKey = next.destination.key;
      try {
        void navigation.traverseTo(next.destination.key).finished.catch(() => {
          approvedKey = null;
          onError();
        });
      } catch {
        approvedKey = null;
        onError();
      }
    });
  }
  navigation?.addEventListener("navigate", onNavigate);
  return () => {
    active = false;
    navigation?.removeEventListener("navigate", onNavigate);
  };
}
