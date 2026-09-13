import "server-only";
import { and, eq, inArray, lte, sql, isNull, gt, gte, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { tenants, rounds, auctions, bids, memberships, notifications, auctionResults, type Tenant } from "@/db/schema";
import { withTenant, withPlatform } from "@/db/context";
import { ensureTodayRounds } from "@/services/round";
import { sendNotice, defaultMessage } from "@/services/notice";
import { awardInTx, notifyAwardResult, maybeFinishRound, finishRoundIfDone } from "@/services/auction";
import { notify, usersByRoles } from "@/services/notification";
import { speciesMap } from "@/services/species";
import { kstDateTime, localDateStr } from "@/lib/format";

let running = false;

/** 스케줄러 1회 실행. 멱등. */
export async function tick(now = new Date()) {
  if (running) return { skipped: true };
  running = true;
  const log: string[] = [];
  try {
    const active = await db.select().from(tenants).where(eq(tenants.status, "active"));
    for (const t of active) {
      try { await tickTenant(t, now, log); } catch (e) { console.error(`[tick:${t.code}]`, e); log.push(`${t.code}: error ${(e as Error).message}`); }
    }
    await licenseExpiryCheck(now, log);
  } finally { running = false; }
  return { skipped: false, log };
}

async function tickTenant(t: Tenant, now: Date, log: string[]) {
  const today = localDateStr(now);
  const todays = await ensureTodayRounds(t, today);

  // 1) 자동 공지
  for (const slot of t.schedule) {
    if (!slot.autoNoticeAt) continue;
    const at = kstDateTime(today, slot.autoNoticeAt);
    if (at > now) continue;
    const r = todays.find((x) => x.seq === slot.seq);
    if (!r || r.autoNoticedAt || r.status !== "scheduled") continue;
    const lots = await withTenant(t.id, (tx) => tx.select({ species: auctions.speciesCode, n: sql<number>`count(*)::int` }).from(auctions).where(and(eq(auctions.roundId, r.id), ne(auctions.status, "withdrawn"))).groupBy(auctions.speciesCode));
    const total = lots.reduce((s, l) => s + l.n, 0);
    if (total === 0) continue;
    const sm = await speciesMap();
    const summary = lots.map((l) => `${sm[l.species]?.name ?? l.species} ${l.n}`).join(", ");
    await sendNotice(t, null, "system", {
      roundId: r.id, mode: "auto", title: `${r.label} 경매 공지`, message: defaultMessage(t, r, total, summary),
      targets: ["broker", "union", "staff"], channels: t.notificationConfig.channels.length ? t.notificationConfig.channels : ["inapp"],
    });
    await withTenant(t.id, (tx) => tx.update(rounds).set({ autoNoticedAt: now }).where(eq(rounds.id, r.id)));
    log.push(`${t.code}: auto notice round ${r.seq}`);
  }

  await withTenant(t.id, async (tx) => {
    // 2) 입찰 시작 → in_progress / open
    const starting = await tx.select().from(rounds).where(and(eq(rounds.tenantId, t.id), inArray(rounds.status, ["scheduled", "announced"]), lte(rounds.bidStartAt, now), gt(rounds.bidCloseAt, now)));
    for (const r of starting) {
      await tx.update(rounds).set({ status: "in_progress" }).where(eq(rounds.id, r.id));
      await tx.update(auctions).set({ status: "open" }).where(and(eq(auctions.roundId, r.id), inArray(auctions.status, ["registered", "announced"])));
      log.push(`${t.code}: round ${r.seq} open`);
    }
    // 3) 마감 임박 (5분 전) 알림 + closing 상태 (1분 전)
    const soon = await tx.select().from(rounds).where(and(eq(rounds.tenantId, t.id), eq(rounds.status, "in_progress"), isNull(rounds.closingNotifiedAt), lte(rounds.bidCloseAt, new Date(now.getTime() + 5 * 60_000)), gt(rounds.bidCloseAt, now)));
    for (const r of soon) {
      await tx.update(rounds).set({ closingNotifiedAt: now }).where(eq(rounds.id, r.id));
      const brokers = await usersByRoles(t.id, ["broker", "operator"], tx);
      await notify({ tenantId: t.id, userIds: brokers, type: "closing_soon", title: `⏰ ${r.label} 디지털 마감 5분 전`, body: "아직 입찰하지 않은 품목을 확인하세요", link: `/t/${t.code}/broker/auctions` }, tx);
    }
    await tx.update(auctions).set({ status: "closing" }).where(and(eq(auctions.tenantId, t.id), eq(auctions.status, "open"),
      inArray(auctions.roundId, tx.select({ id: rounds.id }).from(rounds).where(and(eq(rounds.tenantId, t.id), lte(rounds.bidCloseAt, new Date(now.getTime() + 60_000)), gt(rounds.bidCloseAt, now))))));
  });

  // 4) 디지털 마감 → closed_digital (+ 자동 개찰 또는 현장 대기)
  const closing = await withTenant(t.id, (tx) => tx.select().from(rounds).where(and(eq(rounds.tenantId, t.id), inArray(rounds.status, ["in_progress", "announced", "scheduled"]), lte(rounds.bidCloseAt, now))));
  for (const r of closing) {
    const toAward: string[] = [];
    await withTenant(t.id, async (tx) => {
      const lots = await tx.select().from(auctions).where(and(eq(auctions.roundId, r.id), inArray(auctions.status, ["registered", "announced", "open", "closing"]))).for("update");
      for (const a of lots) {
        const [{ high }] = await tx.select({ high: sql<number | null>`max(${bids.price})::int` }).from(bids).where(and(eq(bids.auctionId, a.id), eq(bids.status, "submitted")));
        await tx.update(bids).set({ status: "closed" }).where(and(eq(bids.auctionId, a.id), eq(bids.status, "submitted")));
        if (t.fieldAuctionEnabled) {
          await tx.update(auctions).set({ status: "closed_digital", digitalHighPrice: high }).where(eq(auctions.id, a.id));
        } else {
          await tx.update(auctions).set({ status: "closed_digital", digitalHighPrice: high }).where(eq(auctions.id, a.id));
          await awardInTx(tx, t, { ...a, status: "closed_digital", digitalHighPrice: high }, { decidedBy: null });
          toAward.push(a.id);
        }
      }
      await tx.update(rounds).set({ status: "auctioning" }).where(eq(rounds.id, r.id));
    });
    for (const id of toAward) await notifyAwardResult(t, id);
    await finishRoundIfDone(t.id, r.id);
    log.push(`${t.code}: round ${r.seq} closed (${toAward.length} auto-awarded)`);
  }

  // 4b) 개찰중 회차 종결 점검
  const auctioning = await withTenant(t.id, (tx) => tx.select({ id: rounds.id }).from(rounds).where(and(eq(rounds.tenantId, t.id), eq(rounds.status, "auctioning"))));
  for (const r of auctioning) await finishRoundIfDone(t.id, r.id);

  // 5) 현장 경매 시작 시각 → field_open
  if (t.fieldAuctionEnabled) {
    await withTenant(t.id, (tx) => tx.update(auctions).set({ status: "field_open" }).where(and(eq(auctions.tenantId, t.id), eq(auctions.status, "closed_digital"),
      inArray(auctions.roundId, tx.select({ id: rounds.id }).from(rounds).where(and(eq(rounds.tenantId, t.id), lte(rounds.fieldStartAt, now)))))));
  }

  // 6) 재입찰 종료 → 개찰
  const rebids = await withTenant(t.id, (tx) => tx.select().from(auctions).where(and(eq(auctions.tenantId, t.id), eq(auctions.status, "rebid"), lte(auctions.rebidUntil, now))));
  for (const a of rebids) {
    await withTenant(t.id, async (tx) => {
      const attempt = ((await tx.select({ m: sql<number>`coalesce(max(attempt),0)::int` }).from(auctionResults).where(eq(auctionResults.auctionId, a.id)))[0].m) + 1;
      await awardInTx(tx, t, a, { decidedBy: null, attempt, onlyRebid: true });
    });
    await notifyAwardResult(t, a.id);
    await maybeFinishRound(t.id, a.id);
    log.push(`${t.code}: rebid ${a.auctionNo} awarded`);
  }
}

/** 면허 만료 7/3/1일 전 알림 + 만료 처리 (글로벌) */
async function licenseExpiryCheck(now: Date, log: string[]) {
  const today = localDateStr(now);
  await withPlatform(async (tx) => {
    const expired = await tx.update(memberships).set({ licenseStatus: "expired" })
      .where(and(eq(memberships.role, "broker"), eq(memberships.licenseStatus, "active"), sql`${memberships.licenseExpiresAt} < ${today}::date`)).returning({ id: memberships.id });
    if (expired.length) log.push(`licenses expired: ${expired.length}`);
    for (const days of [7, 3, 1]) {
      const target = new Date(now.getTime() + days * 86_400_000);
      const ds = localDateStr(target);
      const rows = await tx.select({ userId: memberships.userId, tenantId: memberships.tenantId, licenseNo: memberships.licenseNo }).from(memberships)
        .where(and(eq(memberships.role, "broker"), eq(memberships.licenseStatus, "active"), eq(memberships.status, "active"), sql`${memberships.licenseExpiresAt} = ${ds}::date`));
      for (const r of rows) {
        const dayStart = new Date(`${today}T00:00:00+09:00`);
        const dup = await tx.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, r.userId), eq(notifications.type, "license_expiring"), gte(notifications.createdAt, dayStart), eq(notifications.tenantId, r.tenantId))).limit(1);
        if (dup.length) continue;
        const [t] = await tx.select({ code: tenants.code, name: tenants.name }).from(tenants).where(eq(tenants.id, r.tenantId));
        await notify({ tenantId: r.tenantId, userIds: [r.userId], type: "license_expiring", title: `면허 만료 ${days}일 전 · ${r.licenseNo}`, body: `${t.name} 중매인 면허가 ${ds}에 만료됩니다. 갱신을 신청하세요.`, link: `/t/${t.code}/broker/my`, channels: ["kakao"] }, tx);
      }
    }
  });
}
