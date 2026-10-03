# 🎬 YouTube NoteTaker

AI-powered Chrome Extension that turns YouTube videos into structured study notes, quizzes, and personalized learning recommendations.

![Python](https://img.shields.io/badge/Python-3.10%2B-blue)
![Flask](https://img.shields.io/badge/Flask-3.0-green)
![Chrome](https://img.shields.io/badge/Chrome%20Extension-MV3-yellow)

---

## ✨ What It Does

- 📝 **Auto-generates study notes** with timestamps, headings & key concepts
- ❓ **Answers your doubts** based only on the video content
- 📋 **Creates practice MCQs** with difficulty levels
- 📚 **Suggests what to learn next** based on your progress
- 📊 **Tracks your learning** via a visual dashboard
- 📱 **Monitors Shorts usage** to keep you focused

---

## 🏗️ Stack

| Layer | Tech |
| --- | --- |
| **Backend** | Flask + PyMySQL + Groq AI |
| **Extension** | Vanilla JS + Chrome Storage API |
| **Dashboard** | Chart.js + HTML/CSS |
| **AI Model** | `openai/gpt-oss-20b` via Groq |

---

## 🚀 Quick Start

```bash
# 1. Clone & setup
git clone https://github.com/suramaxi92/Learning-Companion-Extension.git
cd youtube-notetaker
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# 2. Configure
cp .env.example .env
# Edit .env with your Groq API key & MySQL credentials

# 3. Start backend
python app.py        # Runs on localhost:5000

# 4. Load extension
Chrome → Extensions → Developer Mode → Load Unpacked → Select project folder
```

---

## 📁 Structure

```javascript
├── app.py              # Flask API routes
├── db.py               # MySQL wrapper
├── requirements.txt    # Python deps
├── manifest.json       # Extension config
├── popup.html/js       # Extension popup UI
├── content.js          # YouTube page bridge
├── injected.js         # Caption extractor
├── dashboard.html/js   # Learning dashboard
└── .env                # Secrets (not in git)
```

---

## 🔌 API Endpoints

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/generate-notes` | POST | Generate notes + extract concepts |
| `/api/ask-doubt` | POST | Q&A from video content |
| `/api/generate-questions` | POST | Create 5 MCQs |
| `/api/learn-next` | POST | Topic recommendations |
| `/api/recommendations` | POST | Smart suggestions by category |
| `/api/download-notes` | POST | Export PDF |
| `/api/stats/*` | GET | Learning analytics |
| `/api/concepts` | GET | All learned concepts |
| `/health` | GET | Health check |

---

## ⚙️ Environment Variables

```env
GROQ_API_KEY=your_key_here
GROQ_MODEL=openai/gpt-oss-20b
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_pass
DB_NAME=notetaker_db
```

---

## 🐛 Common Issues

**Groq 404 Error?**
Model `llama-3.1-8b-instant` is deprecated. Update to `openai/gpt-oss-20b`:

```python
# app.py
DEFAULT_MODEL = "openai/gpt-oss-20b"
```

**Transcript fails?** Paste it manually — YouTube's internal API changes frequently.

**DB error?** Run `curl -X POST http://localhost:5000/api/init-db`

---

## 🛡️ Security

- Never commit `.env` files
- Move the hardcoded API key in `app.py` to environment variables
- Rotate keys regularly

---

## 📄 License

MIT — see [LICENSE](LICENSE)
