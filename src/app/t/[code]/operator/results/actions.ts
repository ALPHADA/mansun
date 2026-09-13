"use server";
import { run } from "@/lib/action";
import { requirePermission } from "@/lib/auth/context";
import { openAllClosed, openAuction, requestReauction } from "@/services/auction";

export async function openAuctionAction(code: string, auctionId: string, withoutField = false) {
  return run(async () => {
    const ctx = await requirePermission(code, "auction.open");
    await openAuction(ctx, auctionId, { withoutField });
  }, "개찰 완료 · 결과 통보를 전송했습니다");
}

export async function openAllClosedAction(code: string, roundId: string) {
  return run(async () => {
    const ctx = await requirePermission(code, "auction.open");
    return openAllClosed(ctx, roundId);
  });
}

export async function requestReauctionAction(code: string, auctionId: string, reason: string) {
  return run(async () => {
    const ctx = await requirePermission(code, "auction.reauction.request");
    await requestReauction(ctx, auctionId, reason);
  }, "재개찰 신청 완료 · 관리자 승인 대기");
}
