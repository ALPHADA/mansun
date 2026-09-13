/**
 * 서비스 통합 테스트용 일회성 Tenant 픽스처.
 * - 소유자 커넥션(bypass RLS)으로 Tenant/User/Membership/선박/회차/입고/물품을 만들고
 * - 테스트 후 tenant_id 기준으로 모두 삭제한다.
 * 서비스는 앱 롤(DATABASE_URL, RLS 적용)로 실행되므로 실제 격리 조건에서 검증된다.
 */
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { TenantContext } from "@/lib/auth/context";
import type { Tenant, Role, BidUnit, Grade } from "@/db/schema";

export const owner = postgres(process.env.DATABASE_OWNER_URL!, { max: 1, onnotice: () => {} });

export interface FixtureUser { userId: string; membershipId: string; email: string; role: Role; name: string }
/** Membership 없는 사용자 (Platform Admin, 미소속 사용자 등) */
export interface BareUser { userId: string; email: string; phone: string; name: string }

/** 테넌트 소속 도메인/플랫폼 행 삭제 (tenant_id 기준) — tenants 행은 남긴다 */
export async function deleteTenantRows(tid: string) {
  for (const t of ["settlement_lines", "settlements", "auction_results", "bid_revisions", "bids", "disputes", "round_subscriptions", "notices", "auctions", "intakes", "vessels", "rounds", "invitations", "memberships", "notification_logs", "audit_logs", "platform_read_sessions", "notifications"]) {
    await owner.unsafe(`delete from ${t} where tenant_id = $1`, [tid]);
  }
}
/** 서비스(createTenant 등)로 만들어진 테넌트를 code 로 완전 삭제 */
export async function destroyTenantByCode(code: string) {
  await owner`select set_config('app.bypass_rls','on',false)`;
  const [t] = await owner`select id from tenants where code = ${code}`;
  if (!t) return;
  await deleteTenantRows(t.id as string);
  await owner`delete from tenants where id = ${t.id}`;
}

export class TenantFixture {
  tenant!: Tenant;
  users: Record<string, FixtureUser> = {};
  bare: Record<string, BareUser> = {};
  /** 서비스가 생성한 사용자 등 destroy 시 함께 지울 user id */
  private extraUserIds: string[] = [];
  code = `t${randomUUID().replace(/-/g, "").slice(0, 8)}`;

  /** 서비스가 만든 사용자를 정리 대상에 등록 */
  trackUser(userId: string) { this.extraUserIds.push(userId); }

  async create(overrides: Record<string, unknown> = {}) {
    await owner`select set_config('app.bypass_rls','on',false)`;
    // 주의: jsonb 파라미터에는 객체를 그대로 넘긴다. JSON.stringify 한 문자열을 넘기면 postgres.js 가 한 번 더 인코딩해 문자열 스칼라로 저장된다.
    const feePolicy = { marketFeeRate: 0.04, brokerFeeRate: 0.015, vatIncluded: true, vatRate: 0.1 };
    const boxWeightTable = { hairtail: { box: 20 } };
    const reservePrices = { flatfish: 15000 };
    await owner`insert into tenants (code, name, region, status, fee_policy, box_weight_table, reserve_prices, tie_break_policy, field_auction_enabled, bid_modification_allowed, activated_at)
      values (${this.code}, ${"테스트 수협 " + this.code}, '테스트', 'active',
        ${owner.json(feePolicy)}, ${owner.json(boxWeightTable)}, ${owner.json(reservePrices)}, 'first_come', false, true, now())`;
    if (Object.keys(overrides).length) await this.update(overrides);
    await this.reload();
    return this;
  }

  /** tenants 컬럼 갱신 (snake_case 키). 객체/배열 값은 jsonb 컬럼으로 그대로 전달 */
  async update(patch: Record<string, unknown>) {
    for (const [k, v] of Object.entries(patch)) {
      await owner.unsafe(`update tenants set "${k}" = $1 where code = $2`, [v as never, this.code]);
    }
    await this.reload();
  }
  async reload() {
    const [row] = await owner`select * from tenants where code = ${this.code}`;
    this.tenant = camel(row) as Tenant;
  }

  async addUser(key: string, role: Role, extra: { licenseNo?: string; licenseStatus?: string; name?: string } = {}): Promise<FixtureUser> {
    const email = `${key}@${this.code}.test`;
    const hash = await bcrypt.hash("test1234", 4);
    const [u] = await owner`insert into users (email, phone, name, password_hash, identity_verified) values (${email}, ${"019" + Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}, ${extra.name ?? key}, ${hash}, true) returning id`;
    const [m] = await owner`insert into memberships (user_id, tenant_id, role, status, license_no, license_status, joined_at)
      values (${u.id}, ${this.tenant.id}, ${role}, 'active', ${extra.licenseNo ?? null}, ${role === "broker" ? (extra.licenseStatus ?? "active") : null}, now()) returning id`;
    const fu = { userId: u.id, membershipId: m.id, email, role, name: extra.name ?? key };
    this.users[key] = fu;
    return fu;
  }

  /** Membership 없는 사용자 생성 (비밀번호 test1234) */
  async addBareUser(key: string, extra: { name?: string; globalSuspended?: boolean } = {}): Promise<BareUser> {
    const email = `${key}@${this.code}.test`;
    const phone = "018" + Math.floor(Math.random() * 1e8).toString().padStart(8, "0");
    const hash = await bcrypt.hash("test1234", 4);
    const [u] = await owner`insert into users (email, phone, name, password_hash, identity_verified, global_suspended) values (${email}, ${phone}, ${extra.name ?? key}, ${hash}, true, ${extra.globalSuspended ?? false}) returning id`;
    const bu = { userId: u.id as string, email, phone, name: extra.name ?? key };
    this.bare[key] = bu;
    return bu;
  }
  /** Platform Admin 사용자 (platform_admins 행 포함, Membership 없음) */
  async addPlatformAdmin(key: string): Promise<BareUser> {
    const bu = await this.addBareUser(key);
    await owner`insert into platform_admins (user_id) values (${bu.userId})`;
    return bu;
  }
  /** 기존 사용자에게 이 테넌트의 Membership 추가 (다중 역할/다중 테넌트 시나리오) */
  async addMembership(userId: string, role: Role, extra: { licenseNo?: string; status?: string } = {}) {
    const [m] = await owner`insert into memberships (user_id, tenant_id, role, status, license_no, license_status, joined_at)
      values (${userId}, ${this.tenant.id}, ${role}, ${extra.status ?? "active"}, ${extra.licenseNo ?? null}, ${role === "broker" ? "active" : null}, now()) returning id`;
    return m.id as string;
  }

  ctx(key: string, extraRoles: Role[] = []): TenantContext {
    const u = this.users[key];
    if (!u) throw new Error(`no fixture user ${key}`);
    const roles = [u.role, ...extraRoles];
    return {
      session: { userId: u.userId, name: u.name, isPlatformAdmin: false, activeTenantId: this.tenant.id, activeTenantCode: this.tenant.code, activeRole: u.role, tenantRoles: roles },
      tenant: this.tenant, role: u.role, roles, membershipId: u.membershipId, readOnly: this.tenant.status !== "active", isPlatformAdmin: false,
    };
  }

  async addVessel(name: string, shipperKey: string) {
    const [v] = await owner`insert into vessels (tenant_id, name, shipper_user_id) values (${this.tenant.id}, ${name}, ${this.users[shipperKey].userId}) returning id`;
    return v.id as string;
  }
  async addRound(opts: { seq?: number; startsInMin?: number; closesInMin?: number; fieldOffsetMin?: number | null; status?: string } = {}) {
    const seq = opts.seq ?? 1;
    const start = new Date(Date.now() + (opts.startsInMin ?? -10) * 60_000);
    const close = new Date(Date.now() + (opts.closesInMin ?? 30) * 60_000);
    const field = opts.fieldOffsetMin === null ? null : new Date(close.getTime() + (opts.fieldOffsetMin ?? 5) * 60_000);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
    const [r] = await owner`insert into rounds (tenant_id, date, seq, label, bid_start_at, bid_close_at, field_start_at, status)
      values (${this.tenant.id}, ${today}, ${seq}, ${"테스트 " + seq + "회차"}, ${start}, ${close}, ${field}, ${opts.status ?? "in_progress"}) returning *`;
    return camel(r) as { id: string; bidCloseAt: Date; bidStartAt: Date; status: string; date: string; seq: number };
  }
  /** 확정된 입고 + 물품 1건 (auction_no 부여, 상태 open) */
  async addLot(roundId: string, vesselId: string, lot: { species?: string; weightKg?: number; unit?: BidUnit; quantity?: number; grade?: Grade; status?: string; reservePrice?: number | null; seq?: number } = {}) {
    const creator = Object.values(this.users)[0].userId;
    const [it] = await owner`insert into intakes (tenant_id, vessel_id, round_id, arrived_at, status, created_by, confirmed_at) values (${this.tenant.id}, ${vesselId}, ${roundId}, now(), 'announced', ${creator}, now()) returning id`;
    const [{ n }] = await owner`select count(*)::int as n from auctions where round_id = ${roundId}`;
    const [{ seq }] = await owner`select seq from rounds where id = ${roundId}`;
    const no = `${this.code}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String.fromCharCode(64 + Number(seq))}${String(n + 1).padStart(2, "0")}`;
    const weight = lot.weightKg ?? 100;
    const [a] = await owner`insert into auctions (tenant_id, intake_id, round_id, auction_no, species_code, weight_kg, unit, quantity, grade, status, reserve_price)
      values (${this.tenant.id}, ${it.id}, ${roundId}, ${no}, ${lot.species ?? "mackerel"}, ${weight}, ${lot.unit ?? "kg"}, ${lot.quantity ?? weight}, ${lot.grade ?? "A"}, ${lot.status ?? "open"}, ${lot.reservePrice ?? null}) returning *`;
    return camel(a) as { id: string; auctionNo: string; intakeId: string; status: string; quantity: number };
  }
  async addBid(auctionId: string, brokerKey: string, price: number, minutesAgo = 5) {
    const u = this.users[brokerKey];
    const at = new Date(Date.now() - minutesAgo * 60_000);
    const [b] = await owner`insert into bids (tenant_id, auction_id, broker_membership_id, broker_user_id, price, submitted_at, first_submitted_at) values (${this.tenant.id}, ${auctionId}, ${u.membershipId}, ${u.userId}, ${price}, ${at}, ${at}) returning id`;
    await owner`update auctions set bid_count = bid_count + 1 where id = ${auctionId}`;
    return b.id as string;
  }
  async auction(id: string) { const [a] = await owner`select * from auctions where id = ${id}`; return camel(a) as Record<string, unknown> & { status: string; finalPrice: number | null; winnerMembershipId: string | null; awardSource: string | null }; }
  async bids(auctionId: string) { return (await owner`select * from bids where auction_id = ${auctionId} order by price desc`).map(camel) as Record<string, unknown>[]; }
  async q<T = Record<string, unknown>>(strings: TemplateStringsArray, ...vals: unknown[]) { return (await owner(strings, ...(vals as never[]))).map(camel) as T[]; }

  async destroy() {
    const tid = this.tenant?.id; if (!tid) return;
    const userIds = [...new Set([...Object.values(this.users).map((u) => u.userId), ...Object.values(this.bare).map((u) => u.userId), ...this.extraUserIds])];
    await deleteTenantRows(tid);
    if (userIds.length) {
      const emails = (await owner`select email from users where id in ${owner(userIds)} and email is not null`).map((r) => r.email as string);
      await owner`delete from notifications where user_id in ${owner(userIds)}`;
      await owner`delete from notification_logs where user_id in ${owner(userIds)}`;   // tenant_id null(글로벌) 로그 포함
      await owner`delete from otp_codes where user_id in ${owner(userIds)}`;
      if (emails.length) await owner`delete from otp_codes where target in ${owner(emails)}`;
      // 로그인 실패 감사(actor/tenant 없음)는 identifier 로 정리 — 픽스처 도메인 전체
      await owner`delete from audit_logs where action = 'auth.login_failed' and after->>'identifier' like ${"%@" + this.code + ".test"}`;
      await owner`delete from platform_admins where user_id in ${owner(userIds)}`;
      await owner`delete from platform_read_sessions where admin_user_id in ${owner(userIds)}`;
      await owner`delete from invitations where invited_by in ${owner(userIds)}`;
      await owner`delete from memberships where user_id in ${owner(userIds)}`;      // 다른 테넌트 Membership 포함
      await owner`delete from audit_logs where actor_user_id in ${owner(userIds)} or target_id in ${owner(userIds)}`;
      await owner`delete from users where id in ${owner(userIds)}`;
    }
    await owner`delete from tenants where id = ${tid}`;
  }
}

export function camel<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  return out as T;
}
