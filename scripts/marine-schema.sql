-- Additive marine data schema. Run before starting the web/data worker.
CREATE TABLE IF NOT EXISTS marine_jobs (
 id text PRIMARY KEY, source text NOT NULL, scope text NOT NULL, basis_day text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'pending', next_run timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz, token uuid, generation uuid NOT NULL DEFAULT gen_random_uuid(),
 page integer NOT NULL DEFAULT 1, expected integer, attempts integer NOT NULL DEFAULT 0,
 started_at timestamptz, last_attempt timestamptz, last_success timestamptz, message text NOT NULL DEFAULT '',
 UNIQUE(source,scope,basis_day)
);
CREATE INDEX IF NOT EXISTS marine_jobs_due ON marine_jobs(next_run);
CREATE TABLE IF NOT EXISTS marine_pages (
 job_id text NOT NULL REFERENCES marine_jobs(id) ON DELETE CASCADE, generation uuid NOT NULL,
 page integer NOT NULL, rows jsonb NOT NULL, PRIMARY KEY(job_id,generation,page)
);
CREATE TABLE IF NOT EXISTS marine_snapshots (
 source text NOT NULL, scope text NOT NULL, basis_day text NOT NULL DEFAULT '',
 data jsonb NOT NULL, issued_at timestamptz, fetched_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source,scope,basis_day)
);
CREATE TABLE IF NOT EXISTS marine_auction_days (
 day text PRIMARY KEY, fetched_at timestamptz NOT NULL DEFAULT now(), item_count integer NOT NULL
);
CREATE TABLE IF NOT EXISTS marine_auction_rows (
 day text NOT NULL REFERENCES marine_auction_days(day), row_key text NOT NULL,
 region text NOT NULL, market text NOT NULL, species text NOT NULL, state text NOT NULL,
 grade text NOT NULL, unit text NOT NULL, weight numeric, amount numeric NOT NULL,
 PRIMARY KEY(day,row_key)
);
CREATE INDEX IF NOT EXISTS marine_auction_filters ON marine_auction_rows(day,region,species);
CREATE TABLE IF NOT EXISTS marine_quota (
 source text NOT NULL, day text NOT NULL, calls integer NOT NULL DEFAULT 0, PRIMARY KEY(source,day)
);
CREATE TABLE IF NOT EXISTS marine_heartbeat (id boolean PRIMARY KEY DEFAULT true CHECK(id), seen_at timestamptz NOT NULL);

CREATE TABLE IF NOT EXISTS marine_settings (key text PRIMARY KEY, value text NOT NULL);
