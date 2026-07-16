from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import os
import json
import time
import requests
import io
import re
from datetime import datetime

app = Flask(__name__)
CORS(app, origins=["chrome-extension://*"])

# Hardcoded API key - REPLACE WITH YOUR ACTUAL GROQ KEY
GROQ_API_KEY = "REPLACE_WITH_YOUR_GROQ_API_KEY"

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

# ============== PDF GENERATION ==============

def strip_emojis(text):
    emoji_pattern = re.compile(
        "["
        "\U0001F600-\U0001F64F"
        "\U0001F300-\U0001F5FF"
        "\U0001F680-\U0001F6FF"
        "\U0001F1E0-\U0001F1FF"
        "\U00002702-\U000027B0"
        "\U000024C2-\U0001F251"
        "]+",
        flags=re.UNICODE
    )
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

# ============== TRANSCRIPT ==============

@app.route('/api/transcript/<video_id>', methods=['GET'])
def get_transcript(video_id):
    return jsonify({
        "error": "Auto-extraction not available. Please paste transcript manually."
    }), 400

# ============== NOTES ==============

@app.route('/api/generate-notes', methods=['POST'])
def generate_notes():
    data = request.json
    transcript = data.get('transcript', '')
    video_title = data.get('video_title', 'YouTube Video')
    
    if not transcript:
        return jsonify({"error": "No transcript provided"}), 400
    
    prompt = f"""You are an expert educational note-taker. Create structured, comprehensive notes from the following YouTube video transcript.

Video Title: {video_title}

TRANSCRIPT:
{transcript[:15000]}

INSTRUCTIONS:
1. Create well-structured notes with clear headings and subheadings
2. Use bullet points for key concepts
3. Include relevant timestamps in [MM:SS] format where important concepts are discussed
4. Highlight key terms and definitions using **bold**
5. Organize by topics/themes, not just chronologically
6. Include a brief summary at the end
7. Keep it concise but comprehensive

FORMAT:
# Main Topic
## Subtopic
- Key point with **important terms**
- Another point [timestamp]

Return only the formatted notes, no extra commentary."""

    result = call_groq(prompt)
    if result["success"]:
        return jsonify({"success": True, "notes": result["text"]})
    return jsonify({"error": result["error"]}), 500

# ============== DOUBTS ==============

@app.route('/api/ask-doubt', methods=['POST'])
def ask_doubt():
    data = request.json
    question = data.get('question', '')
    notes = data.get('notes', '')
    transcript = data.get('transcript', '')
    
    if not question:
        return jsonify({"error": "No question provided"}), 400
    
    prompt = f"""You are an expert tutor. Answer the student's question based on the video notes and transcript provided.

VIDEO NOTES:
{notes[:8000]}

VIDEO TRANSCRIPT (for reference):
{transcript[:4000]}

STUDENT QUESTION: {question}

INSTRUCTIONS:
1. Answer based ONLY on the provided notes and transcript
2. If the answer isn't in the notes, say so clearly
3. Be clear, concise, and educational
4. Use examples from the video where relevant
5. If appropriate, reference specific timestamps

Provide a helpful, accurate answer."""

    result = call_groq(prompt)
    if result["success"]:
        return jsonify({"success": True, "answer": result["text"]})
    return jsonify({"error": result["error"]}), 500

# ============== QUESTIONS ==============

@app.route('/api/generate-questions', methods=['POST'])
def generate_questions():
    data = request.json
    notes = data.get('notes', '')
    transcript = data.get('transcript', '')
    
    if not notes:
        return jsonify({"error": "No notes provided"}), 400
    
    prompt = f"""You are an exam question generator. Create exam-style multiple choice questions based on the following video notes.

VIDEO NOTES:
{notes[:12000]}

INSTRUCTIONS:
1. Generate 5 exam-style multiple choice questions
2. Each question should test understanding of key concepts
3. Provide 4 options (A, B, C, D) for each question
4. Only ONE option should be correct
5. Questions should vary in difficulty (2 easy, 2 medium, 1 hard)
6. Make sure questions are based ONLY on the notes content

IMPORTANT: Return ONLY a valid JSON array in this exact format:
[
  {{
    "question": "What is the main concept discussed?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct_index": 1,
    "explanation": "Brief explanation of why B is correct"
  }}
]

Do not include markdown formatting, just raw JSON."""

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
        return jsonify({"error": f"Failed to parse questions: {str(e)}"}), 500

# ============== LEARN NEXT ==============

@app.route('/api/learn-next', methods=['POST'])
def learn_next():
    data = request.json
    notes = data.get('notes', '')
    video_title = data.get('video_title', 'YouTube Video')
    
    if not notes:
        return jsonify({"error": "No notes provided"}), 400
    
    prompt = f"""You are an expert learning path curator. Based on the following video notes, suggest what the student should learn next.

VIDEO TITLE: {video_title}

VIDEO NOTES:
{notes[:10000]}

INSTRUCTIONS:
1. Suggest exactly 5 related topics the student should learn next
2. Each topic should build naturally on what they just learned
3. Order them from most foundational to most advanced
4. For each topic, provide:
   - A clear, concise topic name (3-5 words)
   - A 1-sentence description of why it matters
   - A difficulty level: Beginner, Intermediate, or Advanced
   - A relevant emoji

IMPORTANT: Return ONLY a valid JSON array in this exact format:
[
  {{
    "topic": "Object-Oriented Programming",
    "description": "Learn to organize code using classes and objects for better reusability",
    "difficulty": "Intermediate",
    "emoji": "🐍"
  }}
]

Do not include markdown formatting, just raw JSON."""

    result = call_groq(prompt)
    if not result["success"]:
        return jsonify({"error": result["error"]}), 500
    
    text = result["text"].strip()
    
    if text.startswith('```json'): text = text[7:]
    if text.startswith('```'): text = text[3:]
    if text.endswith('```'): text = text[:-3]
    text = text.strip()
    
    try:
        recommendations = json.loads(text)
        for rec in recommendations:
            assert 'topic' in rec
            assert 'description' in rec
            assert 'difficulty' in rec
            assert rec['difficulty'] in ['Beginner', 'Intermediate', 'Advanced']
            assert 'emoji' in rec
        return jsonify({"success": True, "recommendations": recommendations})
    except Exception as e:
        return jsonify({"error": f"Failed to parse recommendations: {str(e)}"}), 500

# ============== DOWNLOAD PDF ==============

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
        
        safe_filename = video_title.replace(' ', '_')[:30]
        safe_filename = re.sub(r'[^a-zA-Z0-9_-]', '', safe_filename)
        
        return send_file(
            pdf_buffer,
            mimetype='application/pdf',
            as_attachment=True,
            download_name=f'notes-{safe_filename}.pdf'
        )
    except Exception as e:
        return jsonify({"error": f"PDF generation failed: {str(e)}"}), 500

# ============== HEALTH CHECK ==============

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "provider": "groq", "model": DEFAULT_MODEL})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)