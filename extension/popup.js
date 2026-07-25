const BACKEND_URL = 'http://localhost:5000';

let currentVideoId = null;
let currentVideoTitle = '';
let currentTranscript = '';
let currentNotes = '';
let isLearningVideo = false;

const STORAGE_KEYS = {
  videoId: 'notetaker_videoId',
  videoTitle: 'notetaker_videoTitle',
  transcript: 'notetaker_transcript',
  notes: 'notetaker_notes',
  chatHistory: 'notetaker_chatHistory',
  questions: 'notetaker_questions',
  recommendations: 'notetaker_recommendations',
  isLearning: 'notetaker_isLearning'
};

const SHORTS_STORAGE_KEY = 'notetaker_shortsCount';

// ========== STORAGE HELPERS ==========

async function saveToStorage(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

async function getFromStorage(key) {
  const result = await chrome.storage.local.get(key);
  return result[key];
}

async function clearVideoData() {
  await chrome.storage.local.remove([
    STORAGE_KEYS.videoId,
    STORAGE_KEYS.videoTitle,
    STORAGE_KEYS.transcript,
    STORAGE_KEYS.notes,
    STORAGE_KEYS.chatHistory,
    STORAGE_KEYS.questions,
    STORAGE_KEYS.recommendations,
    STORAGE_KEYS.isLearning
  ]);
}

// ========== SHORTS TRACKING ==========

async function incrementShortsCount() {
  const today = new Date().toISOString().split('T')[0];
  const key = `${SHORTS_STORAGE_KEY}_${today}`;
  const result = await chrome.storage.local.get(key);
  const current = result[key] || 0;
  await chrome.storage.local.set({ [key]: current + 1 });
  return current + 1;
}

async function getShortsStats() {
  const today = new Date().toISOString().split('T')[0];
  const todayKey = `${SHORTS_STORAGE_KEY}_${today}`;
  const allData = await chrome.storage.local.get(null);
  let todayCount = 0;
  let totalCount = 0;
  
  for (const [key, value] of Object.entries(allData)) {
    if (key.startsWith(SHORTS_STORAGE_KEY)) {
      totalCount += value;
      if (key === todayKey) todayCount = value;
    }
  }
  return { today: todayCount, total: totalCount };
}

async function clearOldShorts(daysToKeep = 30) {
  const allData = await chrome.storage.local.get(null);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysToKeep);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const toRemove = [];
  
  for (const key of Object.keys(allData)) {
    if (key.startsWith(SHORTS_STORAGE_KEY)) {
      const dateStr = key.replace(`${SHORTS_STORAGE_KEY}_`, '');
      if (dateStr < cutoffStr) toRemove.push(key);
    }
  }
  
  if (toRemove.length > 0) {
    await chrome.storage.local.remove(toRemove);
  }
}

// ========== INIT: RESTORE DATA ON OPEN ==========

async function initPopup() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // Handle YouTube Shorts
  if (tab.url && tab.url.includes('youtube.com/shorts/')) {
    currentVideoId = tab.url.split('/shorts/')[1]?.split('?')[0] || 'shorts';
    currentVideoTitle = 'YouTube Shorts';
    
    const count = await incrementShortsCount();
    const stats = await getShortsStats();
    
    document.querySelectorAll('.video-title').forEach(el => {
      el.textContent = '📱 YouTube Shorts';
    });
    
    document.getElementById('notesResult').innerHTML = `
      <div class="hint-box" style="background: rgba(251, 191, 36, 0.1); border-color: rgba(251, 191, 36, 0.3);">
        <div class="hint-title" style="color: var(--warning);">⚠️ YouTube Shorts Detected</div>
        <div class="hint-steps" style="font-size: 13px; line-height: 1.8;">
          <div style="margin-bottom: 8px;">This is a Shorts video. Shorts are typically not educational.</div>
          <div style="display: flex; gap: 16px; margin-top: 12px;">
            <div style="text-align: center;">
              <div style="font-size: 24px; font-weight: 700; color: var(--warning);">${stats.today}</div>
              <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">Today</div>
            </div>
            <div style="width: 1px; background: var(--border);"></div>
            <div style="text-align: center;">
              <div style="font-size: 24px; font-weight: 700; color: var(--text-secondary);">${stats.total}</div>
              <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">Total</div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    document.getElementById('generateNotesBtn').style.display = 'none';
    document.getElementById('downloadNotesBtn').style.display = 'none';
    
    await clearOldShorts();
    return;
  }
  
  // Regular video handling
  if (!tab.url || !tab.url.includes('youtube.com/watch')) {
    document.querySelectorAll('.video-title').forEach(el => {
      el.textContent = 'Open a YouTube video';
    });
    return;
  }
  
  const url = new URL(tab.url);
  currentVideoId = url.searchParams.get('v');
  
  const storedVideoId = await getFromStorage(STORAGE_KEYS.videoId);
  
  if (storedVideoId && storedVideoId !== currentVideoId) {
    await clearVideoData();
    chatHistory = [];
  }
  
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: getVideoInfo
  }, async (results) => {
    let title = 'Unknown Video';
    if (results && results[0] && results[0].result) {
      title = results[0].result.title;
    }
    
    currentVideoId = currentVideoId;
    currentVideoTitle = title;
    
    await saveToStorage(STORAGE_KEYS.videoId, currentVideoId);
    await saveToStorage(STORAGE_KEYS.videoTitle, currentVideoTitle);
    
    document.querySelectorAll('.video-title').forEach(el => {
      el.textContent = title.length > 45 ? title.substring(0, 45) + '...' : title;
    });
    
    await restoreSavedData();
  });
}

async function restoreSavedData() {
  const savedTranscript = await getFromStorage(STORAGE_KEYS.transcript);
  if (savedTranscript) currentTranscript = savedTranscript;
  
  const savedNotes = await getFromStorage(STORAGE_KEYS.notes);
  if (savedNotes) {
    currentNotes = savedNotes;
    renderNotes(currentNotes);
    document.getElementById('downloadNotesBtn').style.display = 'flex';
    updateStatus();
  }
  
  const savedIsLearning = await getFromStorage(STORAGE_KEYS.isLearning);
  if (savedIsLearning !== undefined) isLearningVideo = savedIsLearning;
  
  const savedChat = await getFromStorage(STORAGE_KEYS.chatHistory);
  if (savedChat && savedChat.length > 0) {
    chatHistory = savedChat;
    const container = document.getElementById('chatContainer');
    container.innerHTML = '';
    savedChat.forEach(msg => {
      const msgDiv = document.createElement('div');
      msgDiv.className = `chat-msg ${msg.role}`;
      const label = msg.role === 'user' ? 'You' : 'AI';
      msgDiv.innerHTML = `<div class="chat-label">${label}</div>${escapeHtml(msg.text)}`;
      container.appendChild(msgDiv);
    });
    container.scrollTop = container.scrollHeight;
  }
  
  const savedQuestions = await getFromStorage(STORAGE_KEYS.questions);
  if (savedQuestions) {
    renderQuestions(savedQuestions);
    const questionsStatus = document.getElementById('questionsStatus');
    questionsStatus.innerHTML = '<span class="status-dot"></span> Ready to generate';
    questionsStatus.className = 'status-badge ready';
  }
  
  const savedRecs = await getFromStorage(STORAGE_KEYS.recommendations);
  if (savedRecs) {
    renderRecommendations(savedRecs);
    const learnStatus = document.getElementById('learnStatus');
    learnStatus.innerHTML = '<span class="status-dot"></span> Recommendations ready';
    learnStatus.className = 'status-badge ready';
  }
}

// ========== TAB SWITCHING ==========

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// ========== UI HELPERS ==========

function showLoading(containerId, text = 'Processing...', subtext = '') {
  document.getElementById(containerId).innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <div class="loading-text">${text}</div>
      ${subtext ? `<div class="loading-subtext">${subtext}</div>` : ''}
    </div>
  `;
}

function showError(containerId, msg) {
  document.getElementById(containerId).innerHTML = `<div class="error-box">${msg}</div>`;
}

function updateStatus() {
  const notesStatus = document.getElementById('notesStatus');
  const questionsStatus = document.getElementById('questionsStatus');
  
  if (currentNotes) {
    notesStatus.innerHTML = '<span class="status-dot"></span> Notes ready';
    notesStatus.className = 'status-badge ready';
    questionsStatus.innerHTML = '<span class="status-dot"></span> Ready to generate';
    questionsStatus.className = 'status-badge ready';
  }
}

// ========== NOTES ==========

document.getElementById('generateNotesBtn').addEventListener('click', async () => {
  document.getElementById('downloadNotesBtn').style.display = 'none';
  
  if (currentTranscript) {
    generateNotesFromTranscript();
    return;
  }
  
  if (!currentVideoId) {
    showError('notesResult', 'No video detected. Open a YouTube video first.');
    return;
  }
  
  const btn = document.getElementById('generateNotesBtn');
  btn.disabled = true;
  showLoading('notesResult', 'Extracting transcript...', 'Accessing YouTube captions');
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const response = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { action: 'getTranscript' }, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(res);
        }
      });
    });
    
    if (!response) throw new Error('No response from content script');
    
    if (response.success) {
      currentTranscript = response.transcript;
      await saveToStorage(STORAGE_KEYS.transcript, currentTranscript);
      generateNotesFromTranscript();
    } else {
      showManualTranscriptFallback(response.error || 'Auto-extraction failed');
    }
    
  } catch (err) {
    showManualTranscriptFallback(err.message || 'Cannot extract transcript. Make sure you are on a YouTube video page.');
  } finally {
    btn.disabled = false;
  }
});

function showManualTranscriptFallback(errorMsg) {
  document.getElementById('downloadNotesBtn').style.display = 'none';
  
  document.getElementById('notesResult').innerHTML = `
    <div class="hint-box">
      <div class="hint-title">⚠️ ${errorMsg}</div>
      <div class="hint-steps">
        <strong>Get transcript manually:</strong><br>
        1. Click <code>⋯</code> below the video → <code>Show transcript</code><br>
        2. Copy and paste below
      </div>
    </div>
    <div class="input-group">
      <div class="input-label">📋 Paste Transcript</div>
      <textarea class="transcript-input" id="manualTranscript" placeholder="Paste transcript here with timestamps..."></textarea>
    </div>
    <button class="btn btn-primary" id="manualGenerateBtn">
      <span>✨</span> Generate from Transcript
    </button>
  `;
  
  document.getElementById('manualGenerateBtn').addEventListener('click', async () => {
    const manualText = document.getElementById('manualTranscript').value.trim();
    if (!manualText) {
      alert('Please paste a transcript first!');
      return;
    }
    currentTranscript = manualText;
    await saveToStorage(STORAGE_KEYS.transcript, currentTranscript);
    generateNotesFromTranscript();
  });
}

async function generateNotesFromTranscript() {
  if (!currentTranscript) return;
  
  const btn = document.getElementById('generateNotesBtn');
  btn.disabled = true;
  document.getElementById('downloadNotesBtn').style.display = 'none';
  showLoading('notesResult', 'Analyzing video...', 'Classifying content & generating notes');
  
  try {
    const notesRes = await fetch(`${BACKEND_URL}/api/generate-notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        transcript: currentTranscript,
        video_title: currentVideoTitle,
        video_id: currentVideoId
      })
    });
    
    const notesData = await notesRes.json();
    if (notesData.error) throw new Error(notesData.error);
    
    currentNotes = notesData.notes;
    isLearningVideo = notesData.is_learning_related;
    
    await saveToStorage(STORAGE_KEYS.notes, currentNotes);
    await saveToStorage(STORAGE_KEYS.isLearning, isLearningVideo);
    
    let learningBadge = '';
    if (isLearningVideo) {
      learningBadge = `<div style="background: var(--success-bg); color: var(--success); padding: 8px 14px; border-radius: 8px; font-size: 11px; font-weight: 600; margin-bottom: 12px; display: inline-flex; align-items: center; gap: 6px;">
        <span>🎓</span> Learning Video • ${notesData.concepts_extracted || 0} concepts extracted
      </div>`;
    } else {
      learningBadge = `<div style="background: var(--warning-bg); color: var(--warning); padding: 8px 14px; border-radius: 8px; font-size: 11px; font-weight: 600; margin-bottom: 12px; display: inline-flex; align-items: center; gap: 6px;">
        <span>📺</span> Non-Learning Video
      </div>`;
    }
    
    renderNotes(notesData.notes);
    
    const notesResult = document.getElementById('notesResult');
    notesResult.insertAdjacentHTML('afterbegin', learningBadge);
    
    updateStatus();
  } catch (err) {
    showError('notesResult', err.message);
  } finally {
    btn.disabled = false;
  }
}

function renderNotes(notes) {
  let html = '<div class="notes-container">';
  const lines = notes.split('\n');
  
  lines.forEach(line => {
    line = line.trim();
    if (!line) return;
    
    if (line.startsWith('# ')) {
      html += `<h3>${line.replace('# ', '')}</h3>`;
    } else if (line.startsWith('## ')) {
      html += `<h4>${line.replace('## ', '')}</h4>`;
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      const text = line.substring(2);
      const processed = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      html += `<li>${processed}</li>`;
    } else if (/^\d+\.\s/.test(line)) {
      const text = line.replace(/^\d+\.\s/, '');
      const processed = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      html += `<li>${processed}</li>`;
    } else if (/\[\d{1,2}:\d{2}\]/.test(line)) {
      html += line.replace(/\[(\d{1,2}:\d{2})\]/g, '<span class="timestamp" data-time="$1">[$1]</span>') + '<br>';
    } else {
      const processed = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      html += processed + '<br>';
    }
  });
  
  html += '</div>';
  document.getElementById('notesResult').innerHTML = html;
  document.getElementById('downloadNotesBtn').style.display = 'flex';
}

// ========== DOWNLOAD PDF ==========

document.getElementById('downloadNotesBtn').addEventListener('click', async () => {
  if (!currentNotes) return;
  
  const btn = document.getElementById('downloadNotesBtn');
  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span> Generating PDF...';
  
  try {
    const res = await fetch(`${BACKEND_URL}/api/download-notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes: currentNotes,
        video_title: currentVideoTitle
      })
    });
    
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || 'Failed to generate PDF');
    }
    
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = currentVideoTitle.replace(/[^a-z0-9]/gi, '_').substring(0, 30);
    a.download = `notes-${safeTitle}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
  } catch (err) {
    alert('Failed to download PDF: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>📥</span> Download as PDF';
  }
});

// ========== DOUBTS (CHAT) ==========

let chatHistory = [];

document.getElementById('askBtn').addEventListener('click', async () => {
  const input = document.getElementById('doubtInput');
  const question = input.value.trim();
  
  if (!question) return;
  
  if (!currentNotes) {
    alert('Please generate notes first!');
    return;
  }
  
  const greetings = ['hi', 'hello', 'hey', 'hii', 'heyy', 'yo'];
  if (greetings.includes(question.toLowerCase())) {
    const greetingMsg = '👋 Hey there! I can answer questions about the video based on your generated notes. What would you like to know?';
    addChatMessage('user', question);
    addChatMessage('ai', greetingMsg);
    input.value = '';
    await saveChatHistory();
    return;
  }
  
  input.value = '';
  addChatMessage('user', question);
  await saveChatHistory();
  
  const container = document.getElementById('chatContainer');
  const aiMsg = document.createElement('div');
  aiMsg.className = 'chat-msg ai';
  aiMsg.innerHTML = `<div class="chat-label">AI</div><div class="spinner" style="width:16px;height:16px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:8px;"></div>Thinking...`;
  container.appendChild(aiMsg);
  container.scrollTop = container.scrollHeight;
  
  try {
    const res = await fetch(`${BACKEND_URL}/api/ask-doubt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: question,
        notes: currentNotes,
        transcript: currentTranscript
      })
    });
    
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    aiMsg.innerHTML = `<div class="chat-label">AI</div>${escapeHtml(data.answer).replace(/\n/g, '<br>')}`;
    
    const aiResponse = data.answer;
    chatHistory.push({ role: 'ai', text: aiResponse });
    await saveToStorage(STORAGE_KEYS.chatHistory, chatHistory);
    
  } catch (err) {
    aiMsg.innerHTML = `<div class="chat-label">AI</div><span style="color:var(--error);">${escapeHtml(err.message)}</span>`;
  }
  
  container.scrollTop = container.scrollHeight;
});

function addChatMessage(role, text) {
  const container = document.getElementById('chatContainer');
  const msg = document.createElement('div');
  msg.className = `chat-msg ${role}`;
  const label = role === 'user' ? 'You' : 'AI';
  msg.innerHTML = `<div class="chat-label">${label}</div>${escapeHtml(text)}`;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
  chatHistory.push({ role, text });
}

async function saveChatHistory() {
  await saveToStorage(STORAGE_KEYS.chatHistory, chatHistory);
}

// ========== QUESTIONS ==========

document.getElementById('generateQuestionsBtn').addEventListener('click', async () => {
  if (!currentNotes) {
    alert('Please generate notes first!');
    return;
  }
  
  const btn = document.getElementById('generateQuestionsBtn');
  btn.disabled = true;
  showLoading('questionsResult', 'Generating questions...', 'Crafting exam-style MCQs');
  
  try {
    const res = await fetch(`${BACKEND_URL}/api/generate-questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes: currentNotes,
        transcript: currentTranscript
      })
    });
    
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    await saveToStorage(STORAGE_KEYS.questions, data.questions);
    renderQuestions(data.questions);
  } catch (err) {
    showError('questionsResult', err.message);
  } finally {
    btn.disabled = false;
  }
});

function renderQuestions(questions) {
  let html = '';
  questions.forEach((q, idx) => {
    html += `
      <div class="question-card">
        <div class="question-number">Question ${idx + 1}</div>
        <div class="question-text">${escapeHtml(q.question)}</div>
        <div class="options">
          ${q.options.map((opt, oIdx) => `
            <div class="option" data-correct="${oIdx === q.correct_index}" data-answered="false">
              <span class="option-letter">${String.fromCharCode(65 + oIdx)}</span>
              <span>${escapeHtml(opt)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  });
  
  document.getElementById('questionsResult').innerHTML = html;
  
  document.querySelectorAll('.option').forEach(opt => {
    opt.addEventListener('click', function() {
      if (this.dataset.answered === 'true') return;
      
      const card = this.closest('.question-card');
      card.querySelectorAll('.option').forEach(o => {
        o.dataset.answered = 'true';
        if (o.dataset.correct === 'true') o.classList.add('correct');
      });
      
      if (this.dataset.correct !== 'true') {
        this.classList.add('wrong');
      }
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getVideoInfo() {
  const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1');
  return {
    title: titleEl ? titleEl.textContent.trim() : 'Unknown Video'
  };
}

// ========== LEARN NEXT ==========

document.getElementById('generateLearnBtn').addEventListener('click', async () => {
  if (!currentNotes) {
    alert('Please generate notes first!');
    return;
  }
  
  const btn = document.getElementById('generateLearnBtn');
  btn.disabled = true;
  showLoading('learnResult', 'Finding what to learn next...', 'AI is analyzing your notes');
  
  try {
    const res = await fetch(`${BACKEND_URL}/api/learn-next`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes: currentNotes,
        video_title: currentVideoTitle
      })
    });
    
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    await saveToStorage(STORAGE_KEYS.recommendations, data.recommendations);
    renderRecommendations(data.recommendations);
    
    const learnStatus = document.getElementById('learnStatus');
    learnStatus.innerHTML = '<span class="status-dot"></span> Recommendations ready';
    learnStatus.className = 'status-badge ready';
    
  } catch (err) {
    document.getElementById('learnResult').innerHTML = `<div class="error-box">Error: ${err.message}</div>`;
  } finally {
    btn.disabled = false;
  }
});

function renderRecommendations(recommendations) {
  let html = '';
  
  recommendations.forEach((rec, idx) => {
    const searchQuery = encodeURIComponent(`${rec.topic} tutorial`);
    const youtubeUrl = `https://www.youtube.com/results?search_query=${searchQuery}`;
    
    html += `
      <div class="recommendation-card">
        <div class="rec-number">${idx + 1}</div>
        <div class="rec-topic">${rec.emoji} ${escapeHtml(rec.topic)}</div>
        <div class="rec-desc">${escapeHtml(rec.description)}</div>
        <span class="rec-difficulty ${rec.difficulty.toLowerCase()}">${rec.difficulty}</span>
        <a class="rec-search" href="${youtubeUrl}" target="_blank">
          <span>🔍</span> Search on YouTube
        </a>
      </div>
    `;
  });
  
  document.getElementById('learnResult').innerHTML = html;
}

const originalUpdateStatus = updateStatus;
updateStatus = function() {
  originalUpdateStatus();
  if (currentNotes) {
    const learnStatus = document.getElementById('learnStatus');
    learnStatus.innerHTML = '<span class="status-dot"></span> Ready for recommendations';
    learnStatus.className = 'status-badge ready';
  }
};

// ========== DASHBOARD BUTTON ==========

document.getElementById('openDashboard')?.addEventListener('click', () => {
  const dashboardUrl = chrome.runtime.getURL('dashboard.html');
  console.log('[Popup] Opening dashboard:', dashboardUrl);
  chrome.tabs.create({ url: dashboardUrl });
});

// ========== STARTUP ==========

initPopup();