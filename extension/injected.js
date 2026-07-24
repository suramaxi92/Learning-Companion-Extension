// Injected into YouTube page to access internal caption API
(function() {
  'use strict';
  
  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  
  // YouTube's caption fetching via their internal API
  async function fetchCaptions(videoId) {
    try {
      // Method 1: Try to get from ytInitialPlayerResponse
      const playerResponse = window.ytInitialPlayerResponse || 
                            (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args && window.ytplayer.config.args.raw_player_response);
      
      if (!playerResponse) {
        throw new Error('Could not find player response');
      }
      
      const captions = playerResponse.captions;
      if (!captions || !captions.captionTracks || captions.captionTracks.length === 0) {
        throw new Error('No captions available for this video');
      }
      
      // Get first available caption track (prefer English)
      let track = captions.captionTracks.find(t => t.languageCode === 'en') || captions.captionTracks[0];
      const captionUrl = track.baseUrl;
      
      // Fetch the caption data
      const response = await fetch(captionUrl);
      const xmlText = await response.text();
      
      // Parse XML to get timed text
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      const texts = xmlDoc.querySelectorAll('text');
      
      const transcript = [];
      texts.forEach(text => {
        const start = parseFloat(text.getAttribute('start'));
        const dur = parseFloat(text.getAttribute('dur') || '0');
        const content = text.textContent.trim();
        if (content) {
          transcript.push({
            text: content,
            start: start,
            duration: dur
          });
        }
      });
      
      // Convert to plain text format for backend
      const transcriptText = transcript.map(t => `[${formatTime(t.start)}] ${t.text}`).join('\n');
      
      return { success: true, transcript: transcriptText };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  
  // Listen for messages from content script
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (event.data.type === 'NOTETAKER_GET_TRANSCRIPT') {
      const videoId = new URLSearchParams(window.location.search).get('v');
      const result = await fetchCaptions(videoId);
      window.postMessage({ 
        type: 'NOTETAKER_TRANSCRIPT_RESULT', 
        data: result 
      }, '*');
    }
  });
})();