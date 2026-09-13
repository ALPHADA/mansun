import "server-only";
import { sql } from "drizzle-orm";
import { db, type Tx } from "./client";

/**
 * 테넌트 컨텍스트 트랜잭션. 트랜잭션 내 모든 도메인 쿼리에 RLS가 적용된다.
 * 애플리케이션 레벨 필터(where tenant_id=...)는 여전히 각 서비스가 명시하고,
 * RLS는 누락 시 마지막 방어선이다.
 */
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/**
 * 플랫폼 컨텍스트(스케줄러, Platform Admin 집계). RLS 우회 — 호출자는 반드시
 * 쿼리에 tenant_id 조건을 직접 명시하거나 의도적으로 전 Tenant를 대상으로 해야 한다.
 */
export async function withPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
    return fn(tx);
  });
}
