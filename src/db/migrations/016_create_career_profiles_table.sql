-- A learner-owned skills profile, drafted by Gemini after a >=80% quiz and then
-- edited by the learner. It is OUR record: no job board exposes a profile-write
-- API, so the handoff to Indeed/ZipRecruiter/Glassdoor/Dice is a clipboard copy
-- plus a redirect. Nothing here is ever pushed to a third party.
CREATE TABLE IF NOT EXISTS career_profiles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    headline VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL,
    skills JSON NOT NULL,
    job_titles JSON NOT NULL,
    source_video_id INT NULL,
    source_attempt_id INT NULL,
    generated_language VARCHAR(8) NOT NULL DEFAULT 'en',
    -- Set once the learner edits the draft. Guards regeneration: we confirm
    -- before overwriting text a human has touched.
    is_edited BOOLEAN NOT NULL DEFAULT FALSE,
    -- Records that a handoff was *initiated*. No callback exists from any
    -- destination, so this can never mean an account was created.
    last_handoff_platform VARCHAR(32) NULL,
    last_handoff_at TIMESTAMP NULL,
    -- FUTURE ONLY. Nothing reads these two columns. There is no public profile
    -- page, no /talent directory and no sitemap entry; `visibility` is always
    -- 'private' and `public_slug` is always NULL. They exist so a public page
    -- can be added additively later. Do not assume a public page half-exists.
    visibility ENUM('private', 'public') NOT NULL DEFAULT 'private',
    public_slug VARCHAR(64) NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    -- The profile outlives its source: deleting the video or attempt it was
    -- generated from must not delete the learner's own text.
    FOREIGN KEY (source_video_id) REFERENCES videos(id) ON DELETE SET NULL,
    FOREIGN KEY (source_attempt_id) REFERENCES quiz_attempts(id) ON DELETE SET NULL,
    UNIQUE KEY uniq_user (user_id),
    INDEX idx_updated_at (updated_at)
);
