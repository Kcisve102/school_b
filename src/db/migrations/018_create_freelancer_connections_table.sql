-- Per-user Freelancer.com OAuth connections.
--
-- Unlike the click-through handoffs recorded on career_profiles, this IS a real
-- connection: Freelancer.com redirects back to us with an authorisation code, so
-- a row here means the learner actually authorised us.
--
-- Tokens are credentials to a learner's earning account. They are stored
-- encrypted (AES-256-GCM, see utils/crypto.ts) and never logged or returned to
-- the client. A row is DELETED on disconnect rather than flagged inactive, so
-- the slot is returned against the app's OAuth user limit.
CREATE TABLE IF NOT EXISTS freelancer_connections (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,

    -- Freelancer.com identity, for display and de-duplication.
    freelancer_user_id BIGINT NULL,
    freelancer_username VARCHAR(128) NULL,

    -- AES-256-GCM ciphertext, base64. Never plaintext, never logged.
    access_token_enc TEXT NOT NULL,
    refresh_token_enc TEXT NULL,

    scope VARCHAR(512) NULL,
    expires_at TIMESTAMP NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- One connection per learner; re-authorising replaces the existing row.
    UNIQUE KEY uniq_user (user_id),
    CONSTRAINT fk_freelancer_connections_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
