import os
import pymysql
from pymysql.cursors import DictCursor
from dotenv import load_dotenv

load_dotenv()

class Database:
    def __init__(self):
        self.host = os.getenv('DB_HOST', 'localhost')
        self.user = os.getenv('DB_USER', 'root')
        self.password = os.getenv('DB_PASSWORD', '')
        self.db = os.getenv('DB_NAME', 'notetaker_db')
        self.port = int(os.getenv('DB_PORT', 3306))
    
    def get_connection(self):
        return pymysql.connect(
            host=self.host,
            user=self.user,
            password=self.password,
            database=self.db,
            port=self.port,
            cursorclass=DictCursor,
            charset='utf8mb4'
        )
    
    def init_tables(self):
        """Create tables if they don't exist"""
        conn = self.get_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS videos (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        video_id VARCHAR(20) UNIQUE NOT NULL,
                        video_title VARCHAR(500) NOT NULL,
                        video_url VARCHAR(500) NOT NULL,
                        is_learning_related BOOLEAN DEFAULT NULL,
                        confidence_score DECIMAL(4,3) DEFAULT NULL,
                        watched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        transcript TEXT,
                        notes TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS concepts (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        concept_name VARCHAR(200) NOT NULL,
                        category VARCHAR(100) DEFAULT 'General',
                        video_id VARCHAR(20) NOT NULL,
                        confidence_score DECIMAL(4,3) DEFAULT NULL,
                        first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        last_reviewed TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        review_count INT DEFAULT 1,
                        mastery_level ENUM('new', 'familiar', 'mastered') DEFAULT 'new'
                    )
                """)
                
                try:
                    cursor.execute("CREATE INDEX idx_videos_learning ON videos(is_learning_related)")
                except:
                    pass
                
                try:
                    cursor.execute("CREATE INDEX idx_videos_date ON videos(watched_at)")
                except:
                    pass
                
                try:
                    cursor.execute("CREATE INDEX idx_concepts_name ON concepts(concept_name)")
                except:
                    pass
                
                try:
                    cursor.execute("CREATE INDEX idx_concepts_video ON concepts(video_id)")
                except:
                    pass
                
                conn.commit()
        finally:
            conn.close()
    
    def save_video(self, video_id, video_title, video_url, transcript=None, notes=None):
        conn = self.get_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO videos (video_id, video_title, video_url, transcript, notes)
                    VALUES (%s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        video_title = VALUES(video_title),
                        video_url = VALUES(video_url),
                        transcript = VALUES(transcript),
                        notes = VALUES(notes),
                        watched_at = CURRENT_TIMESTAMP
                """, (video_id, video_title, video_url, transcript, notes))
                conn.commit()
                return True
        except Exception as e:
            print(f"Error saving video: {e}")
            return False
        finally:
            conn.close()
    
    def update_video_learning_status(self, video_id, is_learning, confidence):
        conn = self.get_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute("""
                    UPDATE videos 
                    SET is_learning_related = %s, confidence_score = %s
                    WHERE video_id = %s
                """, (is_learning, confidence, video_id))
                conn.commit()
                return True
        except Exception as e:
            print(f"Error updating video: {e}")
            return False
        finally:
            conn.close()
    
    def get_video(self, video_id):
        conn = self.get_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute("SELECT * FROM videos WHERE video_id = %s", (video_id,))
                return cursor.fetchone()
        finally:
            conn.close()
    
    def save_concept(self, concept_name, category, video_id, confidence=None):
        conn = self.get_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, review_count FROM concepts 
                    WHERE concept_name = %s AND video_id = %s
                """, (concept_name, video_id))
                existing = cursor.fetchone()
                
                if existing:
                    cursor.execute("""
                        UPDATE concepts 
                        SET review_count = review_count + 1,
                            last_reviewed = CURRENT_TIMESTAMP
                        WHERE id = %s
                    """, (existing['id'],))
                else:
                    cursor.execute("""
                        INSERT INTO concepts (concept_name, category, video_id, confidence_score)
                        VALUES (%s, %s, %s, %s)
                    """, (concept_name, category, video_id, confidence))
                
                conn.commit()
                return True
        except Exception as e:
            print(f"Error saving concept: {e}")
            return False
        finally:
            conn.close()
    
    def get_concepts_by_video(self, video_id):
        conn = self.get_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT * FROM concepts WHERE video_id = %s
                    ORDER BY confidence_score DESC
                """, (video_id,))
                return cursor.fetchall()
        finally:
            conn.close()
    
    def get_all_concepts(self, limit=None):
        conn = self.get_connection()
        try:
            with conn.cursor() as cursor:
                sql = "SELECT * FROM concepts ORDER BY first_seen DESC"
                if limit:
                    sql += f" LIMIT {limit}"
                cursor.execute(sql)
                return cursor.fetchall()
        finally:
            conn.close()
    
    def get_today_stats(self):
        conn = self.get_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT 
                        COUNT(*) as total_videos,
                        SUM(CASE WHEN is_learning_related = 1 THEN 1 ELSE 0 END) as learning_count,
                        SUM(CASE WHEN is_learning_related = 0 THEN 1 ELSE 0 END) as non_learning_count
                    FROM videos 
                    WHERE DATE(watched_at) = CURDATE()
                """)
                return cursor.fetchone()
        finally:
            conn.close()
    
    def get_overall_stats(self):
        conn = self.get_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT 
                        COUNT(*) as total_videos,
                        SUM(CASE WHEN is_learning_related = 1 THEN 1 ELSE 0 END) as learning_count,
                        SUM(CASE WHEN is_learning_related = 0 THEN 1 ELSE 0 END) as non_learning_count
                    FROM videos
                """)
                return cursor.fetchone()
        finally:
            conn.close()
    
    def get_today_learning_videos(self):
        conn = self.get_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT * FROM videos 
                    WHERE is_learning_related = 1 
                    AND DATE(watched_at) = CURDATE()
                    ORDER BY watched_at DESC
                """)
                return cursor.fetchall()
        finally:
            conn.close()
    
    def get_learning_videos_with_concepts(self):
        conn = self.get_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT v.*, c.concept_name, c.category, c.mastery_level
                    FROM videos v
                    LEFT JOIN concepts c ON v.video_id = c.video_id
                    WHERE v.is_learning_related = 1
                    ORDER BY v.watched_at DESC
                """)
                return cursor.fetchall()
        finally:
            conn.close()

db = Database()