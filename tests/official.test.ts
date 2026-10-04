import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { db } from "../src/server/db";
import {
  amount,
  collect,
  mofRows,
  normalizeKamis,
  normalizeMof,
  parseMofPage,
  regionFromAddress,
  validDay,
  type Observation,
} from "../src/server/official/providers";
import { recentDays, syncDay } from "../src/server/official/sync";
import { officialReport } from "../src/server/official/queries";
const day = "2026-01-02";
const raw = {
  csmtDe: "20260102",
  mxtrCode: "317",
  mxtrNm: "서천군수협",
  csmtmktCode: "317001",
  csmtmktNm: "판매사업팀",
  mprcStdCode: "640100",
  mprcStdCodeNm: "갑오징어류",
  goodsStndrdCode: "002",
  goodsUnitCode: "001",
  kdfshSttusCode: "20",
  kdfshSttusNm: "선어",
  goodsStndrdNm: "대",
  goodsUnitNm: "상자",
  lprc: "50,000",
  hghpc: "60000",
};
const observation = (): Observation =>
  normalizeMof([raw], day, new Map([["317001", "충남"]]))[0];
const mof = (rows: unknown[], total = rows.length) => ({
  response: {
    header: { resultCode: "00" },
    body: { totalCount: total, items: { item: rows } },
  },
});
const kamis = (price: string) => ({
  condition: [{ p_regday: day }],
  data: {
    error_code: "000",
    item: [
      {
        item_name: "고등어",
        item_code: "611",
        kind_name: "국산",
        kind_code: "01",
        rank: "상품",
        unit: "1마리",
        dpr1: price,
        dpr2: "5,000",
        dpr3: "-",
      },
    ],
  },
});
beforeAll(async () => {
  await db().unsafe(await readFile("scripts/schema.sql", "utf8"));
  await db()`DELETE FROM official_observations`;
  await db()`DELETE FROM official_sync_runs`;
});
afterAll(async () => {
  await db()`DELETE FROM official_observations`;
  await db()`DELETE FROM official_sync_runs`;
  await db().end();
});
it("validates calendar dates and bounded backfill", () => {
  expect(validDay("2026-02-30")).toBe(false);
  expect(recentDays("2026-01-01", 2)).toEqual(["2026-01-01", "2025-12-31"]);
  expect(() => recentDays(day, 32)).toThrow();
});
it("never turns missing, zero or malformed prices into market values", () => {
  for (const input of ["-", null, "", "0", "1e4", "-2", "Infinity"])
    expect(amount(input)).toBeNull();
  expect(amount("1,234.5")).toBe(1234.5);
});
it("keeps auction units and regional identity, rejects impossible ranges or wrong dates", () => {
  expect(observation()).toMatchObject({
    region: "충남",
    low: 50000,
    high: 60000,
    unit: "상자",
    previous: null,
  });
  expect(() =>
    normalizeMof([{ ...raw, csmtDe: "20260101" }], day, new Map()),
  ).toThrow();
  expect(() =>
    normalizeMof([{ ...raw, hghpc: "100" }], day, new Map()),
  ).toThrow();
  expect(regionFromAddress("전북특별자치도 군산시")).toBe("전북");
  expect(regionFromAddress("없는 주소")).toBe("지역 미확인");
});
it("handles singleton MOF items, empty data, authentication and malformed pages", () => {
  expect(parseMofPage(mof([], 0)).rows).toEqual([]);
  expect(
    parseMofPage({
      response: {
        header: { resultCode: "00" },
        body: { totalCount: 1, items: { item: raw } },
      },
    }).rows,
  ).toHaveLength(1);
  expect(() => parseMofPage(mof([], 2))).toThrow();
  expect(() =>
    parseMofPage({ response: { header: { resultCode: "30" } } }),
  ).toThrow();
});
it("collects all pages and refuses changing totals", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(mof([raw], 2)))
    .mockResolvedValueOnce(
      Response.json(mof([{ ...raw, csmtmktCode: "2" }], 2)),
    );
  expect(await mofRows("0050", day, "a%2Bb", fetcher)).toHaveLength(2);
  const url = fetcher.mock.calls[0][0] as URL;
  expect(url.searchParams.get("serviceKey")).toBe("a+b");
  expect(url.searchParams.get("numOfRows")).toBe("100");
  expect(url.searchParams.get("baseDt")).toBe("20260102");
  const changing = vi
    .fn()
    .mockResolvedValueOnce(Response.json(mof([raw], 2)))
    .mockResolvedValueOnce(Response.json(mof([raw], 3)));
  await expect(mofRows("0050", day, "x", changing)).rejects.toThrow();
});
it("preserves KAMIS sale stage and comparison missing values", () => {
  const r = normalizeKamis(kamis("5,500"), day, "retail")[0];
  expect(r).toMatchObject({
    kind: "retail",
    region: "전국",
    low: 5500,
    previous: 5000,
    week: null,
    unit: "1마리",
  });
  expect(normalizeKamis(kamis("-"), day, "retail")).toEqual([]);
  expect(normalizeKamis({ data: ["001"] }, day, "retail")).toEqual([]);
  expect(() => normalizeKamis({ data: ["900"] }, day, "retail")).toThrow();
  expect(() => normalizeKamis(kamis("5000"), "2026-01-03", "retail")).toThrow();
});
it("does not leak a credential-bearing request URL on transport failure", async () => {
  vi.stubEnv("MOF_SERVICE_KEY", "PRIVATE_KEY");
  await expect(
    collect(
      "mof",
      day,
      vi
        .fn()
        .mockRejectedValue(new Error("https://example/?secret=PRIVATE_KEY")),
    ),
  ).rejects.not.toThrow("PRIVATE_KEY");
  vi.unstubAllEnvs();
});
it("reimports atomically without duplicates and retains the prior snapshot on failure/empty", async () => {
  const collector = async () => [observation()];
  expect((await syncDay("mof", day, { force: true, collector })).status).toBe(
    "success",
  );
  await syncDay("mof", day, { force: true, collector });
  expect((await officialReport("mof", day)).total).toBe(1);
  await syncDay("mof", day, {
    force: true,
    collector: async () => {
      throw new Error("PRIVATE_KEY");
    },
  });
  const report = await officialReport("mof", day);
  expect(report.total).toBe(1);
  expect(report.status).toBe("error");
  expect(
    JSON.stringify(await db()`SELECT * FROM official_sync_runs`),
  ).not.toContain("PRIVATE_KEY");
  await syncDay("mof", day, { force: true, collector: async () => [] });
  expect((await officialReport("mof", day)).total).toBe(1);
  await syncDay("mof", day, {
    force: true,
    collector: async () => [observation(), observation()],
  });
  expect((await officialReport("mof", day)).status).toBe("error");
});
it("filters region and search without treating SQL wildcards as text matches", async () => {
  expect((await officialReport("mof", day, "부산")).rows).toEqual([]);
  expect((await officialReport("mof", day, "충남", "서천")).rows).toHaveLength(
    1,
  );
  expect((await officialReport("mof", day, "", "%")).rows).toEqual([]);
  expect((await officialReport("mof", "2026-01-03")).latest).toBe(day);
});
it("skips repeated scheduled work and future dates", async () => {
  const collector = vi.fn();
  expect((await syncDay("mof", day, { collector })).status).toBe("skipped");
  expect(collector).not.toHaveBeenCalled();
  await expect(syncDay("mof", "2999-01-01", { collector })).rejects.toThrow();
});

it("retains both KAMIS stages when a later response omits one", async () => {
  const wholesale = normalizeKamis(kamis("5500"), day, "wholesale")[0];
  const retail = normalizeKamis(kamis("6500"), day, "retail")[0];
  await syncDay("kamis", day, {
    force: true,
    collector: async () => [wholesale, retail],
  });
  const result = await syncDay("kamis", day, {
    force: true,
    collector: async () => [{ ...retail, low: 6600, high: 6600 }],
  });
  expect(result.status).toBe("error");
  const report = await officialReport("kamis", day);
  expect(report.total).toBe(2);
  expect(report.rows.map((row) => row.data.low).sort()).toEqual([5500, 6500]);
});

it("parses the live MOF responseJson envelope and header pagination", () => {
  const responseJson = {
    header: { resultCode: "00", totalCount: 1, pageNo: 1, numOfRows: 100 },
    body: { item: [raw] },
  };
  expect(parseMofPage({ responseJson })).toEqual({ rows: [raw], total: 1 });
  expect(
    parseMofPage({ responseJson: { ...responseJson, body: { item: raw } } }),
  ).toEqual({ rows: [raw], total: 1 });
  expect(
    parseMofPage({
      responseJson: {
        header: { resultCode: "00", totalCount: 0 },
        body: { item: [] },
      },
    }),
  ).toEqual({ rows: [], total: 0 });
  expect(() =>
    parseMofPage({
      responseJson: { header: { resultCode: "30" }, body: { item: [] } },
    }),
  ).toThrow();
});

it("excludes explicit zero-price MOF records without hiding malformed ranges", () => {
  const zero = { ...raw, lprc: "0", hghpc: "0" };
  expect(normalizeMof([raw, zero], day, new Map())).toHaveLength(1);
  expect(() =>
    normalizeMof([{ ...zero, csmtDe: "20260101" }], day, new Map()),
  ).toThrow();
  expect(normalizeMof([{ ...raw, lprc: "0" }], day, new Map())).toEqual([]);
  expect(normalizeMof([{ ...raw, hghpc: "0" }], day, new Map())).toEqual([]);
  expect(() =>
    normalizeMof([{ ...zero, hghpc: "-1" }], day, new Map()),
  ).toThrow();
  expect(() => normalizeMof([{ ...raw, lprc: "" }], day, new Map())).toThrow();
});

it("paginates live responseJson pages using header totals", async () => {
  const fetcher = vi.fn().mockImplementation(async (url: URL) => {
    const pageNo = Number(url.searchParams.get("pageNo"));
    return Response.json({
      responseJson: {
        header: { resultCode: "00", totalCount: 2, pageNo, numOfRows: 100 },
        body: { item: [{ ...raw, csmtmktCode: String(pageNo) }] },
      },
    });
  });
  const rows = await mofRows("0050", day, "test-key", fetcher);
  expect(rows.map((row) => row.csmtmktCode)).toEqual(["1", "2"]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
