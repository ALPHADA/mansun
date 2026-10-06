CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS members (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),phone text UNIQUE NOT NULL,role text NOT NULL CHECK(role IN('broker','buyer','storage')),
 profile jsonb NOT NULL,approval text NOT NULL DEFAULT 'pending' CHECK(approval IN('pending','approved','rejected')),
 admin boolean NOT NULL DEFAULT false,suspended boolean NOT NULL DEFAULT false,demo boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES members(id),expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS otp_challenges(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),phone text NOT NULL,code_hash text NOT NULL,attempts integer NOT NULL DEFAULT 0,consumed boolean NOT NULL DEFAULT false,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS otp_phone ON otp_challenges(phone,created_at);
CREATE TABLE IF NOT EXISTS assets(id text PRIMARY KEY,owner_id uuid NOT NULL REFERENCES members(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS listings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES members(id),data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,closed_at timestamptz,hidden boolean NOT NULL DEFAULT false,demo boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS listings_date ON listings(created_at);
CREATE INDEX IF NOT EXISTS listings_owner ON listings(owner_id);
CREATE TABLE IF NOT EXISTS price_history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,listing_id uuid NOT NULL REFERENCES listings(id),data jsonb NOT NULL,changed_at timestamptz NOT NULL DEFAULT now(),actor_id uuid REFERENCES members(id));
CREATE TABLE IF NOT EXISTS buy_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES members(id),data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),closed_at timestamptz,hidden boolean NOT NULL DEFAULT false,demo boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS warehouses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid UNIQUE NOT NULL REFERENCES members(id),data jsonb NOT NULL,hidden boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS favorites(user_id uuid NOT NULL REFERENCES members(id),listing_id uuid NOT NULL REFERENCES listings(id),PRIMARY KEY(user_id,listing_id));
CREATE TABLE IF NOT EXISTS notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES members(id),title text NOT NULL,body text NOT NULL,href text NOT NULL,read_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),dedupe text UNIQUE);
CREATE TABLE IF NOT EXISTS daily_snapshots(day date PRIMARY KEY,groups jsonb NOT NULL,generated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_log(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_id uuid REFERENCES members(id),action text NOT NULL,target text NOT NULL,detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS reports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES members(id),kind text NOT NULL,target_id uuid NOT NULL,reason text NOT NULL,status text NOT NULL DEFAULT 'open',handled_by uuid REFERENCES members(id),resolution text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS activity(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,user_id uuid REFERENCES members(id),kind text NOT NULL,target text,day date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS daily_visit ON activity(user_id,day) WHERE kind='visit';
CREATE TABLE IF NOT EXISTS taxonomy(kind text NOT NULL CHECK(kind IN('region','species')),name text NOT NULL,active boolean NOT NULL DEFAULT true,PRIMARY KEY(kind,name));
CREATE TABLE IF NOT EXISTS official_prices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_name text NOT NULL,source_url text NOT NULL,basis_day date NOT NULL,region text NOT NULL,species text NOT NULL,state text NOT NULL,grade text NOT NULL,unit text NOT NULL,price_min integer NOT NULL,price_max integer NOT NULL,verified_by uuid NOT NULL REFERENCES members(id),verified_at timestamptz NOT NULL DEFAULT now(),CHECK(price_min>0 AND price_max>=price_min));

-- Verified SMS login phone is separate from self-declared business contact.
ALTER TABLE members ALTER COLUMN phone DROP NOT NULL;
CREATE TABLE IF NOT EXISTS oauth_identities(provider text NOT NULL CHECK(provider='kakao'),subject text NOT NULL,user_id uuid NOT NULL REFERENCES members(id),PRIMARY KEY(provider,subject),UNIQUE(provider,user_id));
CREATE TABLE IF NOT EXISTS oauth_attempts(token_hash text PRIMARY KEY,next_path text NOT NULL,redirect_uri text NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_signups(token_hash text PRIMARY KEY,subject text NOT NULL,expires_at timestamptz NOT NULL);

-- 중매인 사전 승인 절차 폐지: 가입 즉시 이용하고 운영자는 이용 정지로 제재한다.
-- 반려해 둔 계정은 승인으로 바꾸기 전에 이용 정지로 옮겨 계속 막는다.
ALTER TABLE members ALTER COLUMN approval SET DEFAULT 'approved';
UPDATE members SET suspended=true WHERE approval='rejected';
UPDATE members SET approval='approved' WHERE approval<>'approved';

-- Automated official feeds stay separate from operator-verified manual prices.
CREATE TABLE IF NOT EXISTS official_observations (
  provider text NOT NULL CHECK(provider IN ('mof','kamis')),
  basis_day date NOT NULL,
  item_key text NOT NULL,
  region text NOT NULL,
  species text NOT NULL,
  market text NOT NULL,
  data jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,basis_day,item_key)
);
CREATE INDEX IF NOT EXISTS official_observations_filter ON official_observations(provider,basis_day,region);
CREATE TABLE IF NOT EXISTS official_sync_runs (
  provider text NOT NULL CHECK(provider IN ('mof','kamis')),
  basis_day date NOT NULL,
  status text NOT NULL CHECK(status IN ('success','empty','error')),
  item_count integer NOT NULL DEFAULT 0,
  message text NOT NULL DEFAULT '',
  attempted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,basis_day)
);

-- Public community: identities and settings are independent of business profiles.
ALTER TABLE members ADD COLUMN IF NOT EXISTS nickname text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS board_notifications boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS members_nickname_unique ON members(lower(nickname)) WHERE nickname IS NOT NULL;
CREATE TABLE IF NOT EXISTS board_posts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), author_id uuid NOT NULL REFERENCES members(id),
 title text NOT NULL, body text NOT NULL, hidden boolean NOT NULL DEFAULT false,
 deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS board_posts_recent ON board_posts(created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS board_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), post_id uuid NOT NULL REFERENCES board_posts(id),
 author_id uuid NOT NULL REFERENCES members(id), body text NOT NULL, hidden boolean NOT NULL DEFAULT false,
 deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS board_comments_post ON board_comments(post_id,created_at,id);
