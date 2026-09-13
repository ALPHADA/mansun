export interface OutboundMessage {
  tenantId: string | null;
  userId?: string | null;
  recipient: string;           // 전화번호 / 이메일
  subject?: string;
  body: string;
  meta?: Record<string, unknown>;
}
export interface ChannelAdapter {
  channel: "sms" | "kakao" | "email";
  send(msg: OutboundMessage): Promise<{ ok: boolean; providerRef?: string; error?: string }>;
}
