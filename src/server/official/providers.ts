import { createHash } from "node:crypto";

export const sources = {
  mof: {
    name: "해양수산부 · 수협 위판",
    url: "https://www.data.go.kr/data/15059417/openapi.do",
  },
  kamis: {
    name: "aT KAMIS",
    url: "https://www.kamis.or.kr/customer/reference/openapi_list.do",
  },
} as const;
export type Provider = keyof typeof sources;
export type Observation = {
  key: string;
  day: string;
  region: string;
  market: string;
  species: string;
  state: string;
  grade: string;
  unit: string;
  kind: "auction" | "wholesale" | "retail";
  low: number;
  high: number;
  previous: number | null;
  week: number | null;
};
type Row = Record<string, unknown>;
function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("응답 구조를 확인할 수 없습니다");
  return value as Row;
}
function list(value: unknown): Row[] {
  if (value == null || value === "") return [];
  return (Array.isArray(value) ? value : [value]).map(object);
}
function str(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}
export function validDay(day: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    !Number.isNaN(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day
  );
}
export function amount(value: unknown): number | null {
  const text = str(value).replaceAll(",", "");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 && n <= 1e12 ? n : null;
}
function identity(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
export function regionFromAddress(address: string): string {
  const names: Record<string, string> = {
    서울: "서울",
    부산: "부산",
    대구: "대구",
    인천: "인천",
    광주: "광주",
    대전: "대전",
    울산: "울산",
    세종: "세종",
    경기: "경기",
    강원: "강원",
    충북: "충북",
    충남: "충남",
    전남: "전남",
    경북: "경북",
    경남: "경남",
    충청북: "충북",
    충청남: "충남",
    전라북: "전북",
    전북: "전북",
    전라남: "전남",
    경상북: "경북",
    경상남: "경남",
    제주: "제주",
  };
  return (
    Object.entries(names).find(([prefix]) => address.startsWith(prefix))?.[1] ||
    "지역 미확인"
  );
}
export function parseMofPage(payload: unknown): { rows: Row[]; total: number } {
  const root = object(payload),
    response = object(root.response ?? root);
  const header = object(response.header);
  if (str(header.resultCode) !== "00")
    throw new Error(
      "해양수산부 응답 오류 · 인증 또는 제공 상태를 확인해주세요",
    );
  const body = object(response.body),
    total = Number(body.totalCount);
  if (!Number.isSafeInteger(total) || total < 0)
    throw new Error("해양수산부 전체 건수가 올바르지 않습니다");
  const items = body.items;
  const rows = list(
    items && typeof items === "object" && !Array.isArray(items)
      ? object(items).item
      : items,
  );
  if (total > 0 && !rows.length)
    throw new Error("해양수산부 응답이 일부 누락되었습니다");
  return { rows, total };
}
export function normalizeMof(
  rows: Row[],
  day: string,
  locations: Map<string, string>,
): Observation[] {
  return rows.map((r) => {
    const rawDay = str(r.csmtDe),
      basis = rawDay.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
    const low = amount(r.lprc),
      high = amount(r.hghpc);
    if (
      basis !== day ||
      !low ||
      !high ||
      high < low ||
      !str(r.csmtmktCode) ||
      !str(r.mprcStdCode) ||
      !str(r.mprcStdCodeNm) ||
      !str(r.goodsUnitNm)
    )
      throw new Error("위판 자료의 날짜·가격·단위가 올바르지 않습니다");
    return {
      key: identity([
        r.mxtrCode,
        r.csmtmktCode,
        r.mprcStdCode,
        r.goodsStndrdCode,
        r.goodsUnitCode,
        r.kdfshSttusCode,
      ]),
      day,
      region: locations.get(str(r.csmtmktCode)) || "지역 미확인",
      market: [str(r.mxtrNm), str(r.csmtmktNm)].filter(Boolean).join(" · "),
      species: str(r.mprcStdCodeNm),
      state: str(r.kdfshSttusNm) || "상태 미제공",
      grade: str(r.goodsStndrdNm) || "규격 미제공",
      unit: str(r.goodsUnitNm),
      kind: "auction",
      low,
      high,
      previous: null,
      week: null,
    };
  });
}
export function normalizeKamis(
  payload: unknown,
  day: string,
  kind: "wholesale" | "retail",
): Observation[] {
  const root = object(payload);
  // KAMIS represents no-data as data:["001"], unlike successful data objects.
  if (
    Array.isArray(root.data) &&
    root.data.length === 1 &&
    root.data[0] === "001"
  )
    return [];
  const data = object(root.data);
  if (str(data.error_code) === "001") return [];
  if (str(data.error_code) !== "000")
    throw new Error("KAMIS 응답 오류 · 인증 또는 제공 상태를 확인해주세요");
  const condition = list(root.condition)[0];
  if (!condition || str(condition.p_regday) !== day)
    throw new Error("KAMIS 기준일이 요청과 다릅니다");
  const rows = list(data.item);
  return rows.flatMap((r) => {
    const price = amount(r.dpr1);
    if (str(r.dpr1) === "-" || str(r.dpr1) === "") return [];
    if (!price || !str(r.item_name) || !str(r.unit))
      throw new Error("KAMIS 가격·품목·단위가 올바르지 않습니다");
    return [
      {
        key: identity([
          kind,
          r.item_code ?? r.itemcode,
          r.item_name,
          r.kind_code ?? r.kindcode,
          r.kind_name,
          r.rank,
          r.unit,
        ]),
        day,
        region: "전국",
        market: "전국 조사 평균",
        species: str(r.item_name),
        state: str(r.kind_name) || "구분 미제공",
        grade: str(r.rank) || "등급 미제공",
        unit: str(r.unit),
        kind,
        low: price,
        high: price,
        previous: amount(r.dpr2),
        week: amount(r.dpr3),
      },
    ];
  });
}
export type Fetcher = typeof fetch;
async function json(
  url: URL,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<unknown> {
  // Never bubble up a fetch error containing a credential-bearing URL.
  try {
    const res = await fetcher(url, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
      cache: "no-store",
      redirect: "error",
    });
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    throw new Error(
      "공식 제공처에 연결하지 못했습니다. 잠시 후 다시 시도해주세요",
    );
  }
}
export async function mofRows(
  service: "0020" | "0050",
  day: string,
  key: string,
  fetcher: Fetcher = fetch,
  signal: AbortSignal = AbortSignal.timeout(60000),
): Promise<Row[]> {
  const rows: Row[] = [];
  let expected: number | undefined;
  for (let page = 1; page <= 100; page++) {
    signal.throwIfAborted();
    const url = new URL(
      `https://apis.data.go.kr/1192000/select${service}List/getselect${service}List`,
    );
    // Accept either portal key representation, without double encoding.
    let decoded = key;
    try {
      decoded = decodeURIComponent(key);
    } catch {
      /* raw key */
    }
    const params: Record<string, string> = {
      serviceKey: decoded,
      numOfRows: "999",
      pageNo: String(page),
      type: "json",
    };
    if (service === "0050") params.baseDt = day.replaceAll("-", "");
    url.search = new URLSearchParams(params).toString();
    const result = parseMofPage(await json(url, fetcher, signal));
    if (expected !== undefined && expected !== result.total)
      throw new Error("수집 중 자료 건수가 변경되었습니다. 다시 수집합니다");
    expected = result.total;
    rows.push(...result.rows);
    if (rows.length === expected) return rows;
    if (rows.length > expected || !result.rows.length)
      throw new Error("위판 자료 페이지가 올바르지 않습니다");
  }
  throw new Error("위판 자료 조회 한도를 초과했습니다");
}
export function configured(provider: Provider): boolean {
  return provider === "mof"
    ? !!process.env.MOF_SERVICE_KEY
    : !!(process.env.KAMIS_CERT_KEY && process.env.KAMIS_CERT_ID);
}
export async function collect(
  provider: Provider,
  day: string,
  fetcher: Fetcher = fetch,
): Promise<Observation[]> {
  if (!validDay(day)) throw new Error("기준일을 확인해주세요");
  if (!configured(provider)) throw new Error("인증키 설정이 필요합니다");
  const signal = AbortSignal.timeout(60000);
  if (provider === "mof") {
    const key = process.env.MOF_SERVICE_KEY!;
    const locations = await mofRows("0020", day, key, fetcher, signal);
    return normalizeMof(
      await mofRows("0050", day, key, fetcher, signal),
      day,
      new Map(
        locations.map((r) => [
          str(r.csmtmktCode),
          regionFromAddress(str(r.addr)),
        ]),
      ),
    );
  }
  const observations: Observation[] = [];
  for (const kind of ["wholesale", "retail"] as const) {
    const url = new URL("https://www.kamis.or.kr/service/price/xml.do");
    url.search = new URLSearchParams({
      action: "dailyPriceByCategoryList",
      p_cert_key: process.env.KAMIS_CERT_KEY!,
      p_cert_id: process.env.KAMIS_CERT_ID!,
      p_returntype: "json",
      p_product_cls_code: kind === "retail" ? "01" : "02",
      p_item_category_code: "600",
      p_country_code: "",
      p_regday: day,
      p_convert_kg_yn: "N",
    }).toString();
    observations.push(
      ...normalizeKamis(await json(url, fetcher, signal), day, kind),
    );
  }
  return observations;
}
