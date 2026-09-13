import "server-only";
import { db } from "@/db/client";
import { notificationLogs } from "@/db/schema";
import type { ChannelAdapter, OutboundMessage } from "./types";

/** 개발용 Mock — 실제 발송 대신 notification_logs 에 기록 */
export function mockAdapter(channel: ChannelAdapter["channel"]): ChannelAdapter {
  return {
    channel,
    async send(msg: OutboundMessage) {
      await db.insert(notificationLogs).values({
        tenantId: msg.tenantId, channel, recipient: msg.recipient, userId: msg.userId ?? null,
        subject: msg.subject ?? null, payload: { body: msg.body, ...msg.meta }, status: "sent",
      });
      if (process.env.NODE_ENV !== "production") console.log(`[${channel}→${msg.recipient}] ${msg.subject ?? ""} ${msg.body}`);
      return { ok: true, providerRef: `mock-${Date.now()}` };
    },
  };
}
export const smsAdapter = mockAdapter("sms");
export const kakaoAdapter = mockAdapter("kakao");
export const emailAdapter = mockAdapter("email");
