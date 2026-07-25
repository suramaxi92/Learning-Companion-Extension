const BACKEND_URL = 'http://localhost:5000';
const SHORTS_KEY = 'notetaker_shortsCount';

let todayChart = null;
let overallChart = null;

const isExtension = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

async function getShortsStats() {
  if (!isExtension) {
    console.log('[Dashboard] Not in extension context, shorts=0');
    return { today: 0, total: 0 };
  }
  
  try {
    const today = new Date().toISOString().split('T')[0];
    const todayKey = `${SHORTS_KEY}_${today}`;
    const allData = await chrome.storage.local.get(null);
    let todayCount = 0;
    let totalCount = 0;
    
    for (const [key, value] of Object.entries(allData)) {
      if (key.startsWith(SHORTS_KEY)) {
        totalCount += value;
        if (key === todayKey) todayCount = value;
      }
    }
    return { today: todayCount, total: totalCount };
  } catch (e) {
    console.error('[Dashboard] Shorts error:', e);
    return { today: 0, total: 0 };
  }
}

async function loadDashboard() {
  try {
    console.log('[Dashboard] Starting load...');
    console.log('[Dashboard] Extension context:', isExtension ? 'YES' : 'NO');
    
    const responses = await Promise.all([
      fetch(`${BACKEND_URL}/api/stats/today`).then(r => {
        if (!r.ok) throw new Error(`Today stats: ${r.status}`);
        return r.json();
      }),
      fetch(`${BACKEND_URL}/api/stats/overall`).then(r => {
        if (!r.ok) throw new Error(`Overall stats: ${r.status}`);
        return r.json();
      }),
      fetch(`${BACKEND_URL}/api/videos/today-learning`).then(r => {
        if (!r.ok) throw new Error(`Today videos: ${r.status}`);
        return r.json();
      }),
      fetch(`${BACKEND_URL}/api/concepts`).then(r => {
        if (!r.ok) throw new Error(`Concepts: ${r.status}`);
        return r.json();
      }),
      getShortsStats()
    ]);
    
    const [todayStats, overallStats, todayVideos, allConcepts, shortsStats] = responses;
    
    console.log('[Dashboard] Data loaded:', {
      today: todayStats,
      overall: overallStats,
      videos: todayVideos.videos?.length || 0,
      concepts: allConcepts.concepts?.length || 0,
      shorts: shortsStats
    });
    
    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';
    
    const today = todayStats.stats || {};
    const overall = overallStats.stats || {};
    
    document.getElementById('totalVideos').textContent = overall.total_videos || 0;
    document.getElementById('learningVideos').textContent = overall.learning_count || 0;
    document.getElementById('todayShorts').textContent = shortsStats.today;
    document.getElementById('totalConcepts').textContent = (allConcepts.concepts || []).length;
    
    if (shortsStats.today > 0) {
      document.getElementById('shortsBar').style.display = 'block';
      document.getElementById('shortsBarCount').textContent = shortsStats.today;
      const maxShorts = 20;
      const pct = Math.min((shortsStats.today / maxShorts) * 100, 100);
      document.getElementById('shortsProgress').style.width = pct + '%';
      let label = 'Low';
      if (shortsStats.today >= 15) label = 'Critical ⚠️';
      else if (shortsStats.today >= 10) label = 'High';
      else if (shortsStats.today >= 5) label = 'Moderate';
      document.getElementById('shortsLabel').textContent = label;
    }
    
    renderTodayChart(today);
    renderOverallChart(overall);
    renderTodayVideos(todayVideos.videos || []);
    renderConcepts(allConcepts.concepts || []);
    
    // Load recommendations based on learned concepts
    await loadRecommendations(allConcepts.concepts || []);
    
  } catch (err) {
    console.error('[Dashboard] Load error:', err);
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('errorMessage').textContent = 
      `Failed to load: ${err.message}. Make sure backend is running at ${BACKEND_URL}`;
  }
}

function renderTodayChart(stats) {
  const ctx = document.getElementById('todayChart').getContext('2d');
  const learning = stats.learning_count || 0;
  const nonLearning = stats.non_learning_count || 0;
  
  if (todayChart) todayChart.destroy();
  todayChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Learning', 'Non-Learning'],
      datasets: [{
        data: [learning, nonLearning],
        backgroundColor: ['#4ade80', '#fbbf24'],
        borderColor: '#16162a',
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#a0a0b0', padding: 20, font: { size: 12, family: 'Inter' } }
        }
      },
      cutout: '65%'
    }
  });
}

function renderOverallChart(stats) {
  const ctx = document.getElementById('overallChart').getContext('2d');
  const learning = stats.learning_count || 0;
  const nonLearning = stats.non_learning_count || 0;
  
  if (overallChart) overallChart.destroy();
  overallChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Learning', 'Non-Learning'],
      datasets: [{
        data: [learning, nonLearning],
        backgroundColor: ['#4ade80', '#fbbf24'],
        borderColor: '#16162a',
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#a0a0b0', padding: 20, font: { size: 12, family: 'Inter' } }
        }
      },
      cutout: '65%'
    }
  });
}

function renderTodayVideos(videos) {
  const container = document.getElementById('todayVideosList');
  if (videos.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><div class="empty-icon">📭</div><div>No learning videos today</div></div>`;
    return;
  }
  container.innerHTML = videos.map(v => `
    <a href="${v.video_url}" target="_blank" class="video-card">
      <div class="video-badge learning"><span>🎓</span> Learning</div>
      <div class="video-title">${escapeHtml(v.video_title)}</div>
      <div class="video-meta">🕐 ${formatTime(v.watched_at)} • 📊 ${(v.confidence_score * 100).toFixed(0)}% confidence</div>
    </a>
  `).join('');
}

function renderConcepts(concepts) {
  const container = document.getElementById('conceptsList');
  if (concepts.length === 0) {
    container.innerHTML = `<div class="empty-state" style="width: 100%;"><div class="empty-icon">🧠</div><div>No concepts yet</div></div>`;
    return;
  }
  
  const grouped = {};
  concepts.forEach(c => {
    const cat = c.category || 'General';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(c);
  });
  
  let html = '';
  Object.entries(grouped).sort((a, b) => b[1].length - a[1].length).forEach(([cat, items]) => {
    html += `<div style="width: 100%; margin-bottom: 16px;">`;
    html += `<div style="font-size: 12px; color: var(--text-muted); text-transform: uppercase; font-weight: 600; margin-bottom: 10px;">${escapeHtml(cat)} (${items.length})</div>`;
    html += `<div style="display: flex; flex-wrap: wrap; gap: 10px;">`;
    items.forEach(c => {
      html += `<div class="concept-tag"><span class="concept-name">${escapeHtml(c.concept_name)}</span><div class="concept-category">Seen ${c.review_count}x</div></div>`;
    });
    html += `</div></div>`;
  });
  container.innerHTML = html;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(ts) {
  if (!ts) return 'Unknown';
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

document.addEventListener('DOMContentLoaded', loadDashboard);


// ============== RECOMMENDATIONS ==============

const RECOMMENDATIONS_CACHE_KEY = 'notetaker_recommendations_cache';
const RECOMMENDATIONS_CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

async function getCachedRecommendations() {
  try {
    const result = await chrome.storage.local.get(RECOMMENDATIONS_CACHE_KEY);
    const cached = result[RECOMMENDATIONS_CACHE_KEY];
    if (!cached) return null;

    const now = Date.now();
    if (now - cached.timestamp > RECOMMENDATIONS_CACHE_DURATION_MS) {
      console.log('[Dashboard] Recommendations cache expired');
      await chrome.storage.local.remove(RECOMMENDATIONS_CACHE_KEY);
      return null;
    }

    console.log('[Dashboard] Using cached recommendations');
    return cached.data;
  } catch (e) {
    console.error('[Dashboard] Cache read error:', e);
    return null;
  }
}

async function setCachedRecommendations(data) {
  try {
    await chrome.storage.local.set({
      [RECOMMENDATIONS_CACHE_KEY]: {
        timestamp: Date.now(),
        data: data
      }
    });
    console.log('[Dashboard] Recommendations cached');
  } catch (e) {
    console.error('[Dashboard] Cache write error:', e);
  }
}

async function loadRecommendations(concepts) {
  const section = document.getElementById('recommendationsSection');
  const btn = document.getElementById('generateRecommendationsBtn');
  const loading = document.getElementById('recommendationsLoading');
  const list = document.getElementById('recommendationsList');

  if (!concepts || concepts.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';

  // Try to load from cache first
  const cached = await getCachedRecommendations();
  if (cached && cached.recommendations && cached.recommendations.length > 0) {
    renderRecommendations(cached.recommendations, true);
    return;
  }

  // Show generate button if no cache
  btn.style.display = 'inline-flex';
  loading.style.display = 'none';
  list.innerHTML = `
    <div class="rec-empty" style="grid-column: 1 / -1;">
      <div class="empty-icon">🎯</div>
      <div>Generate personalized recommendations based on your learned concepts</div>
    </div>
  `;
}

async function generateRecommendations(concepts) {
  const btn = document.getElementById('generateRecommendationsBtn');
  const loading = document.getElementById('recommendationsLoading');
  const list = document.getElementById('recommendationsList');

  btn.style.display = 'none';
  loading.style.display = 'block';
  list.innerHTML = '';

  try {
    const res = await fetch(`${BACKEND_URL}/api/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concepts: concepts })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    // Cache the results
    await setCachedRecommendations(data);

    renderRecommendations(data.recommendations, false);

  } catch (err) {
    console.error('[Dashboard] Recommendations error:', err);
    list.innerHTML = `
      <div class="error-box" style="grid-column: 1 / -1;">
        <div>Failed to load recommendations: ${escapeHtml(err.message)}</div>
        <button onclick="retryRecommendations()" style="margin-top: 12px; padding: 8px 20px; background: var(--accent); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">Retry</button>
      </div>
    `;
    btn.style.display = 'inline-flex';
    loading.style.display = 'none';
  }
}

function renderRecommendations(recommendations, isCached) {
  const btn = document.getElementById('generateRecommendationsBtn');
  const loading = document.getElementById('recommendationsLoading');
  const list = document.getElementById('recommendationsList');

  btn.style.display = 'inline-flex';
  loading.style.display = 'none';

  if (!recommendations || recommendations.length === 0) {
    list.innerHTML = `
      <div class="rec-empty" style="grid-column: 1 / -1;">
        <div class="empty-icon">🎯</div>
        <div>No recommendations available. Try generating again.</div>
      </div>
    `;
    return;
  }

  // Group by category
  const grouped = {};
  recommendations.forEach(r => {
    const cat = r.category || 'General';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(r);
  });

  let html = '';

  Object.entries(grouped).forEach(([cat, items]) => {
    html += `<div style="width: 100%; margin-bottom: 20px;">`;
    html += `<div style="font-size: 12px; color: var(--text-muted); text-transform: uppercase; font-weight: 600; margin-bottom: 12px; letter-spacing: 0.5px;">${escapeHtml(cat)}</div>`;
    html += `<div class="videos-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px;">`;

    items.forEach((rec, idx) => {
      const searchQuery = encodeURIComponent(`${rec.topic} tutorial`);
      const youtubeUrl = `https://www.youtube.com/results?search_query=${searchQuery}`;
      const diffClass = rec.difficulty.toLowerCase();

      html += `
        <div class="recommendation-card">
          <div class="rec-category">${escapeHtml(cat)}</div>
          <div class="rec-topic">${rec.emoji} ${escapeHtml(rec.topic)}</div>
          <div class="rec-desc">${escapeHtml(rec.description)}</div>
          <div class="rec-meta">
            <span class="rec-difficulty ${diffClass}">${rec.difficulty}</span>
            <a class="rec-search-btn" href="${youtubeUrl}" target="_blank">
              <span>🔍</span> Search on YouTube
            </a>
          </div>
        </div>
      `;
    });

    html += `</div></div>`;
  });

  if (isCached) {
    html += `
      <div style="width: 100%; text-align: center; margin-top: 8px;">
        <span class="rec-cached-badge">
          <span>💾</span> Cached • <button onclick="refreshRecommendations()" style="background: none; border: none; color: var(--accent); cursor: pointer; font-size: 11px; font-weight: 600; text-decoration: underline;">Refresh</button>
        </span>
      </div>
    `;
  }

  list.innerHTML = html;
}

async function retryRecommendations() {
  const allConcepts = await fetch(`${BACKEND_URL}/api/concepts`).then(r => r.json());
  generateRecommendations(allConcepts.concepts || []);
}

async function refreshRecommendations() {
  await chrome.storage.local.remove(RECOMMENDATIONS_CACHE_KEY);
  const allConcepts = await fetch(`${BACKEND_URL}/api/concepts`).then(r => r.json());
  generateRecommendations(allConcepts.concepts || []);
}

// Wire up the generate button
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('generateRecommendationsBtn');
  if (btn) {
    btn.addEventListener('click', async () => {
      const allConcepts = await fetch(`${BACKEND_URL}/api/concepts`).then(r => r.json());
      generateRecommendations(allConcepts.concepts || []);
    });
  }
});
