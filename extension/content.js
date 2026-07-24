// Content script runs on YouTube pages
// Bridges communication between popup and injected script

console.log('[NoteTaker] Content script loaded');

// Inject the injected script into the page
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = function() {
  this.remove();
};
(document.head || document.documentElement).appendChild(script);

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getTranscript') {
    // Forward request to injected script via window.postMessage
    window.postMessage({ type: 'NOTETAKER_GET_TRANSCRIPT' }, '*');
    
    // Listen for response from injected script (one-time listener)
    const handler = (event) => {
      if (event.source !== window) return;
      if (event.data.type === 'NOTETAKER_TRANSCRIPT_RESULT') {
        window.removeEventListener('message', handler);
        sendResponse(event.data.data);
      }
    };
    window.addEventListener('message', handler);
    
    // Return true to indicate async response
    return true;
  }
  sendResponse({ status: 'ok' });
});