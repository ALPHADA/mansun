import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

/** DB 통합 테스트: RLS 테넌트 격리 (DATABASE_URL = 비-superuser 앱 롤) */
const url = process.env.DATABASE_URL;
const sql = postgres(url!, { max: 1 });
let gangu = "", pohang = "";

beforeAll(async () => {
  const rows = await sql`select id, code from tenants where code in ('gangu','pohang')`;
  gangu = rows.find((r) => r.code === "gangu")!.id;
  pohang = rows.find((r) => r.code === "pohang")!.id;
});
afterAll(() => sql.end());

describe.skipIf(!url)("RLS 격리", () => {
  it("테넌트 컨텍스트 없으면 도메인 행 0건", async () => {
    const [{ n }] = await sql`select count(*)::int as n from auctions`;
    expect(n).toBe(0);
  });
  it("gangu 컨텍스트에서는 gangu 물품만", async () => {
    const n = await sql.begin(async (tx) => {
      await tx`select set_config('app.current_tenant_id', ${gangu}, true)`;
      const [{ n }] = await tx`select count(*)::int as n from auctions`;
      const [{ other }] = await tx`select count(*)::int as other from auctions where tenant_id <> ${gangu}`;
      expect(other).toBe(0);
      return n;
    });
    expect(n).toBeGreaterThan(0);
  });
  it("pohang 컨텍스트에서는 gangu 물품 보이지 않음", async () => {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.current_tenant_id', ${pohang}, true)`;
      const [{ n }] = await tx`select count(*)::int as n from auctions where tenant_id = ${gangu}`;
      expect(n).toBe(0);
    });
  });
  it("다른 테넌트 id로 INSERT 시 정책 위반 거부", async () => {
    await expect(sql.begin(async (tx) => {
      await tx`select set_config('app.current_tenant_id', ${pohang}, true)`;
      const [v] = await tx`select id from vessels where tenant_id = ${pohang} limit 1`;
      await tx`insert into vessels (tenant_id, name) values (${gangu}, 'RLS 위반 선박')`;
      return v;
    })).rejects.toThrow(/row-level security/);
  });
  it("bypass 컨텍스트(스케줄러)는 전 테넌트 조회", async () => {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.bypass_rls', 'on', true)`;
      const [{ n }] = await tx`select count(distinct tenant_id)::int as n from vessels`;
      expect(n).toBeGreaterThanOrEqual(2);
    });
  });
});
