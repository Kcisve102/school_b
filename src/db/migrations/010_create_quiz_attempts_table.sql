CREATE TABLE IF NOT EXISTS quiz_attempts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    video_id INT NOT NULL,
    questions JSON NOT NULL,
    results JSON NOT NULL,
    score INT NOT NULL,
    total_questions INT NOT NULL,
    percentage_score DECIMAL(5,2) NOT NULL,
    job_suggestions JSON DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_video_id (video_id),
    INDEX idx_user_video (user_id, video_id),
    INDEX idx_created_at (created_at)
);
