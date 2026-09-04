-- The resume rendered only headline/summary/skills/job_titles, because that is
-- all one video plus one quiz can honestly support. An employer reading it sees
-- no work history and no education, and a resume missing both reads as
-- unfinished no matter how well the summary is written.
--
-- The drafting prompt cannot fill that gap: it is explicitly forbidden from
-- inventing employers, dates, schools and certificates, and that rule is
-- correct — this document is pasted onto real job boards under the learner's
-- real name. The only honest way to put a work history on a resume is to ask
-- the person for it. These columns hold what they answered.
--
-- JSON rather than four normalised child tables: exactly one profile per user
-- is already enforced by uniq_user, these arrays are only ever read whole and
-- rendered onto a resume, and nothing queries across them. `skills` and
-- `job_titles` on this same table already work this way, and parseRow is the
-- single place they are decoded.
--
-- Every column is nullable with no default. All of this is optional — a learner
-- with no employment history must still get a resume, and every profile saved
-- before this migration has to keep working untouched.
ALTER TABLE career_profiles
    -- [{ role, employer, location, start, end, current, bullets: string[] }]
    ADD COLUMN experience JSON NULL AFTER job_titles,
    -- [{ credential, institution, location, start, end, detail }]
    ADD COLUMN education JSON NULL AFTER experience,
    -- [{ name, detail, link }]
    ADD COLUMN projects JSON NULL AFTER education,
    -- [{ name, issuer, issued }]
    ADD COLUMN certifications JSON NULL AFTER projects,
    -- Contact details are OPTIONAL. A learner who does not want their phone
    -- number on a document they hand to strangers must not be forced to give
    -- one, so nothing downstream may treat these as required.
    ADD COLUMN phone VARCHAR(40) NULL AFTER certifications,
    ADD COLUMN city VARCHAR(120) NULL AFTER phone,
    -- [{ label, url }] — LinkedIn / GitHub / portfolio, labelled by the learner.
    ADD COLUMN links JSON NULL AFTER city;
