-- MANSUN Row Level Security (idempotent)
-- 도메인 테이블은 세션 변수 app.current_tenant_id 와 일치하는 행만 접근 가능.
-- app.bypass_rls='on' 은 스케줄러/플랫폼 집계 등 명시적 컨텍스트에서만 설정한다.
DO $$
DECLARE
  t text;
  domain_tables text[] := ARRAY[
    'vessels','rounds','intakes','auctions','bids','bid_revisions','auction_results',
    'settlements','settlement_lines','notices','disputes','round_subscriptions'
  ];
BEGIN
  FOREACH t IN ARRAY domain_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (
          current_setting('app.bypass_rls', true) = 'on'
          OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        )
        WITH CHECK (
          current_setting('app.bypass_rls', true) = 'on'
          OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        )
    $p$, t);
  END LOOP;
END $$;
