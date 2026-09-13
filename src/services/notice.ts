import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { notices, auctions, rounds, intakes, type NoticeTarget, type NotificationChannel, type Role, type Tenant, type NoticeMode } from "@/db/schema";
import { withTenant } from "@/db/context";
import { audit } from "./audit";
import { notify, usersByRoles } from "./notification";
import { validation, stateError } from "@/lib/errors";
import { fmtTime } from "@/lib/format";

const TARGET_ROLES: Record<NoticeTarget, Role[]> = { broker: ["broker"], union: ["union"], staff: ["admin", "operator", "receiver"], shipper: ["shipper"] };
export const TARGET_LABEL: Record<NoticeTarget, string> = { broker: "중매인", union: "노조", staff: "수협 직원", shipper: "선주" };
export const CHANNEL_LABEL: Record<NotificationChannel, string> = { inapp: "인앱 푸시", kakao: "카카오 알림톡", sms: "SMS", email: "이메일" };

export interface NoticeInput {
  roundId: string; title: string; message: string; targets: NoticeTarget[]; channels: NotificationChannel[]; mode?: NoticeMode;
  bidStartAt?: Date; bidCloseAt?: Date; fieldStartAt?: Date | null;
}

export async function listNotices(tenantId: string, limit = 20) {
  return withTenant(tenantId, (tx) => tx.select({ notice: notices, roundLabel: rounds.label }).from(notices).leftJoin(rounds, eq(rounds.id, notices.roundId))
    .where(eq(notices.tenantId, tenantId)).orderBy(desc(notices.sentAt)).limit(limit));
}

/** 수신 대상 인원 수 (미리보기) */
export async function recipientCounts(tenantId: string) {
  const out: Record<NoticeTarget, number> = { broker: 0, union: 0, staff: 0, shipper: 0 };
  for (const t of Object.keys(out) as NoticeTarget[]) out[t] = (await usersByRoles(tenantId, TARGET_ROLES[t])).length;
  return out;
}

export function defaultMessage(tenant: Tenant, round: { label: string; bidStartAt: Date; bidCloseAt: Date; fieldStartAt: Date | null }, lotCount: number, speciesSummary: string) {
  return `[${tenant.name}] ${round.label} 경매 공지\n입찰 시작 ${fmtTime(round.bidStartAt)} · 마감 ${fmtTime(round.bidCloseAt)}${round.fieldStartAt ? ` · 현장 경매 ${fmtTime(round.fieldStartAt)}` : ""}\n입고 품목 ${lotCount}건 (${speciesSummary})\n마감 전 MANSUN에서 입찰하세요.`;
}

/** 공지 발송 — 회차 상태 announced, 물품 announced/open 전환, 알림 발송 */
export async function sendNotice(tenant: Tenant, actorUserId: string | null, actorRole: string | null, input: NoticeInput) {
  if (input.title.trim().length < 2 || input.title.length > 40) throw validation("제목은 2~40자");
  if (input.message.trim().length < 10 || input.message.length > 500) throw validation("메시지는 10~500자");
  if (input.targets.length === 0) throw validation("발송 대상을 1개 이상 선택하세요");
  if (input.channels.length === 0) throw validation("채널을 1개 이상 선택하세요");

  const { notice, userIds, roundLabel } = await withTenant(tenant.id, async (tx) => {
    const [round] = await tx.select().from(rounds).where(and(eq(rounds.tenantId, tenant.id), eq(rounds.id, input.roundId))).for("update");
    if (!round) throw validation("회차를 선택하세요");
    if (round.status === "done" || round.status === "cancelled") throw stateError("종료된 회차입니다");
    // 시각 변경 반영
    if (input.bidStartAt && input.bidCloseAt) {
      if (input.bidCloseAt <= input.bidStartAt) throw validation("입찰 마감은 시작 이후여야 합니다");
      if (input.fieldStartAt && input.fieldStartAt.getTime() < input.bidCloseAt.getTime() + tenant.digitalCloseBufferMin * 60_000) throw validation(`현장 경매 시작은 마감 + ${tenant.digitalCloseBufferMin}분 이후여야 합니다`);
      await tx.update(rounds).set({ bidStartAt: input.bidStartAt, bidCloseAt: input.bidCloseAt, fieldStartAt: input.fieldStartAt ?? null }).where(eq(rounds.id, round.id));
    }
    const now = Date.now();
    const start = (input.bidStartAt ?? round.bidStartAt).getTime();
    const lotStatus = start <= now ? "open" : "announced";
    const lots = await tx.update(auctions).set({ status: lotStatus }).where(and(eq(auctions.roundId, round.id), inArray(auctions.status, ["registered", "announced"]))).returning({ id: auctions.id });
    await tx.update(intakes).set({ status: "announced" }).where(and(eq(intakes.roundId, round.id), inArray(intakes.status, ["confirmed"])));
    if (round.status === "scheduled") await tx.update(rounds).set({ status: lotStatus === "open" ? "in_progress" : "announced" }).where(eq(rounds.id, round.id));
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(auctions).where(and(eq(auctions.roundId, round.id), sql`${auctions.status} <> 'withdrawn'`));

    const roles = [...new Set(input.targets.flatMap((t) => TARGET_ROLES[t]))];
    const userIds = await usersByRoles(tenant.id, roles, tx);
    const [notice] = await tx.insert(notices).values({
      tenantId: tenant.id, roundId: round.id, mode: input.mode ?? "manual", title: input.title.trim(), message: input.message.trim(), targets: input.targets, channels: input.channels,
      lotCount: n, recipientCount: userIds.length, sentBy: actorUserId,
    }).returning();
    await audit({ tenantId: tenant.id, actorUserId, actorRole, action: "notice.send", targetType: "notice", targetId: notice.id, after: { ...notice, updatedLots: lots.length } }, tx);
    return { notice, userIds, roundLabel: round.label };
  });

  const r = await notify({ tenantId: tenant.id, userIds, type: "notice", title: notice.title, body: notice.message, link: `/t/${tenant.code}`, channels: input.channels });
  await withTenant(tenant.id, (tx) => tx.update(notices).set({ successCount: r.success, failCount: r.fail }).where(eq(notices.id, notice.id)));
  return { ...notice, successCount: r.success, failCount: r.fail, roundLabel };
}
