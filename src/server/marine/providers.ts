import { createHash } from "node:crypto";
import { z } from "zod";
import {
  parseMofPage,
  regionFromAddress,
  validDay,
} from "../official/providers";
import {
  grid,
  portFor,
  shiftDay,
  sources,
  tideCode,
  type Source,
} from "./model";

export type Row = Record<string, unknown>;
// Verified against getFcstZoneCd on 2026-10-08. Query exact codes because the
// unfiltered endpoint reports the page size as totalCount, truncating the list.
const seaZones = [
  ["12A20100", "서해중부앞바다"],
  ["12A30100", "서해남부앞바다"],
  ["12B10100", "남해서부앞바다"],
  ["12B20100", "남해동부앞바다"],
  ["12C10100", "동해남부앞바다"],
  ["12C20100", "동해중부앞바다"],
  ["12B10300", "제주도앞바다"],
] as const;
export type Job = {
  id: string;
  source: Source;
  scope: string;
  basis_day: string;
  page: number;
  expected: number | null;
  generation: string;
  token: string;
  attempts: number;
  started_at?: string;
};
export class FeedError extends Error {
  constructor(
    public code: "pending" | "error" | "quota" | "retry" | "empty",
    message: string,
  ) {
    super(message);
  }
}
const obj = (v: unknown) => z.record(z.string(), z.unknown()).parse(v);
const text = (v: unknown) =>
  typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
function number(v: unknown, min = 0, max = 1e15) {
  const s = text(v).replaceAll(",", "");
  if (
    !/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s) ||
    !Number.isFinite(Number(s)) ||
    Number(s) < min ||
    Number(s) > max
  )
    throw new FeedError("error", "수치 또는 단위를 확인할 수 없습니다.");
  return Number(s);
}
function required(v: unknown) {
  const s = text(v);
  if (!s || s.length > 500) throw new FeedError("error", "필수 항목 누락");
  return s;
}
export function parsePage(value: unknown, source: Source) {
  const root = obj(value),
    response = obj(root.responseJson ?? root.response ?? root),
    header = obj(response.header);
  if (text(header.resultCode) !== "00") {
    const code = text(header.resultCode);
    if (["03", "3"].includes(code))
      throw new FeedError("empty", "제공처 자료 없음 · 재확인 예정");
    if (code === "22")
      throw new FeedError("quota", "제공처 일일 요청 한도 · 다음 날 재시도");
    throw new FeedError(
      ["20", "21", "30", "31", "32"].includes(code) ? "pending" : "error",
      "제공처 승인·인증 또는 응답 상태 확인 필요",
    );
  }
  if (source === "auction" || source === "markets") return parseMofPage(value);
  const body = obj(response.body),
    items = body.items;
  const container =
    items && typeof items === "object" && !Array.isArray(items)
      ? obj(items)
      : {};
  const total = number(body.totalCount ?? container.totalCount, 0, 2000000);
  if (!Number.isInteger(total)) throw new FeedError("error", "전체 건수 오류");
  const raw = container.item ?? (Array.isArray(items) ? items : []);
  const rows = (Array.isArray(raw) ? raw : [raw]).map(obj);
  if ((total > 0 && !rows.length) || rows.length > total)
    throw new FeedError("error", "응답 페이지 누락");
  return { rows, total };
}
export async function fetchPage(
  job: Job,
  zoneCode: string | undefined,
  reserve: () => Promise<void>,
  fetcher = fetch,
) {
  const port = portFor(job.scope),
    key = process.env[sources[job.source].env];
  if (!key)
    throw new FeedError("pending", "API 활용신청·승인 및 인증키 설정 대기");
  let endpoint: string;
  const params: Record<string, string> = {
    numOfRows: "100",
    pageNo: String(job.page),
  };
  if (job.source === "markets") {
    endpoint = "1192000/select0020List/getselect0020List";
    params.type = "json";
  } else if (job.source === "auction") {
    endpoint = "1192000/select0030List/getselect0030List";
    Object.assign(params, {
      type: "json",
      baseDt: job.basis_day.replaceAll("-", ""),
    });
  } else if (job.source === "tide") {
    const code = tideCode(port);
    if (!code)
      throw new FeedError("pending", "공식 조석 관측소 코드 설정 대기");
    endpoint = "1192136/tideFcstHghLw/GetTideFcstHghLwApiService";
    Object.assign(params, {
      type: "json",
      obsCode: code,
      reqDate: job.basis_day.replaceAll("-", ""),
    });
  } else {
    params.dataType = "JSON";
    if (job.source === "zones") {
      endpoint = "1360000/FcstZoneInfoService/getFcstZoneCd";
      const zone = seaZones[job.page - 1];
      if (!zone) throw new FeedError("error", "예보구역 조회 순번 오류");
      params.regId = zone[0];
      params.pageNo = "1";
    } else if (job.source === "warning") {
      endpoint = "1360000/WthrWrnInfoService/getPwnStatus";
    } else if (job.source === "sea") {
      if (!zoneCode)
        throw new FeedError("pending", "공식 해상 예보구역 확인 대기");
      endpoint = "1360000/VilageFcstMsgService/getSeaFcst";
      params.regId = zoneCode;
    } else {
      endpoint = "1360000/VilageFcstInfoService_2.0/getVilageFcst";
      // One-hour publication allowance, then the most recent 02/05/.../23 KST issue.
      const local = new Date(
        (job.started_at ? new Date(job.started_at).getTime() : Date.now()) +
          8 * 3600000,
      );
      let hour = local.getUTCHours();
      if (hour < 2) {
        local.setUTCDate(local.getUTCDate() - 1);
        hour = 23;
      } else hour = 2 + Math.floor((hour - 2) / 3) * 3;
      Object.assign(params, grid(port.lat, port.lon), {
        base_date: local.toISOString().slice(0, 10).replaceAll("-", ""),
        base_time: String(hour).padStart(2, "0") + "00",
      });
    }
  }
  let decoded = key;
  try {
    decoded = decodeURIComponent(key);
  } catch {
    /* raw key */
  }
  params.serviceKey = decoded;
  const url = new URL("https://apis.data.go.kr/" + endpoint);
  url.search = new URLSearchParams(params).toString();
  await reserve();
  let payload: unknown;
  try {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(20000),
      redirect: "error",
      cache: "no-store",
    });
    if ([401, 403].includes(response.status))
      throw new FeedError("pending", "API 활용 승인·인증 확인 대기");
    if (!response.ok)
      throw new FeedError("retry", "제공처 연결 실패 · 이어서 재시도");
    const raw = await response.text();
    const reason = raw.match(
      /<returnReasonCode>\s*(\d+)\s*<\/returnReasonCode>/,
    )?.[1];
    if (reason === "22")
      throw new FeedError("quota", "제공처 일일 요청 한도 · 다음 날 재시도");
    if (reason && ["20", "21", "30", "31", "32"].includes(reason))
      throw new FeedError("pending", "API 활용 승인·인증 확인 대기");
    payload = JSON.parse(raw);
  } catch (e) {
    if (e instanceof FeedError) throw e;
    throw new FeedError(
      "retry",
      "제공처 연결 또는 JSON 응답 확인 필요 · 이어서 재시도",
    );
  }
  const page = parsePage(payload, job.source);
  if (job.source === "zones") {
    const [code, name] = seaZones[job.page - 1];
    if (
      page.total !== 1 ||
      page.rows.length !== 1 ||
      text(page.rows[0].regId) !== code ||
      text(page.rows[0].regName) !== name
    )
      throw new FeedError("error", "공식 해상 예보구역 코드·이름 불일치");
    // One verified zone per persisted worker page; publish all seven atomically.
    return { rows: page.rows, total: seaZones.length };
  }
  if (job.source === "sea" && page.rows.some((r) => text(r.regId) !== zoneCode))
    throw new FeedError("error", "해상 예보구역 불일치");
  return page;
}
export function normalizeAuction(
  rows: Row[],
  day: string,
  regions = new Map<string, string>(),
) {
  const seen = new Set<string>();
  return rows.map((r) => {
    if (text(r.csmtDe).replaceAll("-", "") !== day.replaceAll("-", ""))
      throw new FeedError("error", "위판 기준일 불일치");
    const rowKey = createHash("sha256")
      .update(
        JSON.stringify([
          required(r.mxtrCode),
          required(r.csmtmktCode),
          required(r.prchasNo),
          required(r.prchasSn),
        ]),
      )
      .digest("hex");
    if (seen.has(rowKey))
      throw new FeedError("error", "위판 원자료 식별자 중복");
    seen.add(rowKey);
    // Do not assume the undocumented weight field is kg. Operator confirms the
    // provider contract once; until then amount is retained, kg metrics withheld.
    const weight = number(r.csmtWt);
    return {
      row_key: rowKey,
      region: regions.get(text(r.csmtmktCode)) || "지역 미확인",
      market: [required(r.mxtrNm), required(r.csmtmktNm)].join(" · "),
      species: required(r.mprcStdCodeNm),
      state: text(r.kdfshSttusNm) || "상태 미제공",
      grade: text(r.goodsStndrdNm) || "규격 미제공",
      unit: required(r.goodsUnitNm),
      weight: process.env.AUCTION_WEIGHT_UNIT === "kg" ? weight : null,
      amount: number(r.csmtAmount),
    };
  });
}
function timestamp(value: unknown) {
  const s = required(value).replace(/[- :T]/g, "");
  if (!/^\d{12}(\d{2})?$/.test(s))
    throw new FeedError("error", "발표 시각 형식 오류");
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:00+09:00`;
  if (
    !validDay(iso.slice(0, 10)) ||
    Number(s.slice(8, 10)) > 23 ||
    Number(s.slice(10, 12)) > 59 ||
    !Number.isFinite(Date.parse(iso))
  )
    throw new FeedError("error", "발표 시각 오류");
  return iso;
}
export function normalize(job: Job, rows: Row[]) {
  if (!rows.length)
    throw new FeedError("error", "빈 응답 · 기존 자료 보존, 재확인 예정");
  const port = portFor(job.scope);
  let issuedAt: string | null = null;
  let data: unknown;
  if (job.source === "markets") {
    data = rows
      .map((r) => ({
        code: required(r.csmtmktCode),
        region: regionFromAddress(text(r.addr)),
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
  } else if (job.source === "tide") {
    data = rows
      .map((r) => {
        if (required(r.obsvtrNm) !== port.station)
          throw new FeedError("error", "조석 관측소 이름 불일치");
        const at = timestamp(r.predcDt),
          code = number(r.extrSe, 1, 4);
        if (at.slice(0, 10) !== job.basis_day || !Number.isInteger(code))
          throw new FeedError("error", "조석 기준일·구분 오류");
        return {
          at,
          height: number(r.predcTdlvVl, -2000, 3000),
          kind: code === 1 || code === 3 ? "만조" : "간조",
        };
      })
      .sort((a, b) => a.at.localeCompare(b.at));
  } else if (job.source === "zones") {
    data = rows.map((r) => ({
      code: required(r.regId),
      name: required(r.regName),
    }));
  } else if (job.source === "sea") {
    data = rows.map((r) => {
      const at = timestamp(r.tmFc),
        n = number(r.numEf, 0, 9);
      if (!Number.isInteger(n)) throw new FeedError("error", "발효번호 오류");
      if (issuedAt && issuedAt !== at)
        throw new FeedError("error", "발표 회차 혼합");
      issuedAt = at;
      // KMA 05 issues start at today's AM; 11/17 issues at today's PM.
      const slot = n + (Number(at.slice(11, 13)) >= 11 ? 1 : 0);
      return {
        day: shiftDay(at.slice(0, 10), Math.floor(slot / 2)),
        period: slot % 2 ? "오후" : "오전",
        weather: required(r.wf),
        wind: `${required(r.wd1)} ~ ${required(r.wd2)}`,
        windMin: number(r.ws1, 0, 150),
        windMax: number(r.ws2, 0, 150),
        waveMin: number(r.wh1, 0, 50),
        waveMax: number(r.wh2, 0, 50),
      };
    });
  } else if (job.source === "land") {
    data = rows
      .filter((r) => ["TMP", "POP", "SKY", "PTY"].includes(text(r.category)))
      .map((r) => {
        const at = timestamp(text(r.baseDate) + text(r.baseTime));
        if (issuedAt && issuedAt !== at)
          throw new FeedError("error", "발표 회차 혼합");
        issuedAt = at;
        return {
          at: timestamp(text(r.fcstDate) + text(r.fcstTime)),
          category: text(r.category),
          value: number(r.fcstValue, -90, 100),
        };
      });
    if (!(data as unknown[]).length)
      throw new FeedError("error", "육상예보 항목 누락");
  } else if (job.source === "warning") {
    // Keep the national bulletin intact; never infer local absence from text.
    const latest = rows
      .map((r) => ({
        at: timestamp(r.tmFc),
        text: z.string().min(1).max(10000).parse(r.t6),
      }))
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    data = [latest];
    issuedAt = (data as { at: string }[])
      .map((r) => r.at)
      .sort()
      .at(-1)!;
  } else {
    throw new FeedError("error", "지원하지 않는 수집 작업");
  }
  return { data, issuedAt };
}
