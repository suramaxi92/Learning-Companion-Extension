const BACKEND_URL = 'http://localhost:5000';

let currentVideoId = null;
let currentVideoTitle = '';
let currentTranscript = '';
let currentNotes = '';

// Tab switching
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  const tab = tabs[0];
  if (!tab.url || !tab.url.includes('youtube.com/watch')) {
    document.querySelectorAll('.video-title').forEach(el => {
      el.textContent = 'Open a YouTube video';
    });
    return;
  }
  
  const url = new URL(tab.url);
  currentVideoId = url.searchParams.get('v');
  
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: getVideoInfo
  }, (results) => {
    if (results && results[0] && results[0].result) {
      const info = results[0].result;
      currentVideoTitle = info.title;
      document.querySelectorAll('.video-title').forEach(el => {
        el.textContent = info.title.length > 45 ? info.title.substring(0, 45) + '...' : info.title;
      });
    }
  });
});

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
  if (currentTranscript) {
    generateNotesFromTranscript();
    return;
  }
  
  if (!currentVideoId) return;
  
  const btn = document.getElementById('generateNotesBtn');
  btn.disabled = true;
  showLoading('notesResult', 'Extracting transcript...', 'This may take a few seconds');
  
  try {
    const transcriptRes = await fetch(`${BACKEND_URL}/api/transcript/${currentVideoId}`);
    const transcriptData = await transcriptRes.json();
    
    if (transcriptData.success) {
      currentTranscript = transcriptData.transcript;
      generateNotesFromTranscript();
      return;
    }
    
    showManualTranscriptFallback(transcriptData.error || 'Auto-extraction unavailable');
    
  } catch (err) {
    showManualTranscriptFallback('Cannot connect to backend');
  } finally {
    btn.disabled = false;
  }
});

function showManualTranscriptFallback(errorMsg) {
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
  
  document.getElementById('manualGenerateBtn').addEventListener('click', () => {
    const manualText = document.getElementById('manualTranscript').value.trim();
    if (!manualText) {
      alert('Please paste a transcript first!');
      return;
    }
    currentTranscript = manualText;
    generateNotesFromTranscript();
  });
}

async function generateNotesFromTranscript() {
  if (!currentTranscript) return;
  
  const btn = document.getElementById('generateNotesBtn');
  btn.disabled = true;
  showLoading('notesResult', 'Generating notes...', 'AI is analyzing the content');
  
  try {
    const notesRes = await fetch(`${BACKEND_URL}/api/generate-notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        transcript: currentTranscript,
        video_title: currentVideoTitle 
      })
    });
    
    const notesData = await notesRes.json();
    if (notesData.error) throw new Error(notesData.error);
    
    currentNotes = notesData.notes;
    renderNotes(notesData.notes);
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
}

// ========== DOUBTS ==========
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
    addChatMessage('ai', '👋 Hey there! I can answer questions about the video based on your generated notes. What would you like to know?');
    input.value = '';
    return;
  }
  
  input.value = '';
  addChatMessage('user', question);
  
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