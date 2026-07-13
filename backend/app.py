from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import json
import time
import requests

app = Flask(__name__)
CORS(app, origins=["chrome-extension://*"])

# Hardcoded API key - REPLACE WITH YOUR ACTUAL GROQ KEY
GROQ_API_KEY = "Enter_Your_Groq_API_Key_Here"

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

# ============== TRANSCRIPT (Returns error so extension shows manual input) ==============

@app.route('/api/transcript/<video_id>', methods=['GET'])
def get_transcript(video_id):
    # Always return error to trigger manual input fallback in extension
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

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "provider": "groq", "model": DEFAULT_MODEL})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)