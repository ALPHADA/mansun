import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import { change, grid, nextRun, shiftDay } from "../src/server/marine/model";
import {
  fetchPage,
  normalize,
  normalizeAuction,
  parsePage,
  type Job,
} from "../src/server/marine/providers";
import {
  claimJob,
  processJob,
  seedJobs,
  retryJob,
} from "../src/server/marine/worker";
import { conditions, trends } from "../src/server/marine/queries";
import { mutate } from "../src/server/mutations";
import type { User } from "../src/lib/model";
const day = "2026-01-02";
const raw = {
  csmtDe: "20260102",
  mxtrCode: "317",
  mxtrNm: "서천군수협",
  csmtmktCode: "317001",
  csmtmktNm: "판매사업팀",
  prchasNo: "1",
  prchasSn: "1",
  mprcStdCodeNm: "갑오징어",
  kdfshSttusNm: "선어",
  goodsStndrdNm: "대",
  goodsUnitNm: "상자",
  csmtWt: "10",
  csmtAmount: "10000",
};
function job(source: Job["source"] = "auction"): Job {
  return {
    id: `${source}:national:${day}`,
    source,
    scope: source === "tide" ? "sinjin" : "national",
    basis_day: day,
    page: 1,
    expected: null,
    generation: randomUUID(),
    token: randomUUID(),
    attempts: 0,
  };
}
const payload = (rows: unknown[], total = rows.length) => ({
  response: {
    header: { resultCode: "00" },
    body: { totalCount: total, items: { item: rows } },
  },
});
const response = (rows: unknown[], total = rows.length) =>
  new Response(JSON.stringify(payload(rows, total)));
async function insert(j: Job) {
  await db()`INSERT INTO marine_jobs(id,source,scope,basis_day,generation) VALUES(${j.id},${j.source},${j.scope},${j.basis_day},${j.generation})`;
}
async function clear() {
  await db()`DELETE FROM marine_jobs`;
  await db()`DELETE FROM marine_auction_rows`;
  await db()`DELETE FROM marine_auction_days`;
  await db()`DELETE FROM marine_snapshots`;
  await db()`DELETE FROM marine_quota`;
  await db()`DELETE FROM marine_settings`;
}
beforeAll(async () => {
  await db().unsafe(await readFile("scripts/schema.sql", "utf8"));
  await db().unsafe(await readFile("scripts/marine-schema.sql", "utf8"));
});
beforeEach(clear);
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await clear();
  await db().end();
});
it("uses KST schedules across midnight and preserves missing versus zero comparisons", () => {
  expect(nextRun("tide", new Date("2026-01-01T15:21:00Z")).toISOString()).toBe(
    "2026-01-02T15:20:00.000Z",
  );
  expect(
    nextRun("auction", new Date("2026-01-01T21:30:00Z")).toISOString(),
  ).toBe("2026-01-02T03:30:00.000Z");
  expect(change(5, 0)).toMatchObject({ delta: 5, percent: null });
  expect(change(5, null)).toMatchObject({ delta: null, percent: null });
  expect(grid(37.5665, 126.978)).toEqual({ nx: "60", ny: "127" });
});
it("rejects malformed/authentication pages and accepts tide's nested count", () => {
  expect(
    parsePage(
      {
        response: {
          header: { resultCode: "00" },
          body: { items: { totalCount: 1, item: { extrSe: "1" } } },
        },
      },
      "tide",
    ).rows,
  ).toHaveLength(1);
  expect(() => parsePage(payload([], 2), "sea")).toThrow();
  expect(() =>
    parsePage({ response: { header: { resultCode: "30" } } }, "land"),
  ).toThrow();
});
it("validates tide station, real dates, high/low meaning and negative heights", () => {
  const j = job("tide"),
    r = {
      obsvtrNm: "안흥",
      predcDt: "2026-01-02 03:10:00",
      predcTdlvVl: -10,
      extrSe: 2,
    };
  expect(normalize(j, [r]).data).toEqual([
    { at: "2026-01-02T03:10:00+09:00", height: -10, kind: "간조" },
  ]);
  expect(() => normalize(j, [{ ...r, obsvtrNm: "부산" }])).toThrow();
  expect(() =>
    normalize(j, [{ ...r, predcDt: "2026-02-30 03:10:00" }]),
  ).toThrow();
});
it("keeps only the latest national warning bulletin and rejects blank/unavailable", () => {
  const j = job("warning");
  expect(
    normalize(j, [
      { tmFc: "202601020500", t6: "풍랑주의보" },
      { tmFc: "202601021100", t6: "o 없음" },
    ]).data,
  ).toEqual([{ at: "2026-01-02T11:00:00+09:00", text: "o 없음" }]);
  expect(() => normalize(j, [])).toThrow();
  expect(() => normalize(j, [{ tmFc: "202601021100", t6: "" }])).toThrow();
});
it("does not invent kg units or accept duplicate purchase rows", () => {
  vi.stubEnv("AUCTION_WEIGHT_UNIT", "");
  expect(normalizeAuction([raw], day)[0].weight).toBeNull();
  vi.stubEnv("AUCTION_WEIGHT_UNIT", "kg");
  expect(normalizeAuction([raw], day)[0].weight).toBe(10);
  expect(() => normalizeAuction([raw, raw], day)).toThrow();
  expect(() => normalizeAuction([{ ...raw, csmtWt: "-1" }], day)).toThrow();
});
it("claims a due job once under concurrent workers and resumes a persisted page", async () => {
  vi.stubEnv("AUCTION_SERVICE_KEY", "fixture");
  vi.stubEnv("AUCTION_WEIGHT_UNIT", "kg");
  await insert(job());
  const claims = await Promise.all([claimJob("auction"), claimJob("auction")]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  await processJob(
    claims.find(Boolean)!,
    vi.fn(async () => response([raw], 2)),
  );
  expect(await db()`SELECT * FROM marine_auction_days`).toHaveLength(0);
  const second = await claimJob("auction");
  expect(second?.page).toBe(2);
  await db()`UPDATE marine_jobs SET lease_until=now()-interval '1 minute' WHERE id=${second!.id}`;
  const resumed = await claimJob("auction");
  expect(resumed?.page).toBe(2);
  // A dead worker's old token cannot publish.
  await processJob(
    second!,
    vi.fn(async () => response([{ ...raw, prchasSn: "2" }], 2)),
  );
  expect(await db()`SELECT * FROM marine_auction_days`).toHaveLength(0);
  await processJob(
    resumed!,
    vi.fn(async () => response([{ ...raw, prchasSn: "2" }], 2)),
  );
  expect(await db()`SELECT * FROM marine_auction_rows`).toHaveLength(2);
  expect(await db()`SELECT * FROM marine_pages`).toHaveLength(0);
});
it("rolls back a changed page total and preserves a previous successful day", async () => {
  vi.stubEnv("AUCTION_SERVICE_KEY", "fixture");
  await insert(job());
  await db()`INSERT INTO marine_auction_days(day,item_count) VALUES(${day},1)`;
  const first = await claimJob("auction");
  await processJob(
    first!,
    vi.fn(async () => response([raw], 2)),
  );
  await processJob(
    (await claimJob("auction"))!,
    vi.fn(async () => response([{ ...raw, prchasSn: "2" }], 3)),
  );
  expect(
    (await db()`SELECT item_count FROM marine_auction_days`)[0].item_count,
  ).toBe(1);
  expect((await db()`SELECT status,page FROM marine_jobs`)[0]).toMatchObject({
    status: "error",
    page: 1,
  });
});
it("never calls upstream without a key and persists approval pending", async () => {
  vi.stubEnv("AUCTION_SERVICE_KEY", "");
  await insert(job());
  const fetcher = vi.fn();
  await processJob((await claimJob("auction"))!, fetcher);
  expect(fetcher).not.toHaveBeenCalled();
  expect((await db()`SELECT status FROM marine_jobs`)[0].status).toBe(
    "pending",
  );
});
it("retains weather snapshots on malformed updates and marks them stale", async () => {
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  await db()`INSERT INTO marine_snapshots(source,scope,basis_day,data,fetched_at) VALUES('tide','sinjin',${today},'[]',now()-interval '2 days')`;
  expect((await conditions("sinjin", today)).feeds.tide.status).toBe("stale");
  expect((await conditions("sinjin", today)).feeds.warning.status).toBe(
    "pending",
  );
});
it("computes weighted prices, calendar day changes, and rolling seven-day coverage", async () => {
  for (let n = 0; n < 14; n++) {
    const d = shiftDay(day, -n);
    await db()`INSERT INTO marine_auction_days(day,item_count) VALUES(${d},2)`;
    await db()`INSERT INTO marine_auction_rows(day,row_key,region,market,species,state,grade,unit,weight,amount) VALUES(${d},'a','충남','서천','갑오징어','선어','대','상자',10,10000),(${d},'b','충남','서천','갑오징어','선어','대','상자',30,60000)`;
  }
  const r = await trends({ day, period: "week" });
  expect(r.weight).toBe(280);
  expect(r.amount).toBe(490000);
  expect(r.groups[0].price).toBe(1750);
  expect(r.weightChange.percent).toBe(0);
  await db()`DELETE FROM marine_auction_rows WHERE day=${shiftDay(day, -8)}`;
  await db()`DELETE FROM marine_auction_days WHERE day=${shiftDay(day, -8)}`;
  expect((await trends({ day, period: "week" })).weightChange.delta).toBeNull();
  expect((await trends({ day, region: "부산" })).weight).toBe(0);
});
it("seeds durable recent-30-day backfill and seven tide days idempotently", async () => {
  await seedJobs();
  await seedJobs();
  expect(
    (await db()`SELECT * FROM marine_jobs WHERE source='auction'`).length,
  ).toBe(30);
  expect(
    (await db()`SELECT * FROM marine_jobs WHERE source='tide'`).length,
  ).toBe(70);
});
it("denies retry to non-admin users before looking up the job", async () => {
  await expect(
    mutate({ admin: false } as User, "admin/data/retry", { id: job().id }),
  ).rejects.toMatchObject({ status: 403 });
});
it("distinguishes a disappearing species from missing days and withholds incomplete group totals", async () => {
  for (const d of [day, shiftDay(day, -1)])
    await db()`INSERT INTO marine_auction_days(day,item_count) VALUES(${d},1)`;
  await db()`INSERT INTO marine_auction_rows(day,row_key,region,market,species,state,grade,unit,weight,amount) VALUES(${shiftDay(day, -1)},'a','충남','서천','갑오징어','선어','대','상자',10,10000)`;
  const current = await trends({ day });
  expect(current.groups[0]).toMatchObject({
    weight: 0,
    amount: 0,
    change: { delta: -10, percent: -100 },
  });
  const partial = await trends({ day, period: "week" });
  expect(partial.groups[0]).toMatchObject({
    weight: null,
    amount: null,
    price: null,
  });
});
it("does not dilute a weighted price with missing or zero-weight proceeds", async () => {
  await db()`INSERT INTO marine_auction_days(day,item_count) VALUES(${day},2)`;
  await db()`INSERT INTO marine_auction_rows(day,row_key,region,market,species,state,grade,unit,weight,amount) VALUES(${day},'a','충남','서천','갑오징어','선어','대','상자',10,10000),(${day},'b','충남','서천','갑오징어','선어','대','상자',0,10000)`;
  expect((await trends({ day })).groups[0]).toMatchObject({
    amount: 20000,
    weight: 10,
    price: null,
  });
});
it("retains page checkpoints on HTTP failure and daily quota exhaustion", async () => {
  vi.stubEnv("AUCTION_SERVICE_KEY", "fixture");
  await insert(job());
  await processJob(
    (await claimJob("auction"))!,
    vi.fn(async () => response([raw], 2)),
  );
  await processJob(
    (await claimJob("auction"))!,
    vi.fn(async () => new Response("unavailable", { status: 503 })),
  );
  expect((await db()`SELECT page,status FROM marine_jobs`)[0]).toMatchObject({
    page: 2,
    status: "error",
  });
  expect(await db()`SELECT * FROM marine_pages`).toHaveLength(1);
  await db()`UPDATE marine_jobs SET next_run=now()`;
  await db()`UPDATE marine_quota SET calls=8000`;
  const fetcher = vi.fn();
  await processJob((await claimJob("auction"))!, fetcher);
  expect(fetcher).not.toHaveBeenCalled();
  expect((await db()`SELECT page,status FROM marine_jobs`)[0]).toMatchObject({
    page: 2,
    status: "quota",
  });
  expect(await db()`SELECT * FROM marine_pages`).toHaveLength(1);
});
it("classifies successful zero rows as empty without replacing the last good data", async () => {
  vi.stubEnv("AUCTION_SERVICE_KEY", "fixture");
  await insert(job());
  await db()`INSERT INTO marine_auction_days(day,item_count) VALUES(${day},10)`;
  await processJob(
    (await claimJob("auction"))!,
    vi.fn(async () => response([])),
  );
  expect((await db()`SELECT status,next_run FROM marine_jobs`)[0].status).toBe(
    "empty",
  );
  expect(
    (await db()`SELECT item_count FROM marine_auction_days`)[0].item_count,
  ).toBe(10);
});
it("maps 05/11/17 marine issues to correct half-day periods", () => {
  const r = {
    regId: "12A20100",
    numEf: 1,
    wd1: "N",
    wd2: "NW",
    ws1: 6,
    ws2: 10,
    wh1: 0.5,
    wh2: 1,
    wf: "구름많음",
  };
  expect(
    normalize(job("sea"), [{ ...r, tmFc: "202601020500" }]).data,
  ).toMatchObject([{ day, period: "오후" }]);
  for (const hour of ["11", "17"])
    expect(
      normalize(job("sea"), [{ ...r, tmFc: `20260102${hour}00` }]).data,
    ).toMatchObject([{ day: "2026-01-03", period: "오전" }]);
});
it("returns pending for MOF credential errors without leaking provider text", () => {
  expect(() =>
    parsePage(
      {
        responseJson: { header: { resultCode: "30", resultMsg: "secret-url" } },
      },
      "auction",
    ),
  ).toThrow("제공처 승인");
});
it("does not cancel an administrator's due retry for an old empty day", async () => {
  await insert(job());
  await db()`UPDATE marine_jobs SET status='empty',next_run=now()+interval '1 hour'`;
  await seedJobs();
  expect(
    new Date(
      (await db()`SELECT next_run FROM marine_jobs WHERE id=${job().id}`)[0]
        .next_run,
    ).getTime(),
  ).toBeGreaterThan(Date.parse("2098-12-30"));
  await retryJob(job().id);
  await seedJobs();
  expect(
    new Date(
      (await db()`SELECT next_run FROM marine_jobs WHERE id=${job().id}`)[0]
        .next_run,
    ).getTime(),
  ).toBeLessThanOrEqual(Date.now());
});
it("resets failure streaks during approval wait and classifies portal XML/NO_DATA/quota", async () => {
  vi.stubEnv("AUCTION_SERVICE_KEY", "");
  await insert(job());
  await db()`UPDATE marine_jobs SET attempts=20`;
  await processJob((await claimJob("auction"))!, vi.fn());
  expect((await db()`SELECT attempts FROM marine_jobs`)[0].attempts).toBe(0);
  vi.stubEnv("AUCTION_SERVICE_KEY", "fixture");
  await expect(
    fetchPage(
      job(),
      undefined,
      async () => {},
      vi.fn(
        async () =>
          new Response(
            "<OpenAPI_ServiceResponse><returnReasonCode>30</returnReasonCode></OpenAPI_ServiceResponse>",
          ),
      ),
    ),
  ).rejects.toMatchObject({ code: "pending" });
  for (const [resultCode, code] of [
    ["03", "empty"],
    ["22", "quota"],
  ]) {
    await expect(
      fetchPage(
        job(),
        undefined,
        async () => {},
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({ responseJson: { header: { resultCode } } }),
            ),
        ),
      ),
    ).rejects.toMatchObject({ code });
  }
});
it("requeues the full backfill only when the unit or market mapping changes", async () => {
  vi.stubEnv("AUCTION_WEIGHT_UNIT", "");
  await seedJobs();
  await db()`UPDATE marine_jobs SET next_run='2099-01-01' WHERE source='auction'`;
  vi.stubEnv("AUCTION_WEIGHT_UNIT", "kg");
  await seedJobs();
  expect(
    (
      await db()`SELECT count(*)::int n FROM marine_jobs WHERE source='auction' AND next_run<=now()`
    )[0].n,
  ).toBe(30);
  await db()`DELETE FROM marine_jobs WHERE source!='auction'`;
  const metadata = {
    ...job("markets"),
    id: "markets:national:",
    basis_day: "",
  };
  await insert(metadata);
  vi.stubEnv("MOF_SERVICE_KEY", "fixture");
  const fetcher = vi.fn(async () =>
    response([{ csmtmktCode: "317001", addr: "충청남도 서천군" }]),
  );
  await processJob((await claimJob("weather"))!, fetcher);
  expect(
    (
      await db()`SELECT count(*)::int n FROM marine_jobs WHERE source='auction' AND next_run<=now()`
    )[0].n,
  ).toBe(30);
  await db()`UPDATE marine_jobs SET next_run='2099-01-01' WHERE source='auction'`;
  await retryJob(metadata.id);
  await processJob((await claimJob("weather"))!, fetcher);
  expect(
    (
      await db()`SELECT count(*)::int n FROM marine_jobs WHERE source='auction' AND next_run<=now()`
    )[0].n,
  ).toBe(0);
});

it("accepts provider decimals without a leading zero but rejects invalid weights", () => {
  vi.stubEnv("AUCTION_WEIGHT_UNIT", "kg");
  expect(normalizeAuction([{ ...raw, csmtWt: ".9" }], day)[0].weight).toBe(0.9);
  for (const csmtWt of ["-.9", ".", "1e3", "", "NaN"])
    expect(() => normalizeAuction([{ ...raw, csmtWt }], day)).toThrow();
});

it("collects seven exact forecast zones despite the upstream page-local totalCount", async () => {
  vi.stubEnv("KMA_SERVICE_KEY", "test-key");
  const zones = [
    ["12A20100", "서해중부앞바다"],
    ["12A30100", "서해남부앞바다"],
    ["12B10100", "남해서부앞바다"],
    ["12B20100", "남해동부앞바다"],
    ["12C10100", "동해남부앞바다"],
    ["12C20100", "동해중부앞바다"],
    ["12B10300", "제주도앞바다"],
  ];
  const reserve = vi.fn(async () => {});
  const seenPages: (string | null)[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    seenPages.push(url.searchParams.get("pageNo"));
    const zone = zones.find(
      ([code]) => code === url.searchParams.get("regId"),
    )!;
    return response([{ regId: zone[0], regName: zone[1] }]);
  }) as typeof fetch;
  for (let page = 1; page <= 7; page++) {
    const result = await fetchPage(
      { ...job("zones"), page },
      undefined,
      reserve,
      fetcher,
    );
    expect(result).toEqual({
      rows: [{ regId: zones[page - 1][0], regName: zones[page - 1][1] }],
      total: 7,
    });
  }
  expect(reserve).toHaveBeenCalledTimes(7);
  expect(seenPages).toEqual(Array(7).fill("1"));
  await insert(job("zones"));
  for (let page = 1; page <= 7; page++) {
    const claimed = await claimJob("weather");
    expect(claimed?.page).toBe(page);
    await processJob(claimed!, fetcher);
    if (page < 7)
      expect(
        await db()`SELECT * FROM marine_snapshots WHERE source='zones'`,
      ).toHaveLength(0);
  }
  const [snapshot] =
    await db()`SELECT data FROM marine_snapshots WHERE source='zones'`;
  expect(snapshot.data).toEqual(zones.map(([code, name]) => ({ code, name })));
  expect(await db()`SELECT * FROM marine_pages`).toHaveLength(0);
  await expect(
    fetchPage({ ...job("zones"), page: 8 }, undefined, reserve, fetcher),
  ).rejects.toThrow();
  for (const rows of [
    [],
    [{ regId: "12A20100", regName: "다른구역" }],
    [{ regId: "wrong", regName: "서해중부앞바다" }],
  ])
    await expect(
      fetchPage(job("zones"), undefined, reserve, async () => response(rows)),
    ).rejects.toThrow();
});

it("retains distinct source rows that reuse purchase numbers without double-counting exact repeats", () => {
  const rows = [
    raw,
    { ...raw, mprcStdCodeNm: "꽃게" },
    { ...raw, csmtWt: "12", csmtAmount: "12000" },
  ];
  rows.push({ ...raw, csmtQy: "2" } as typeof raw);
  rows.push({ ...raw, fshrCode: "172" } as typeof raw);
  const normalized = normalizeAuction(rows, day);
  expect(new Set(normalized.map((r) => r.row_key)).size).toBe(5);
  expect(normalized.reduce((sum, r) => sum + r.amount, 0)).toBe(52000);
  expect(() => normalizeAuction([...rows, { ...rows[1] }], day)).toThrow(
    "식별자 중복",
  );
});
