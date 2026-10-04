import { describe, it, expect } from "vitest";
import {
  endOfDay,
  kstDay,
  isOpen,
  publicListing,
  groupMarket,
  kgPrice,
  listingSchema,
  matchesInterests,
  type Listing,
  type ListingData,
} from "../src/lib/model";
const data: ListingData = {
  species: "꽃게",
  state: "선어",
  grade: "대",
  region: "충남 태안",
  market: "테스트 위판장",
  unit: "상자",
  priceMin: 30000,
  priceMax: 40000,
  quantity: 20,
  weightKg: null,
  minimum: 1,
  pickup: "비공개 인수 주소",
  pickupHours: "07:00–12:00",
  photos: ["/media/00000000-0000-4000-8000-000000000001.webp"],
  note: "",
  confirmed: true,
};
const row: Listing = {
  id: "a",
  owner_id: "owner",
  data,
  created_at: "2026-10-04T00:00:00Z",
  updated_at: "2026-10-04T00:00:00Z",
  expires_at: endOfDay("2026-10-04"),
  closed_at: null,
  hidden: false,
  demo: false,
  seller: {
    name: "담당자",
    business: "테스트 수산",
    hours: "07:00",
    contact: "01012345678",
  },
};
describe("market rules", () => {
  it("uses Korean midnight, not UTC midnight", () => {
    expect(kstDay(new Date("2026-10-03T15:00:00Z"))).toBe("2026-10-04");
    expect(endOfDay("2026-10-04")).toBe("2026-10-04T14:59:59.999Z");
    expect(isOpen(row, new Date("2026-10-04T15:00:00Z"))).toBe(false);
  });
  it("removes every private field from anonymous payloads", () => {
    const p = JSON.stringify(publicListing(row, false));
    expect(p).not.toContain("30000");
    expect(p).not.toContain("40000");
    expect(p).not.toContain("비공개");
    expect(p).not.toContain("01012345678");
    expect(publicListing(row, true).data.priceMin).toBe(30000);
  });
  it("does not invent box weights", () => {
    expect(kgPrice(data)).toBe(null);
    expect(kgPrice({ ...data, weightKg: 10 })).toBe(3000);
  });
  it("separates different units, states, weights and demo data", () => {
    const groups = groupMarket([
      row,
      { ...row, id: "b", data: { ...data, unit: "kg" } },
      { ...row, id: "c", data: { ...data, weightKg: 10 } },
      { ...row, id: "d", data: { ...data, state: "활어" } },
      { ...row, id: "e", demo: true },
      { ...row, id: "f", hidden: true },
    ]);
    expect(groups).toHaveLength(5);
    expect(groups.every((g) => g.quantity === 20)).toBe(true);
  });
  it("counts unique participating brokers", () => {
    expect(groupMarket([row, { ...row, id: "b" }])[0]).toMatchObject({
      count: 2,
      brokers: 1,
      quantity: 40,
    });
  });
  it("rejects invalid ranges and quantity", () => {
    expect(listingSchema.safeParse({ ...data, priceMax: 1 }).success).toBe(
      false,
    );
    expect(listingSchema.safeParse({ ...data, minimum: 30 }).success).toBe(
      false,
    );
    expect(listingSchema.safeParse({ ...data, quantity: 0 }).success).toBe(
      false,
    );
  });
  it("matches region prefixes with species AND semantics", () => {
    expect(
      matchesInterests("충남 태안", "꽃게", {
        regions: ["충남"],
        species: ["꽃게"],
      }),
    ).toBe(true);
    expect(
      matchesInterests("부산", "꽃게", {
        regions: ["충남"],
        species: ["꽃게"],
      }),
    ).toBe(false);
  });
});
