CREATE TABLE IF NOT EXISTS quizzes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    video_id INT NOT NULL,
    questions JSON NOT NULL,
    difficulty ENUM('easy', 'medium', 'hard') DEFAULT 'medium',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
    INDEX idx_video_difficulty (video_id, difficulty),
    INDEX idx_created_at (created_at)
);

ALTER TABLE quiz_attempts ADD COLUMN quiz_id INT NULL;

ALTER TABLE quiz_attempts
    ADD CONSTRAINT fk_attempt_quiz FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE SET NULL;
