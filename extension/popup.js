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
    showError('Please open a YouTube video first.');
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
      updateVideoInfo(info.title);
    }
  });
});

function updateVideoInfo(title) {
  const truncated = title.length > 50 ? title.substring(0, 50) + '...' : title;
  document.querySelectorAll('.video-info').forEach(el => {
    el.innerHTML = `<strong>Video:</strong> ${truncated}`;
  });
}

function showError(msg) {
  document.querySelectorAll('.tab-content').forEach(el => {
    el.innerHTML = `<div class="error">${msg}</div>`;
  });
}

function showLoading(containerId, text = 'Processing...') {
  document.getElementById(containerId).innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <div>${text}</div>
    </div>
  `;
}

function updateStatus() {
  const notesStatus = document.getElementById('notesStatus');
  const questionsStatus = document.getElementById('questionsStatus');
  
  if (currentNotes) {
    notesStatus.textContent = '✓ Notes ready — ask away!';
    notesStatus.className = 'status-badge ready';
    questionsStatus.textContent = '✓ Notes ready — generate questions!';
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
  showLoading('notesResult', 'Extracting transcript & generating notes...');
  
  try {
    const transcriptRes = await fetch(`${BACKEND_URL}/api/transcript/${currentVideoId}`);
    const transcriptData = await transcriptRes.json();
    
    if (transcriptData.success) {
      currentTranscript = transcriptData.transcript;
      generateNotesFromTranscript();
      return;
    }
    
    showManualTranscriptFallback(transcriptData.error || 'Could not extract captions automatically.');
    
  } catch (err) {
    showManualTranscriptFallback('Could not connect to backend. Make sure Flask is running on port 5000.');
  } finally {
    btn.disabled = false;
  }
});

function showManualTranscriptFallback(errorMsg) {
  document.getElementById('notesResult').innerHTML = `
    <div style="margin-bottom: 16px;">
      <div class="error" style="margin-bottom: 12px;">⚠️ ${errorMsg}</div>
      <div style="font-size: 12px; color: #888; margin-bottom: 12px; line-height: 1.6;">
        <strong>You can paste the transcript manually:</strong><br>
        1. Click the <code style="background:#252525;padding:2px 6px;border-radius:4px;color:#ff8888;">⋯</code> (More) button below the YouTube video<br>
        2. Click <code style="background:#252525;padding:2px 6px;border-radius:4px;color:#ff8888;">Show transcript</code><br>
        3. Copy the transcript and paste it below
      </div>
      <textarea id="manualTranscript" style="
        width: 100%;
        padding: 12px;
        background: #1a1a1a;
        border: 1px solid #333;
        border-radius: 8px;
        color: #fff;
        font-size: 12px;
        min-height: 120px;
        resize: vertical;
        font-family: 'Segoe UI', system-ui, sans-serif;
      " placeholder="Paste YouTube transcript here..."></textarea>
      <button id="manualGenerateBtn" style="
        width: 100%;
        padding: 12px;
        background: linear-gradient(135deg, #ff0000, #cc0000);
        border: none;
        border-radius: 8px;
        color: white;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        margin-top: 10px;
      ">Generate Notes from Pasted Transcript</button>
    </div>
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
  showLoading('notesResult', 'Generating notes with AI...');
  
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
    document.getElementById('notesResult').innerHTML = `<div class="error">Error: ${err.message}</div>`;
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
      html += `<h4 style="color:#ff6666;margin:10px 0 6px;font-size:13px;">${line.replace('## ', '')}</h4>`;
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
  
  // Don't answer generic greetings as if they're about the video
  const greetings = ['hi', 'hello', 'hey', 'hii', 'heyy'];
  if (greetings.includes(question.toLowerCase())) {
    addChatMessage('ai', 'Hello! 👋 I can answer questions about the video content based on the notes you generated. What would you like to know?');
    input.value = '';
    return;
  }
  
  input.value = '';
  const container = document.getElementById('chatContainer');
  
  addChatMessage('user', question);
  
  const aiMsg = document.createElement('div');
  aiMsg.className = 'chat-msg ai';
  aiMsg.innerHTML = `<div class="chat-label">AI</div><div class="spinner" style="width:20px;height:20px;border-width:2px;"></div>`;
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
    aiMsg.innerHTML = `<div class="chat-label">AI</div><span style="color:#ff7f7f;">Error: ${err.message}</span>`;
  }
  
  container.scrollTop = container.scrollHeight;
});

function addChatMessage(role, text) {
  const container = document.getElementById('chatContainer');
  const msg = document.createElement('div');
  msg.className = `chat-msg ${role}`;
  const label = role === 'user' ? 'YOU' : 'AI';
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
  showLoading('questionsResult', 'Generating exam-style questions...');
  
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
    document.getElementById('questionsResult').innerHTML = `<div class="error">Error: ${err.message}</div>`;
  } finally {
    btn.disabled = false;
  }
});

function renderQuestions(questions) {
  let html = '';
  questions.forEach((q, idx) => {
    html += `
      <div class="question-card" data-idx="${idx}">
        <div class="question-text">${idx + 1}. ${escapeHtml(q.question)}</div>
        <div class="options">
          ${q.options.map((opt, oIdx) => `
            <div class="option" data-correct="${oIdx === q.correct_index}" data-answered="false">
              ${String.fromCharCode(65 + oIdx)}. ${escapeHtml(opt)}
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