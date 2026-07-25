from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import os
import json
import time
import requests
import io
import re
import traceback
from datetime import datetime
from dotenv import load_dotenv
from db import db

load_dotenv()

app = Flask(__name__)
CORS(app, origins=["chrome-extension://*"])

GROQ_API_KEY = os.getenv('GROQ_API_KEY', 'lol')
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_MODEL = "llama-3.1-8b-instant"

last_request_time = 0
MIN_DELAY = 1

def call_groq(prompt, model=DEFAULT_MODEL):
    global last_request_time
    elapsed = time.time() - last_request_time
    if elapsed < MIN_DELAY:
        time.sleep(MIN_DELAY - elapsed)
    last_request_time = time.time()
    
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a helpful educational assistant."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.7,
        "max_tokens": 4000
    }
    
    try:
        response = requests.post(GROQ_URL, headers=headers, json=payload, timeout=60)
        response.raise_for_status()
        data = response.json()
        
        if "choices" in data and len(data["choices"]) > 0:
            return {"success": True, "text": data["choices"][0]["message"]["content"]}
        elif "error" in data:
            return {"success": False, "error": data["error"].get("message", str(data["error"]))}
        else:
            return {"success": False, "error": f"Unexpected response: {json.dumps(data)}"}
    except requests.exceptions.HTTPError as e:
        if response.status_code == 401:
            return {"success": False, "error": "Invalid API key. Check your Groq key."}
        if response.status_code == 429:
            return {"success": False, "error": "Rate limited. Please wait a moment."}
        return {"success": False, "error": f"HTTP {response.status_code}: {str(e)}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

# ============== CLASSIFICATION ==============

def classify_learning_video(video_title, transcript):
    prompt = f"""Analyze this YouTube video and determine if it is EDUCATIONAL/LEARNING related.

Video Title: {video_title}
Transcript (first 2000 chars): {transcript[:2000]}

IMPORTANT: Respond with ONLY a JSON object. No markdown, no explanation, just raw JSON:
{{"is_learning_related": true, "confidence": 0.95, "reasoning": "brief reason"}}

Rules:
- TRUE if: tutorial, course, lesson, how-to, explanation, educational, academic, skill-building, coding, programming, language learning, science, math, history, etc.
- FALSE if: music, vlog, entertainment, gaming, movie, comedy, sports, news commentary (unless educational), pure reaction videos
- Be generous: coding tutorials, tech reviews with teaching, and explainers ARE learning-related."""

    result = call_groq(prompt)
    print(f"[CLASSIFY] Raw: {result}")
    
    if not result["success"]:
        print(f"[CLASSIFY] API error: {result['error']}")
        title_lower = video_title.lower()
        learning_keywords = ['tutorial', 'course', 'learn', 'lesson', 'python', 'javascript', 'programming', 'coding', 'how to', 'beginner', 'introduction', 'explained']
        is_likely = any(kw in title_lower for kw in learning_keywords)
        return {"is_learning_related": is_likely, "confidence": 0.5, "error": result["error"]}
    
    try:
        text = result["text"].strip()
        if text.startswith('```json'): text = text[7:]
        if text.startswith('```'): text = text[3:]
        if text.endswith('```'): text = text[:-3]
        text = text.strip()
        
        classification = json.loads(text)
        is_learning = classification.get("is_learning_related", False)
        if isinstance(is_learning, str):
            is_learning = is_learning.lower() == "true"
        confidence = float(classification.get("confidence", 0.5))
        
        print(f"[CLASSIFY] Result: learning={is_learning}, confidence={confidence}")
        return {"is_learning_related": is_learning, "confidence": confidence, "reasoning": classification.get("reasoning", "")}
    except Exception as e:
        print(f"[CLASSIFY] Parse error: {e}")
        title_lower = video_title.lower()
        learning_keywords = ['tutorial', 'course', 'learn', 'lesson', 'python', 'javascript', 'programming', 'coding', 'how to', 'beginner', 'introduction', 'explained']
        is_likely = any(kw in title_lower for kw in learning_keywords)
        return {"is_learning_related": is_likely, "confidence": 0.5, "error": f"Parse failed: {str(e)}"}

# ============== CONCEPT EXTRACTION ==============

def extract_concepts_from_notes(notes, video_title):
    print(f"[CONCEPTS] Extracting for: {video_title}")
    
    prompt = f"""Extract key concepts from these study notes as JSON.

Video Title: {video_title}
NOTES: {notes[:8000]}

Return ONLY valid JSON array:
[
  {{"concept": "Neural Network", "category": "Machine Learning", "confidence": 0.95}},
  {{"concept": "Backpropagation", "category": "Algorithms", "confidence": 0.92}}
]"""

    result = call_groq(prompt)
    print(f"[CONCEPTS] Groq success={result['success']}")
    
    if not result["success"]:
        return []
    
    try:
        text = result["text"].strip()
        if text.startswith('```json'): text = text[7:]
        if text.startswith('```'): text = text[3:]
        if text.endswith('```'): text = text[:-3]
        text = text.strip()
        
        concepts = json.loads(text)
        valid = []
        for c in concepts:
            if 'concept' in c and 'category' in c:
                valid.append({
                    "concept": str(c["concept"]).strip(),
                    "category": str(c["category"]).strip(),
                    "confidence": float(c.get("confidence", 0.8))
                })
        print(f"[CONCEPTS] Valid: {len(valid)}")
        return valid
    except Exception as e:
        print(f"[CONCEPTS] Error: {e}")
        return []

# ============== PDF ==============

def strip_emojis(text):
    emoji_pattern = re.compile("[" "\U0001F600-\U0001F64F" "\U0001F300-\U0001F5FF" "\U0001F680-\U0001F6FF" "\U0001F1E0-\U0001F1FF" "\U00002702-\U000027B0" "\U000024C2-\U0001F251" "]+", flags=re.UNICODE)
    return emoji_pattern.sub(r'', text)

def generate_notes_pdf(notes_text, video_title='YouTube Video'):
    from fpdf import FPDF
    
    class NotesPDF(FPDF):
        def header(self):
            self.set_font('Helvetica', 'B', 16)
            self.set_text_color(220, 38, 38)
            self.cell(0, 12, 'YouTube NoteTaker', 0, 1, 'C')
            self.set_font('Helvetica', '', 10)
            self.set_text_color(120, 120, 120)
            self.cell(0, 6, 'Generated Study Notes', 0, 1, 'C')
            self.ln(4)
            self.set_draw_color(220, 38, 38)
            self.set_line_width(0.5)
            self.line(15, self.get_y(), 195, self.get_y())
            self.ln(6)
        def footer(self):
            self.set_y(-15)
            self.set_font('Helvetica', 'I', 8)
            self.set_text_color(150, 150, 150)
            self.cell(0, 10, f'Page {self.page_no()}', 0, 0, 'C')
    
    pdf = NotesPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()
    
    safe_title = strip_emojis(video_title)
    pdf.set_font('Helvetica', 'B', 14)
    pdf.set_text_color(40, 40, 40)
    pdf.cell(0, 10, safe_title.encode('latin-1', 'replace').decode('latin-1'), 0, 1, 'L')
    
    pdf.set_font('Helvetica', 'I', 9)
    pdf.set_text_color(150, 150, 150)
    date_str = f'Generated on {datetime.now().strftime("%B %d, %Y at %I:%M %p")}'
    pdf.cell(0, 6, date_str.encode('latin-1', 'replace').decode('latin-1'), 0, 1, 'L')
    pdf.ln(4)
    
    lines = notes_text.split('\n')
    for line in lines:
        line = line.strip()
        if not line:
            pdf.ln(2)
            continue
        has_bold = '**' in line
        clean_line = line.replace('**', '')
        clean_line = strip_emojis(clean_line)
        safe_line = clean_line.encode('latin-1', 'replace').decode('latin-1')
        
        if safe_line.startswith('# '):
            pdf.set_font('Helvetica', 'B', 16)
            pdf.set_text_color(220, 38, 38)
            pdf.ln(4)
            pdf.cell(0, 10, safe_line[2:], 0, 1, 'L')
            pdf.set_font('Helvetica', '', 11)
            pdf.set_text_color(40, 40, 40)
        elif safe_line.startswith('## '):
            pdf.set_font('Helvetica', 'B', 13)
            pdf.set_text_color(80, 80, 80)
            pdf.ln(2)
            pdf.cell(0, 8, safe_line[3:], 0, 1, 'L')
            pdf.set_font('Helvetica', '', 11)
            pdf.set_text_color(40, 40, 40)
        elif safe_line.startswith('- ') or safe_line.startswith('* '):
            text = safe_line[2:]
            pdf.set_x(20)
            pdf.set_font('Helvetica', '', 11)
            pdf.cell(5, 6, chr(149), 0, 0, 'L')
            if has_bold:
                pdf.set_font('Helvetica', 'B', 11)
            pdf.multi_cell(0, 6, text)
            pdf.set_font('Helvetica', '', 11)
        else:
            if has_bold:
                pdf.set_font('Helvetica', 'B', 11)
            pdf.multi_cell(0, 6, safe_line)
            pdf.set_font('Helvetica', '', 11)
    
    pdf_output = pdf.output(dest='S')
    if isinstance(pdf_output, str):
        pdf_output = pdf_output.encode('latin-1')
    return io.BytesIO(pdf_output)

# ============== ROUTES ==============

@app.route('/api/transcript/<video_id>', methods=['GET'])
def get_transcript(video_id):
    return jsonify({"error": "Auto-extraction not available. Please paste transcript manually."}), 400

@app.route('/api/generate-notes', methods=['POST'])
def generate_notes():
    data = request.json
    transcript = data.get('transcript', '')
    video_title = data.get('video_title', 'YouTube Video')
    video_id = data.get('video_id', '')
    
    if not transcript:
        return jsonify({"error": "No transcript provided"}), 400
    
    try:
        print(f"[NOTES] Starting for video: {video_id}")
        
        # Save video
        video_url = f"https://youtube.com/watch?v={video_id}" if video_id else ''
        db.save_video(video_id, video_title, video_url, transcript, None)
        print("[NOTES] Video saved")
        
        # Classify
        classification = classify_learning_video(video_title, transcript)
        is_learning = classification.get("is_learning_related", False)
        confidence = classification.get("confidence", 0)
        db.update_video_learning_status(video_id, is_learning, confidence)
        print(f"[NOTES] Classified: learning={is_learning}, confidence={confidence}")
        
        # Generate notes with concepts in ONE call
        prompt = f"""Analyze this video transcript and produce structured study notes plus concept extraction.

VIDEO TITLE: {video_title}
TRANSCRIPT:
{transcript[:15000]}

You must respond with ONLY a JSON object. No markdown code blocks, no extra text before or after.

The JSON must have exactly this structure:
{{
  "notes": "string with formatted notes",
  "concepts": [
    {{"concept": "string", "category": "string", "confidence": number}}
  ]
}}

NOTES FORMATTING RULES:
- Use # for main headings
- Use ## for subheadings  
- Use - for bullet points
- Wrap important terms in **bold**
- Include timestamps like [MM:SS] where relevant
- End with a brief summary

CONCEPTS RULES:
- Extract 3 to 10 core concepts from the content
- Each concept name should be 1-4 words
- Category examples: Programming, Mathematics, Science, Algorithms, Data Structures, Web Development, Machine Learning, Databases, Security, General
- Confidence is a decimal between 0.0 and 1.0

EXAMPLE RESPONSE:
{{
  "notes": "# Introduction to Python\\n\\n## Variables\\n- Variables store data using **assignment** [01:23]\\n- Use descriptive names for readability\\n\\n## Functions\\n- Functions encapsulate reusable logic [03:45]\\n- Use **def** keyword to define\\n\\n## Summary\\nPython basics covered variables and functions.",
  "concepts": [
    {{"concept": "Variables", "category": "Programming", "confidence": 0.95}},
    {{"concept": "Functions", "category": "Programming", "confidence": 0.92}},
    {{"concept": "Assignment", "category": "Programming", "confidence": 0.88}}
  ]
}}

Now generate the JSON for this video:"""

        result = call_groq(prompt)
        if not result["success"]:
            return jsonify({"error": result["error"]}), 500
        
        raw_text = result["text"].strip()
        print(f"[NOTES] Raw response (first 300 chars): {raw_text[:300]}")
        
        # Clean up the response
        text = raw_text
        if text.startswith('```json'):
            text = text[7:]
        elif text.startswith('```'):
            text = text[3:]
        if text.endswith('```'):
            text = text[:-3]
        text = text.strip()
        
        # Try to find JSON if there's extra text
        try:
            # Find the first { and last }
            start = text.find('{')
            end = text.rfind('}')
            if start != -1 and end != -1:
                text = text[start:end+1]
            
            parsed = json.loads(text)
            notes = parsed["notes"]
            concepts = parsed.get("concepts", [])
            print(f"[NOTES] Parsed OK: notes={len(notes)} chars, concepts={len(concepts)}")
            
        except Exception as e:
            print(f"[NOTES] JSON parse failed: {e}")
            print(f"[NOTES] Full raw text: {raw_text[:800]}")
            # Fallback: use raw text as notes, no concepts
            notes = raw_text
            concepts = []
        
        # Save notes
        db.save_video(video_id, video_title, video_url, transcript, notes)
        print("[NOTES] Notes saved")
        
        # Save concepts if learning
        concepts_saved = []
        if is_learning and concepts:
            print(f"[NOTES] Saving {len(concepts)} concepts...")
            for c in concepts:
                concept_name = str(c.get("concept", "")).strip()
                category = str(c.get("category", "General")).strip()
                conf = float(c.get("confidence", 0.8))
                if concept_name:
                    db.save_concept(concept_name, category, video_id, conf)
                    concepts_saved.append({"concept": concept_name, "category": category, "confidence": conf})
            print(f"[NOTES] Saved {len(concepts_saved)} concepts")
        
        return jsonify({
            "success": True,
            "notes": notes,
            "is_learning_related": is_learning,
            "confidence": confidence,
            "concepts_extracted": len(concepts_saved),
            "concepts": concepts_saved
        })
        
    except Exception as e:
        print(f"[NOTES] CRASH: {str(e)}")
        print(f"[NOTES] TRACEBACK: {traceback.format_exc()}")
        return jsonify({"error": f"Server error: {str(e)}"}), 500

@app.route('/api/ask-doubt', methods=['POST'])
def ask_doubt():
    data = request.json
    question = data.get('question', '')
    notes = data.get('notes', '')
    transcript = data.get('transcript', '')
    
    if not question:
        return jsonify({"error": "No question provided"}), 400
    
    prompt = f"""Answer based ONLY on these notes and transcript.

VIDEO NOTES: {notes[:8000]}
TRANSCRIPT: {transcript[:4000]}
QUESTION: {question}

Be clear, concise, educational. If answer isn't in notes, say so."""

    result = call_groq(prompt)
    if result["success"]:
        return jsonify({"success": True, "answer": result["text"]})
    return jsonify({"error": result["error"]}), 500

@app.route('/api/generate-questions', methods=['POST'])
def generate_questions():
    data = request.json
    notes = data.get('notes', '')
    transcript = data.get('transcript', '')
    
    if not notes:
        return jsonify({"error": "No notes provided"}), 400
    
    prompt = f"""Create 5 exam-style MCQs based on these notes.

VIDEO NOTES: {notes[:12000]}

Rules: 4 options each, 1 correct, vary difficulty (2 easy, 2 medium, 1 hard).

Return ONLY valid JSON array:
[
  {{"question": "...", "options": ["A", "B", "C", "D"], "correct_index": 1, "explanation": "..."}}
]"""

    result = call_groq(prompt)
    if not result["success"]:
        return jsonify({"error": result["error"]}), 500
    
    text = result["text"].strip()
    if text.startswith('```json'): text = text[7:]
    if text.startswith('```'): text = text[3:]
    if text.endswith('```'): text = text[:-3]
    text = text.strip()
    
    try:
        questions = json.loads(text)
        for q in questions:
            assert 'question' in q
            assert 'options' in q and len(q['options']) == 4
            assert 'correct_index' in q
            assert 0 <= q['correct_index'] <= 3
        return jsonify({"success": True, "questions": questions})
    except Exception as e:
        return jsonify({"error": f"Failed to parse: {str(e)}"}), 500

@app.route('/api/learn-next', methods=['POST'])
def learn_next():
    data = request.json
    notes = data.get('notes', '')
    video_title = data.get('video_title', 'YouTube Video')
    
    if not notes:
        return jsonify({"error": "No notes provided"}), 400
    
    prompt = f"""Suggest 5 related topics to learn next.

VIDEO TITLE: {video_title}
NOTES: {notes[:10000]}

Return ONLY valid JSON array:
[
  {{"topic": "Object-Oriented Programming", "description": "...", "difficulty": "Intermediate", "emoji": "🐍"}}
]

Difficulty must be: Beginner, Intermediate, or Advanced."""

    result = call_groq(prompt)
    if not result["success"]:
        return jsonify({"error": result["error"]}), 500
    
    text = result["text"].strip()
    if text.startswith('```json'): text = text[7:]
    if text.startswith('```'): text = text[3:]
    if text.endswith('```'): text = text[:-3]
    text = text.strip()
    
    try:
        recs = json.loads(text)
        for r in recs:
            assert 'topic' in r
            assert 'description' in r
            assert r['difficulty'] in ['Beginner', 'Intermediate', 'Advanced']
            assert 'emoji' in r
        return jsonify({"success": True, "recommendations": recs})
    except Exception as e:
        return jsonify({"error": f"Failed to parse: {str(e)}"}), 500

@app.route('/api/download-notes', methods=['POST'])
def download_notes():
    data = request.json
    notes = data.get('notes', '')
    video_title = data.get('video_title', 'YouTube Video')
    
    if not notes:
        return jsonify({"error": "No notes provided"}), 400
    
    try:
        pdf_buffer = generate_notes_pdf(notes, video_title)
        pdf_buffer.seek(0)
        safe_filename = re.sub(r'[^a-zA-Z0-9_-]', '', video_title.replace(' ', '_')[:30])
        return send_file(pdf_buffer, mimetype='application/pdf', as_attachment=True, download_name=f'notes-{safe_filename}.pdf')
    except Exception as e:
        return jsonify({"error": f"PDF failed: {str(e)}"}), 500

# ============== DASHBOARD APIs ==============

@app.route('/api/stats/today', methods=['GET'])
def get_today_stats():
    stats = db.get_today_stats()
    return jsonify({"success": True, "stats": stats or {"total_videos": 0, "learning_count": 0, "non_learning_count": 0}})

@app.route('/api/stats/overall', methods=['GET'])
def get_overall_stats():
    stats = db.get_overall_stats()
    return jsonify({"success": True, "stats": stats or {"total_videos": 0, "learning_count": 0, "non_learning_count": 0}})

@app.route('/api/videos/today-learning', methods=['GET'])
def get_today_learning_videos():
    videos = db.get_today_learning_videos()
    return jsonify({"success": True, "videos": videos or []})

@app.route('/api/concepts', methods=['GET'])
def get_all_concepts():
    concepts = db.get_all_concepts()
    return jsonify({"success": True, "concepts": concepts or []})

@app.route('/api/concepts/by-video/<video_id>', methods=['GET'])
def get_concepts_by_video(video_id):
    concepts = db.get_concepts_by_video(video_id)
    return jsonify({"success": True, "concepts": concepts or []})

# ============== RECOMMENDATIONS ==============

@app.route('/api/recommendations', methods=['POST'])
def get_recommendations():
    data = request.json
    concepts = data.get('concepts', [])
    
    if not concepts or len(concepts) == 0:
        return jsonify({"error": "No concepts provided"}), 400
    
    # Group concepts by category
    categories = {}
    for c in concepts:
        cat = c.get('category', 'General')
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(c.get('concept_name', c.get('concept', '')))
    
    all_recommendations = []
    
    for category, concept_list in categories.items():
        prompt = f"""Based on these learned concepts in {category}, suggest 2-3 related topics to learn next.

Learned concepts: {', '.join(concept_list)}

Return ONLY a valid JSON array. No markdown, no explanation, just raw JSON:
[
  {{"topic": "Topic Name", "description": "Brief description of what this topic covers and why it builds on what was learned.", "difficulty": "Beginner|Intermediate|Advanced", "emoji": "🔥"}}
]

Rules:
- Each topic should naturally extend or deepen understanding of the learned concepts
- Difficulty must be exactly: Beginner, Intermediate, or Advanced
- Use relevant emojis
- Description should be 1-2 sentences
- Suggest topics that are commonly taught AFTER the learned concepts in a curriculum"""
        
        result = call_groq(prompt)
        if not result["success"]:
            continue
        
        try:
            text = result["text"].strip()
            if text.startswith('```json'): text = text[7:]
            if text.startswith('```'): text = text[3:]
            if text.endswith('```'): text = text[:-3]
            text = text.strip()
            
            recs = json.loads(text)
            for r in recs:
                assert 'topic' in r
                assert 'description' in r
                assert r['difficulty'] in ['Beginner', 'Intermediate', 'Advanced']
                assert 'emoji' in r
                r['category'] = category
                all_recommendations.append(r)
        except Exception as e:
            print(f"[RECOMMENDATIONS] Parse error for {category}: {e}")
            continue
    
    return jsonify({"success": True, "recommendations": all_recommendations})

# ============== HEALTH & INIT ==============

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "provider": "groq", "model": DEFAULT_MODEL, "database": "mysql"})

@app.route('/api/init-db', methods=['POST'])
def init_database():
    try:
        db.init_tables()
        return jsonify({"success": True, "message": "Database initialized"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ============== DASHBOARD ==============

from flask import send_from_directory

@app.route('/dashboard')
def dashboard():
    return send_from_directory('.', 'dashboard.html')

if __name__ == '__main__':
    try:
        db.init_tables()
        print("✅ Database tables initialized")
    except Exception as e:
        print(f"⚠️ Database init warning: {e}")
    app.run(debug=True, host='0.0.0.0', port=5000)
