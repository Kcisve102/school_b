CREATE TABLE IF NOT EXISTS summaries (
    id INT PRIMARY KEY AUTO_INCREMENT,
    video_id INT NOT NULL,
    summary_text TEXT NOT NULL,
    key_points JSON,
    model_used VARCHAR(50),
    tokens_used INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
    UNIQUE KEY unique_video_summary (video_id),
    INDEX idx_video_id (video_id)
);
