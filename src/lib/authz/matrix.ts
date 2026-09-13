import type { Role } from "@/db/schema";

/** 기능 × 역할 권한 매트릭스 (design/02-iam.md) — 단일 출처 */
export const PERMISSIONS = {
  // Tenant Admin
  "tenant.settings.read": ["admin"],
  "tenant.settings.write": ["admin"],
  "members.manage": ["admin"],
  "audit.read": ["admin"],
  "stats.read": ["admin", "operator"],
  // 운영
  "intake.write": ["admin", "operator", "receiver"],
  "intake.confirm": ["admin", "operator", "receiver"],
  "intake.correct": ["admin", "operator"],
  "notice.send": ["admin", "operator"],
  "auction.open": ["admin", "operator"],
  "auction.field_result": ["admin", "operator"],
  "auction.reauction.request": ["admin", "operator"],
  "auction.reauction.approve": ["admin"],
  "bids.read_all": ["admin", "operator"],
  "results.read_all": ["admin", "operator"],
  "settlement.process": ["admin", "operator"],
  "operator.dashboard": ["admin", "operator"],
  // 중매인
  "bid.place": ["broker"],
  "bid.read_self": ["broker"],
  "results.read_self": ["broker", "shipper"],
  "settlement.read_self": ["broker", "shipper"],
  // 선주
  "shipper.read_self": ["shipper"],
  "dispute.raise": ["shipper"],
  // 노조
  "union.schedule.read": ["union"],
  "union.stats.read": ["union"],
  // 공통
  "schedule.read": ["admin", "operator", "receiver", "broker", "shipper", "union"],
  "notice.receive": ["admin", "operator", "receiver", "broker", "shipper", "union"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function roleHas(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** 역할별 기본 진입 화면 */
export const ROLE_HOME: Record<Role, string> = {
  admin: "/admin",
  operator: "/operator/dashboard",
  receiver: "/receiver",
  broker: "/broker/auctions",
  shipper: "/shipper",
  union: "/union",
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: "수협 관리자",
  operator: "운영자",
  receiver: "입고담당",
  broker: "중매인",
  shipper: "선주",
  union: "노조",
};

/** 역할 우선순위 — 한 사용자가 같은 Tenant에서 여러 역할일 때 기본 진입 역할 */
export const ROLE_PRIORITY: Role[] = ["admin", "operator", "receiver", "broker", "shipper", "union"];

/** 이해 충돌 금지 조합 */
export const FORBIDDEN_ROLE_PAIRS: [Role, Role][] = [["operator", "broker"], ["admin", "broker"]];
