export interface SettlementExport {
  tenantCode: string;
  settlementNo: string;
  partyType: "shipper" | "broker";
  partyName: string;
  grossAmount: number;
  feeAmount: number;
  vatAmount: number;
  netAmount: number;
  lines: { auctionNo: string; quantity: number; unitPrice: number; grossAmount: number }[];
}
export interface AccountingAdapter {
  name: string;
  push(tenantId: string, data: SettlementExport): Promise<{ ok: boolean; ref?: string; error?: string }>;
}
