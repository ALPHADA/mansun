import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TenantFixture } from "../helpers/fixture";
import { createIntake, addLot, updateLot, removeLot, confirmIntake, deleteDraftIntake, listIntakes, getIntake, type LotInput } from "@/services/intake";
import { localDateStr } from "@/lib/format";
import type { BidUnit, Grade } from "@/db/schema";

const fx = new TenantFixture();
let vesselId: string, schedRound: string, liveRound: string, closedRound: string;
const kg = (weightKg: number, extra: Partial<LotInput> = {}): LotInput => ({ speciesCode: "mackerel", weightKg, unit: "kg", grade: "A", ...extra });

interface LotRow { id: string; auctionNo: string | null; status: string; quantity: number; weightKg: number; reservePrice: number | null; roundId: string | null; note: string | null }
const lots = (intakeId: string) => fx.q<LotRow>`select * from auctions where intake_id = ${intakeId} order by created_at`;
const intake = (id: string) => fx.q<{ status: string; roundId: string | null; confirmedAt: Date | null; confirmedBy: string | null }>`select * from intakes where id = ${id}`.then((r) => r[0]);
const draft = (items: LotInput[] = [kg(100)], roundId: string | null = schedRound, key = "rcv") =>
  createIntake(fx.ctx(key), { vesselId, arrivedAt: new Date(), roundId, items });

beforeAll(async () => {
  await fx.create();
  await fx.addUser("op", "operator"); await fx.addUser("rcv", "receiver"); await fx.addUser("rcv2", "receiver");
  await fx.addUser("ship", "shipper"); await fx.addUser("b1", "broker", { licenseNo: "I-001" });
  vesselId = await fx.addVessel("입고호", "ship");
  liveRound = (await fx.addRound({ seq: 1 })).id;                                                    // in_progress, 시작됨
  schedRound = (await fx.addRound({ seq: 2, startsInMin: 30, closesInMin: 60, status: "scheduled" })).id;
  closedRound = (await fx.addRound({ seq: 3, startsInMin: -60, closesInMin: -1 })).id;                // 마감 지남
});
afterAll(() => fx.destroy());

describe("createIntake", () => {
  it("draft 생성 + 품목: box 단위 수량 환산(갈치 20kg/박스, 220kg → 11박스), 최저가 자동 부여", async () => {
    const r = await draft([{ speciesCode: "hairtail", weightKg: 220, unit: "box", grade: "A", tankNo: "T1" }, kg(50, { speciesCode: "flatfish" })]);
    expect(r.duplicate).toBe(false);
    expect((await intake(r.id)).status).toBe("draft");
    const rows = await lots(r.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ quantity: 11, weightKg: 220, status: "registered", auctionNo: null, roundId: schedRound, reservePrice: null });
    expect(rows[1]).toMatchObject({ quantity: 50, reservePrice: 15000 });
    expect(await fx.q`select * from audit_logs where action = 'intake.create' and target_id = ${r.id}`).toHaveLength(1);
  });
  it("명시 수량이 있으면 환산 대신 사용, 환산표 없는 어종 box → 중량 그대로", async () => {
    const r = await draft([{ speciesCode: "hairtail", weightKg: 220, unit: "box", grade: "B", quantity: 10 }, { speciesCode: "mackerel", weightKg: 80, unit: "box", grade: "A" }]);
    const rows = await lots(r.id);
    expect(rows[0].quantity).toBe(10); expect(rows[1].quantity).toBe(80);
  });
  it("clientRef 멱등: 같은 키 재요청 → duplicate=true, 같은 id", async () => {
    const ref = `off-${Date.now()}`;
    const a = await createIntake(fx.ctx("rcv"), { vesselId, arrivedAt: new Date(), roundId: schedRound, clientRef: ref, items: [kg(10)] });
    const b = await createIntake(fx.ctx("rcv"), { vesselId, arrivedAt: new Date(), roundId: schedRound, clientRef: ref, items: [kg(10)] });
    expect(a.duplicate).toBe(false); expect(b).toEqual({ id: a.id, duplicate: true });
    expect(await fx.q`select id from intakes where client_ref = ${ref}`).toHaveLength(1);
  });
  it("검증: 중량 ≤0, 참고사항 100자 초과, 단위/등급/어종/선박", async () => {
    await expect(draft([kg(0)])).rejects.toThrow(/중량은 0보다/);
    await expect(draft([kg(10, { note: "가".repeat(101) })])).rejects.toThrow(/100자/);
    await expect(draft([kg(10, { unit: "ton" as BidUnit })])).rejects.toThrow(/단위/);
    await expect(draft([kg(10, { grade: "D" as Grade })])).rejects.toThrow(/등급/);
    await expect(draft([kg(10, { speciesCode: "" })])).rejects.toThrow(/어종/);
    await expect(createIntake(fx.ctx("rcv"), { vesselId: "", arrivedAt: new Date(), items: [kg(10)] })).rejects.toThrow(/선박/);
  });
  it("서비스는 역할을 검사하지 않는다 — 권한은 requirePermission 계층 책임 (선주 ctx 도 생성됨)", async () => {
    const r = await draft([kg(10)], schedRound, "ship");
    expect((await intake(r.id)).status).toBe("draft");
  });
});

describe("draft 편집 (addLot / updateLot / removeLot)", () => {
  it("addLot → 번호 없이 registered, updateLot 중량 변경 시 수량 재계산, removeLot 은 행 삭제", async () => {
    const r = await draft();
    const a = await addLot(fx.ctx("rcv"), r.id, kg(30, { speciesCode: "flatfish" }));
    expect(a).toMatchObject({ status: "registered", auctionNo: null, quantity: 30, reservePrice: 15000 });
    const u = await updateLot(fx.ctx("rcv"), a.id, { weightKg: 45, grade: "B" });
    expect(u).toMatchObject({ weightKg: 45, quantity: 45, grade: "B" });
    expect(await fx.q`select * from audit_logs where action = 'intake.update_lot' and target_id = ${a.id}`).toHaveLength(1);
    await removeLot(fx.ctx("rcv"), a.id);
    expect(await lots(r.id)).toHaveLength(1);
    expect(await fx.q`select * from audit_logs where action = 'intake.remove_lot' and target_id = ${a.id}`).toHaveLength(1);
  });
  it("updateLot 검증은 병합 후 적용 (참고사항 초과 거부), 없는 물품 notFound", async () => {
    const r = await draft();
    const [a] = await lots(r.id);
    await expect(updateLot(fx.ctx("rcv"), a.id, { note: "x".repeat(101) })).rejects.toThrow(/100자/);
    await expect(updateLot(fx.ctx("rcv"), "00000000-0000-0000-0000-000000000000", { note: "n" })).rejects.toThrow(/찾을 수 없습니다/);
  });
});

describe("confirmIntake", () => {
  const today = localDateStr().replace(/-/g, "");
  it("scheduled 회차 → 경매번호 {code}-YYYYMMDD-B01.. 순번, 물품 registered, 입고 confirmed, 알림", async () => {
    const r = await draft([kg(100), kg(200)]);
    const res = await confirmIntake(fx.ctx("rcv"), r.id);
    expect(res.lots).toBe(2); expect(res.weight).toBe(300);
    const rows = await lots(r.id);
    expect(rows.map((x) => x.auctionNo)).toEqual([`${fx.code}-${today}-B01`, `${fx.code}-${today}-B02`]);
    expect(rows.every((x) => x.status === "registered")).toBe(true);
    const it_ = await intake(r.id);
    expect(it_.status).toBe("confirmed"); expect(it_.confirmedBy).toBe(fx.users.rcv.userId); expect(it_.confirmedAt).toBeInstanceOf(Date);
    // 다음 입고는 B03 부터
    const r2 = await draft([kg(10)]);
    await confirmIntake(fx.ctx("rcv"), r2.id);
    expect((await lots(r2.id))[0].auctionNo).toBe(`${fx.code}-${today}-B03`);
    // 운영자(본인 제외) + 선주 알림
    expect(await fx.q`select * from notifications where user_id = ${fx.users.op.userId} and type = 'intake_new' and title like '%입고호%'`).not.toHaveLength(0);
    expect(await fx.q`select * from notifications where user_id = ${fx.users.ship.userId} and type = 'intake_new' and title like '%입고 확정%'`).not.toHaveLength(0);
    expect(await fx.q`select * from notifications where user_id = ${fx.users.rcv.userId} and type = 'intake_new'`).toHaveLength(0);
  });
  it("in_progress 회차 → 물품 open, 입고 announced; 회차는 인자로 지정 가능", async () => {
    const r = await draft([kg(100)], null);
    await expect(confirmIntake(fx.ctx("rcv"), r.id)).rejects.toThrow(/회차를 선택/);
    await confirmIntake(fx.ctx("rcv"), r.id, liveRound);
    const [a] = await lots(r.id);
    expect(a.status).toBe("open"); expect(a.roundId).toBe(liveRound); expect(a.auctionNo).toMatch(new RegExp(`^${fx.code}-${today}-A\\d{2}$`));
    expect((await intake(r.id))).toMatchObject({ status: "announced", roundId: liveRound });
  });
  it("두 번 확정 / 마감된 회차 / 품목 없음 → 거부", async () => {
    const r = await draft();
    await confirmIntake(fx.ctx("rcv"), r.id);
    await expect(confirmIntake(fx.ctx("rcv"), r.id)).rejects.toThrow(/이미 확정된/);
    const c = await draft([kg(10)], closedRound);
    await expect(confirmIntake(fx.ctx("rcv"), c.id)).rejects.toThrow(/마감된 회차/);
    expect((await intake(c.id)).status).toBe("draft");
    expect((await lots(c.id))[0].auctionNo).toBeNull();
    const empty = await draft([]);
    await expect(confirmIntake(fx.ctx("rcv"), empty.id)).rejects.toThrow(/품목이 1개 이상/);
  });
});

describe("확정 후 정정", () => {
  it("receiver 는 정정 불가, operator 는 사유 필수 → corrected + audit intake.correct_lot", async () => {
    const r = await draft([kg(100)]);
    await confirmIntake(fx.ctx("rcv"), r.id);
    const [a] = await lots(r.id);
    await expect(updateLot(fx.ctx("rcv"), a.id, { weightKg: 90 }, "사유")).rejects.toThrow(/운영자만 정정/);
    await expect(updateLot(fx.ctx("op"), a.id, { weightKg: 90 })).rejects.toThrow(/정정 사유/);
    const after = await updateLot(fx.ctx("op"), a.id, { weightKg: 90 }, "계근 오류");
    expect(after.weightKg).toBe(90); expect(after.quantity).toBe(90);
    expect((await intake(r.id)).status).toBe("corrected");
    const [log] = await fx.q<{ reason: string; before: { weightKg: number }; after: { weightKg: number } }>`select * from audit_logs where action = 'intake.correct_lot' and target_id = ${a.id}`;
    expect(log.reason).toBe("계근 오류"); expect(log.before.weightKg).toBe(100); expect(log.after.weightKg).toBe(90);
  });
  it("확정 후 addLot → 즉시 경매번호 부여 + intake.correct_add", async () => {
    const r = await draft([kg(100)]);
    await confirmIntake(fx.ctx("rcv"), r.id);
    const a = await addLot(fx.ctx("op"), r.id, kg(20));
    expect(a.auctionNo).toMatch(/-B\d{2}$/); expect(a.status).toBe("registered");
    expect((await intake(r.id)).status).toBe("corrected");
    expect(await fx.q`select * from audit_logs where action = 'intake.correct_add' and target_id = ${a.id}`).toHaveLength(1);
  });
  // BUG: src/services/intake.ts:116 addLot(확정 후) 는 회차 상태가 아니라 입고 상태로 물품 상태를 정하므로
  //      in_progress 회차(형제 물품 open)에 추가된 물품이 'announced' 로 남아 입찰 불가 상태가 된다.
  //      confirmIntake(line 194) 와 같이 회차 상태 기준으로 'open' 이어야 한다.
  it("진행 중 회차의 확정 입고에 addLot → 물품은 open (회차 기준 상태)", async () => {
    const r = await draft([kg(100)], liveRound);
    await confirmIntake(fx.ctx("rcv"), r.id);
    expect((await lots(r.id))[0].status).toBe("open");
    const a = await addLot(fx.ctx("op"), r.id, kg(20));
    expect(a.status).toBe("open");
  });
  it("입찰 있는 물품: 어종·단위·중량 변경/삭제 불가, 등급·참고는 정정 가능", async () => {
    const r = await draft([kg(100)], liveRound);
    await confirmIntake(fx.ctx("rcv"), r.id);
    const [a] = await lots(r.id);
    await fx.addBid(a.id, "b1", 5000);
    await expect(updateLot(fx.ctx("op"), a.id, { weightKg: 90 }, "정정")).rejects.toThrow(/입찰이 있는 물품/);
    await expect(removeLot(fx.ctx("op"), a.id, "취소")).rejects.toThrow(/입찰이 있는 물품/);
    const after = await updateLot(fx.ctx("op"), a.id, { grade: "C", note: "정정됨" }, "등급 정정");
    expect(after.grade).toBe("C"); expect(after.note).toBe("정정됨");
  });
  it("확정 후 removeLot → 사유 필수, withdrawn 처리 (행 유지), 목록 lotCount 에서 제외", async () => {
    const r = await draft([kg(100), kg(50)]);
    await confirmIntake(fx.ctx("rcv"), r.id);
    const [a] = await lots(r.id);
    await expect(removeLot(fx.ctx("op"), a.id)).rejects.toThrow(/취소 사유/);
    await removeLot(fx.ctx("op"), a.id, "이중 등록");
    const after = await lots(r.id);
    expect(after).toHaveLength(2);                                                      // 행은 유지
    expect(after.find((x) => x.id === a.id)?.status).toBe("withdrawn");
    expect(after.find((x) => x.id !== a.id)?.status).toBe("registered");
    expect((await intake(r.id)).status).toBe("corrected");
    const row = (await listIntakes(fx.tenant.id, { roundId: schedRound })).find((x) => x.id === r.id)!;
    expect(row.lotCount).toBe(1); expect(row.totalWeight).toBe(50);
    expect((await getIntake(fx.tenant.id, r.id))?.items).toHaveLength(1);
  });
});

describe("deleteDraftIntake / listIntakes", () => {
  it("타 접수자 → 거부, 운영자 → 삭제(status deleted, 물품 제거), 확정 입고 → 거부", async () => {
    const r = await draft([kg(10)]);
    await expect(deleteDraftIntake(fx.ctx("rcv2"), r.id)).rejects.toThrow(/본인이 등록한/);
    await deleteDraftIntake(fx.ctx("op"), r.id);
    expect((await intake(r.id)).status).toBe("deleted");
    expect(await lots(r.id)).toHaveLength(0);
    expect((await listIntakes(fx.tenant.id, { roundId: schedRound })).some((x) => x.id === r.id)).toBe(false);
    const own = await draft([kg(10)]);
    await deleteDraftIntake(fx.ctx("rcv"), own.id);            // 본인 삭제 OK
    expect((await intake(own.id)).status).toBe("deleted");
    const c = await draft([kg(10)]);
    await confirmIntake(fx.ctx("rcv"), c.id);
    await expect(deleteDraftIntake(fx.ctx("op"), c.id)).rejects.toThrow(/확정된 입고는 삭제/);
    await expect(updateLot(fx.ctx("op"), (await lots(r.id))[0]?.id ?? "00000000-0000-0000-0000-000000000000", { note: "x" })).rejects.toThrow();
  });
  it("listIntakes 선주 필터 + 최신순", async () => {
    const rows = await listIntakes(fx.tenant.id, { shipperUserId: fx.users.ship.userId, limit: 5 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.shipperUserId === fx.users.ship.userId && r.status !== "deleted")).toBe(true);
    expect(await listIntakes(fx.tenant.id, { shipperUserId: fx.users.b1.userId })).toHaveLength(0);
  });
});
