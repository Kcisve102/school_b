ALTER TABLE videos
ADD COLUMN category VARCHAR(100) DEFAULT NULL;

CREATE INDEX idx_videos_category ON videos(category);
