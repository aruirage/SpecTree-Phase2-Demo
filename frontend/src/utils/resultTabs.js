export function upsertResultTab(tabs, nextTab) {
  const existingIndex = tabs.findIndex((tab) => tab.sessionId === nextTab.sessionId);
  if (existingIndex < 0) return [...tabs, nextTab];

  return tabs.map((tab, index) =>
    index === existingIndex ? { ...tab, ...nextTab } : tab
  );
}

export function closeResultTab(tabs, sessionId, activeSessionId) {
  const closedIndex = tabs.findIndex((tab) => tab.sessionId === sessionId);
  if (closedIndex < 0) {
    return { tabs, activeSessionId, closed: false };
  }

  const nextTabs = tabs.filter((tab) => tab.sessionId !== sessionId);
  if (activeSessionId !== sessionId) {
    return { tabs: nextTabs, activeSessionId, closed: true };
  }

  const nextActiveTab = nextTabs[Math.min(closedIndex, nextTabs.length - 1)];
  return {
    tabs: nextTabs,
    activeSessionId: nextActiveTab?.sessionId || '',
    closed: true,
  };
}
