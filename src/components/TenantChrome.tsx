import { requireTenantContext } from "@/lib/auth/context";
import { listMemberships } from "@/services/auth";
import { TenantSwitcher } from "./TenantSwitcher";
import { TenantStatusBanner } from "./TenantStatusBanner";
import { NotificationBell } from "./NotificationBell";
import { ROLE_LABEL } from "@/lib/authz/matrix";

/** 역할별 레이아웃 공통 조각: 컨텍스트 + 스위처 + 배너 + 벨 */
export async function tenantChrome(code: string) {
  const ctx = await requireTenantContext(code);
  const memberships = await listMemberships(ctx.session.userId);
  const switcher = (light?: boolean) => <TenantSwitcher current={{ code: ctx.tenant.code, name: ctx.tenant.name }} memberships={memberships} isPlatformAdmin={ctx.isPlatformAdmin} light={light} />;
  const banner = <TenantStatusBanner status={ctx.tenant.status} platformReadOnly={ctx.isPlatformAdmin && !ctx.role} />;
  const bell = (light?: boolean) => <NotificationBell userId={ctx.session.userId} href={`/t/${code}/notifications`} light={light} />;
  const userLine = `${ctx.session.name} / ${ctx.role ? ctx.roles.map((r) => ROLE_LABEL[r]).join("·") : "Platform Admin"}`;
  return { ctx, memberships, switcher, banner, bell, userLine };
}
export type Chrome = Awaited<ReturnType<typeof tenantChrome>>;
