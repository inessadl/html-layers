// Clicking the toolbar icon (or Alt+Shift+L) opens the side panel for the window
// and asks the panel to inspect the current tab. The click also grants activeTab,
// which is what allows the panel to inject the inspector into that tab.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
  chrome.runtime.sendMessage({ type: 'inspect', tabId: tab.id }).catch(() => {
    // Panel not open yet: it inspects the active tab when it loads.
  });
});
