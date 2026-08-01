-- Chat was previously stateless: history lived only in React state and was
-- replayed to the model from the client on every turn. A refresh destroyed the
-- conversation, and the server trusted whatever context the client sent.
--
-- Persisting it fixes both — threads survive navigation, and history is loaded
-- server-side keyed on the session user, so one learner's conversation can
-- never leak into another's.
--
-- `video_id` NULL means the global AI tutor thread; a value scopes the thread
-- to a single lesson.

CREATE TABLE IF NOT EXISTS chat_messages (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    video_id INT NULL,
    role ENUM('user', 'assistant') NOT NULL,
    content TEXT NOT NULL,
    tokens_used INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
    INDEX idx_user_video_created (user_id, video_id, created_at),
    INDEX idx_created_at (created_at)
);
