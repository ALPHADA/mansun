import type { TenantStatus } from "@/db/schema";

export function TenantStatusBanner({ status, platformReadOnly }: { status: TenantStatus; platformReadOnly?: boolean }) {
  const items: React.ReactNode[] = [];
  if (platformReadOnly) items.push(<div key="pa" className="status-banner info">🔍 읽기 전용 (Platform Admin) — 도메인 데이터 조회만 가능하며 모든 조회는 감사 로그에 기록됩니다.</div>);
  if (status === "suspended") items.push(<div key="s" className="status-banner warning">⚠ 이 수협은 현재 <b>정지</b> 상태입니다. 조회만 가능합니다.</div>);
  if (status === "archived") items.push(<div key="a" className="status-banner muted">이 수협은 <b>아카이브</b> 상태입니다. 읽기 전용입니다.</div>);
  if (status === "pending") items.push(<div key="p" className="status-banner warning">이 수협은 아직 <b>활성화 전</b>입니다. 운영 기능은 활성화 후 사용할 수 있습니다.</div>);
  return <>{items}</>;
}
