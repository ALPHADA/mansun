import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPermission, requireTenantContext } from "@/lib/auth/context";
import { hasActiveAuctions, type SettingsSection } from "@/services/tenant-admin";
import { listSpecies } from "@/services/species";
import { SettingsTab, type TenantSettings } from "./SettingsForms";

export const metadata = { title: "수협 설정" };

const TABS: { key: SettingsSection; label: string }[] = [
  { key: "general", label: "일반" }, { key: "auction", label: "경매 정책" }, { key: "units", label: "단위 환산" },
  { key: "fees", label: "수수료" }, { key: "notification", label: "알림" }, { key: "accounting", label: "회계 연동" },
];

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { code } = await params;
  const { tab } = await searchParams;
  const ctx = await requireTenantContext(code);
  if (!hasPermission(ctx, "tenant.settings.read")) notFound();
  const active: SettingsSection = TABS.some((t) => t.key === tab) ? (tab as SettingsSection) : "general";
  const [species, locked] = await Promise.all([listSpecies(), hasActiveAuctions(ctx.tenant.id)]);
  const t = ctx.tenant;
  const settings: TenantSettings = {
    name: t.name, region: t.region, address: t.address, contactEmail: t.contactEmail, contactPhone: t.contactPhone, businessNo: t.businessNo, code: t.code,
    digitalCloseBufferMin: t.digitalCloseBufferMin, tieBreakPolicy: t.tieBreakPolicy, digitalPriceVisibility: t.digitalPriceVisibility, bidModificationAllowed: t.bidModificationAllowed,
    fieldAuctionEnabled: t.fieldAuctionEnabled, bidMfaRequired: t.bidMfaRequired, winnerDisclosure: t.winnerDisclosure, reservePrices: t.reservePrices, schedule: t.schedule,
    boxWeightTable: t.boxWeightTable, feePolicy: t.feePolicy, notificationConfig: t.notificationConfig, accountingAdapter: t.accountingAdapter,
  };
  const canWrite = !ctx.readOnly && hasPermission(ctx, "tenant.settings.write");
  return (
    <>
      <div className="tabs">
        {TABS.map((tb) => <Link key={tb.key} href={`/t/${code}/admin/settings?tab=${tb.key}`} className={tb.key === active ? "active" : undefined}>{tb.label}</Link>)}
      </div>
      {locked && (
        <div className="lock-banner">🔒 <span>활성 경매가 진행 중입니다. <b>동일가 처리 · 디지털가 공개 · 입찰 수정 허용 · 수수료율 · VAT</b> 항목은 현재 변경할 수 없으며, 회차 종료 후 변경하면 다음 회차부터 적용됩니다.</span></div>
      )}
      {!canWrite && <div className="status-banner info" style={{ borderRadius: 10, marginBottom: 16 }}>읽기 전용 — 설정을 변경할 수 없습니다</div>}
      <SettingsTab code={code} tab={active} settings={settings} species={species.map((s) => ({ code: s.code, name: s.name, defaultUnit: s.defaultUnit }))} locked={locked} canWrite={canWrite} />
    </>
  );
}
