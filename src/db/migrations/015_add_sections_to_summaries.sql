-- Timestamped chapter markers for a video, derived from the transcript segments
-- that are already stored. Gives the summary panel a navigable outline instead
-- of a wall of prose, at no extra API cost — it is one more field on the
-- summarization call that already runs.
--
-- Nullable: summaries generated before this migration have no sections until
-- the video is re-rendered.

ALTER TABLE summaries ADD COLUMN sections JSON NULL;
