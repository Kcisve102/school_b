-- Drops the Freelancer.com OAuth connection table.
--
-- Freelancer.com was removed as a job provider: Careerjet covers ~90 countries
-- with no per-learner account, so nothing remains that reads these rows.
--
-- NOT YET RUN AGAINST PRODUCTION. This destroys every learner's stored
-- Freelancer access and refresh tokens, and there is no way to recover them —
-- each learner would have to re-authorise. Run it only once you are certain
-- Freelancer will not be reinstated.
--
--   mysql -h <host> -u <user> -p <db> < 019_drop_freelancer_connections_table.sql

DROP TABLE IF EXISTS freelancer_connections;
