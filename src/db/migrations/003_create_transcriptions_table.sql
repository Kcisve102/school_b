CREATE TABLE IF NOT EXISTS transcriptions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    video_id INT NOT NULL,
    transcript_text LONGTEXT NOT NULL,
    segments JSON,
    language VARCHAR(10),
    confidence_score DECIMAL(3,2),
    processing_time INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
    UNIQUE KEY unique_video_transcription (video_id),
    INDEX idx_video_id (video_id)
);
