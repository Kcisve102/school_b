-- Video watches previously recorded only *that* a video was finished, and only
-- when the player fired `onEnded`. A learner who watched 95% and navigated away
-- left no record at all, while someone who scrubbed to the end in two seconds
-- got a full one. Storing the playback position lets them resume, and lets the
-- dashboard show real progress instead of a binary seen/unseen flag.

ALTER TABLE video_watches ADD COLUMN position_seconds INT NOT NULL DEFAULT 0;

ALTER TABLE video_watches ADD COLUMN completed BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing rows were only ever written on `onEnded`, so every one of them
-- represents a finished video.
UPDATE video_watches SET completed = TRUE;
