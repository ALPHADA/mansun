import type { BidStatus } from "@/db/schema";
import { kstDateTime } from "@/lib/format";

const STATUSES: BidStatus[] = ["submitted", "closed", "awarded", "lost", "invalid"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrUndef = (v: string | undefined) => (v && UUID.test(v) ? v : undefined);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateOrUndef = (v: string | undefined) => (v && DATE.test(v) ? v : undefined);

/** searchParams → listAllBids 옵션 (페이지·CSV 공용) */
export function parseBidFilters(sp: Record<string, string | undefined>) {
  const status = sp.status && (STATUSES as string[]).includes(sp.status) ? [sp.status as BidStatus] : undefined;
  const round = uuidOrUndef(sp.round), broker = uuidOrUndef(sp.broker), fromStr = dateOrUndef(sp.from), toStr = dateOrUndef(sp.to);
  const from = fromStr ? kstDateTime(fromStr, "00:00") : undefined;
  const to = toStr ? new Date(kstDateTime(toStr, "00:00").getTime() + 86_400_000 - 1) : undefined;
  return {
    raw: { round: round ?? "", broker: broker ?? "", species: sp.species ?? "", status: status ? sp.status ?? "" : "", q: sp.q ?? "", from: fromStr ?? "", to: toStr ?? "" },
    opts: { roundId: round, brokerMembershipId: broker, speciesCode: sp.species?.slice(0, 40) || undefined, status, q: sp.q?.trim().slice(0, 50) || undefined, from, to },
  };
}
