import { describe, it, expect } from "vitest";
import { PERMISSIONS, roleHas, FORBIDDEN_ROLE_PAIRS, ROLE_HOME, type Permission } from "@/lib/authz/matrix";
import type { Role } from "@/db/schema";

const ROLES: Role[] = ["admin", "operator", "receiver", "broker", "shipper", "union"];

describe("권한 매트릭스 (design/02-iam.md)", () => {
  const expectOnly = (perm: Permission, allowed: Role[]) => {
    for (const r of ROLES) expect(roleHas(r, perm), `${r} ${perm}`).toBe(allowed.includes(r));
  };
  it("입찰은 중매인만", () => expectOnly("bid.place", ["broker"]));
  it("전체 입찰/낙찰 조회는 Admin·Operator", () => { expectOnly("bids.read_all", ["admin", "operator"]); expectOnly("results.read_all", ["admin", "operator"]); });
  it("입고 등록은 Admin·Operator·Receiver", () => expectOnly("intake.write", ["admin", "operator", "receiver"]));
  it("공지 발송·개찰·정산은 Admin·Operator", () => { expectOnly("notice.send", ["admin", "operator"]); expectOnly("auction.open", ["admin", "operator"]); expectOnly("settlement.process", ["admin", "operator"]); });
  it("수협 설정/멤버 관리는 Admin만", () => { expectOnly("tenant.settings.write", ["admin"]); expectOnly("members.manage", ["admin"]); });
  it("재개찰 승인은 Admin만, 신청은 Admin·Operator", () => { expectOnly("auction.reauction.approve", ["admin"]); expectOnly("auction.reauction.request", ["admin", "operator"]); });
  it("일정 조회·공지 수신은 전 역할", () => { expectOnly("schedule.read", ROLES); expectOnly("notice.receive", ROLES); });
  it("노조는 일정/작업량만", () => {
    const unionPerms = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => roleHas("union", p));
    expect(unionPerms.sort()).toEqual(["notice.receive", "schedule.read", "union.schedule.read", "union.stats.read"].sort());
  });
  it("null 역할은 아무 권한 없음", () => expect(roleHas(null, "schedule.read")).toBe(false));
  it("이해충돌: 운영자·관리자는 중매인 겸임 불가", () => {
    expect(FORBIDDEN_ROLE_PAIRS).toContainEqual(["operator", "broker"]);
    expect(FORBIDDEN_ROLE_PAIRS).toContainEqual(["admin", "broker"]);
  });
  it("모든 역할에 기본 진입 화면 존재", () => { for (const r of ROLES) expect(ROLE_HOME[r]).toMatch(/^\//); });
});
