// Content script runs on YouTube pages
// Primarily used for communication between popup and page

console.log('[NoteTaker] Content script loaded');

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getTranscript') {
    // This will be handled by injected script that accesses YouTube's internal API
    window.postMessage({ type: 'NOTETAKER_GET_TRANSCRIPT' }, '*');
  }
  sendResponse({ status: 'ok' });
});