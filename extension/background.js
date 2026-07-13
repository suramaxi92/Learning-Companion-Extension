// Background service worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('[NoteTaker] Extension installed');
});

// Handle tab updates to reset state when navigating
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && changeInfo.url.includes('youtube.com/watch')) {
    // New video loaded, could broadcast to popup if needed
  }
});