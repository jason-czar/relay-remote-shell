const KEY = "show-thinking-panel";

export function getThinkingPanelEnabled(): boolean {
  const v = localStorage.getItem(KEY);
  return v === null ? true : v === "true";
}

export function setThinkingPanelEnabled(enabled: boolean): void {
  localStorage.setItem(KEY, String(enabled));
  window.dispatchEvent(new CustomEvent("thinking-panel-change", { detail: enabled }));
}
