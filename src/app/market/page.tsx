import { taxonomy } from "@/server/queries";
import Link from "next/link";
import { currentUser } from "@/server/auth";
import { Heading, LoginGate } from "@/components/ui";
import BrokerMarket from "@/components/broker-market";
import { officialReport } from "@/server/official/queries";
import { sources, validDay } from "@/server/official/providers";
import { kstDay, money, provinces } from "@/lib/model";
export const metadata = { title: "지역 시세" };
type Params = Record<string, string | string[] | undefined>;
export default async function Market({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const raw = await searchParams;
  const p = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  const user = await currentUser();
  const tab = p.tab === "kamis" || p.tab === "broker" ? p.tab : "mof";
  const day = p.day && validDay(p.day) && p.day <= kstDay() ? p.day : kstDay();
  const regions = tab === "broker" ? (await taxonomy()).regions : provinces;
  const region = regions.includes(p.region || "") ? p.region! : "";
  const query = (p.q || "").trim().slice(0, 60);
  const page = /^\d+$/.test(p.page || "")
    ? Math.min(1000, Math.max(1, Number(p.page)))
    : 1;
  const href = (changes: Record<string, string>) =>
    `/market?${new URLSearchParams({ tab, day, ...(region ? { region } : {}), ...(query ? { q: query } : {}), ...changes })}`;
  // No official price data is queried or serialized for anonymous visitors.
  const report =
    user && tab !== "broker"
      ? await officialReport(tab, day, region, query, page)
      : null;
  return (
    <>
      <Heading
        eyebrow="MARKET REPORT"
        title="전국 수산물 가격 정보"
        description="위판 시세부터 도·소매 참고가격, 중매인 판매가까지 확인하세요."
      />
      <nav className="price-tabs" aria-label="시세 구분">
        {(
          [
            ["mof", "공식 위판"],
            ["kamis", "도·소매 참고"],
            ["broker", "중매인 판매가"],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={value}
            href={href({ tab: value })}
            aria-current={tab === value ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      <form className="price-filters">
        <input type="hidden" name="tab" value={tab} />
        <label>
          기준일
          <input
            type="date"
            name="day"
            defaultValue={day}
            max={kstDay()}
            required
          />
        </label>
        {tab !== "kamis" && (
          <label>
            지역
            <select name="region" defaultValue={region}>
              <option value="">전국</option>
              {regions.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        )}
        {tab !== "broker" && (
          <label className="price-search">
            {tab === "mof" ? "어종·위판장" : "품목"}
            <input
              type="search"
              name="q"
              defaultValue={query}
              maxLength={60}
              placeholder={tab === "mof" ? "예: 꽃게, 부산" : "예: 고등어"}
            />
          </label>
        )}
        <button className="button">조회하기</button>
      </form>
      {tab === "broker" ? (
        <BrokerMarket
          searchParams={Promise.resolve({ day, region })}
          next={href({})}
        />
      ) : (
        <section aria-label={sources[tab].name}>
          <div className="price-source">
            <div>
              <strong>{sources[tab].name}</strong>
              <p>
                {tab === "mof"
                  ? "수협 위판장 경매 가격 · 같은 상태·규격·단위끼리 비교하세요. 가격이 0으로 제공된 항목은 제외합니다."
                  : "전국 조사 평균 · 경매 낙찰가와 다른 도매·소매 판매가격입니다."}
              </p>
            </div>
            <a
              href={sources[tab].url}
              target="_blank"
              rel="noopener noreferrer"
            >
              출처 보기 ↗
            </a>
          </div>
          {!user ? (
            <LoginGate
              next={href({})}
              message="로그인하고 공식 시세와 가격 변화를 확인하세요"
            />
          ) : (
            report && (
              <>
                <div className="price-caption">
                  <span>
                    기준일 {day}
                    {report.total > 0 ? ` · ${money(report.total)}건` : ""}
                  </span>
                  <span>
                    {tab === "mof"
                      ? "물량은 별도 자료 확인 후 제공"
                      : "원자료 조사 단위 기준"}
                  </span>
                </div>
                {report.status === "error" && (
                  <p className="notice subtle" role="status">
                    자료 갱신이 지연되고 있습니다.
                    {report.rows.length > 0 &&
                      " 표시된 자료는 마지막으로 수집한 값입니다."}
                  </p>
                )}
                {report.status === "empty" && report.rows.length > 0 && (
                  <p className="notice subtle">
                    제공처의 최근 응답에 자료가 없어 이전 수집 자료를
                    표시합니다.
                  </p>
                )}
                {report.rows.length ? (
                  <>
                    <div className="table-scroll">
                      <table className="official-price-table">
                        <thead>
                          <tr>
                            <th>
                              어종 / {tab === "mof" ? "위판장" : "가격 구분"}
                            </th>
                            <th>상태 · 규격</th>
                            <th>
                              {tab === "mof" ? "위판 최저–최고가" : "조사 가격"}
                            </th>
                            {tab === "kamis" && <th>전일 / 전주 대비</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {report.rows.map(({ data: r, fetched_at }) => (
                            <tr key={r.key}>
                              <td>
                                <strong>{r.species}</strong>
                                <small>
                                  {tab === "mof"
                                    ? `${r.region} · ${r.market}`
                                    : r.kind === "wholesale"
                                      ? "도매 · 전국"
                                      : "소매 · 전국"}
                                </small>
                              </td>
                              <td>
                                {r.state}
                                <small>{r.grade}</small>
                              </td>
                              <td>
                                <strong>
                                  {money(r.low)}
                                  {r.high !== r.low ? `–${money(r.high)}` : ""}
                                  원
                                </strong>
                                <small>/{r.unit}</small>
                                <small className="price-collected">
                                  수집{" "}
                                  {new Date(fetched_at).toLocaleString(
                                    "ko-KR",
                                    {
                                      timeZone: "Asia/Seoul",
                                      month: "numeric",
                                      day: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      hour12: false,
                                    },
                                  )}
                                </small>
                              </td>
                              {tab === "kamis" && (
                                <td>
                                  <Change
                                    price={r.low}
                                    previous={r.previous}
                                    label="전일"
                                  />
                                  <Change
                                    price={r.low}
                                    previous={r.week}
                                    label="전주"
                                  />
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="price-pagination">
                      {page > 1 && (
                        <Link
                          className="button secondary"
                          href={href({ page: String(page - 1) })}
                        >
                          이전
                        </Link>
                      )}
                      <span>{page}페이지</span>
                      {page * 50 < report.total && (
                        <Link
                          className="button secondary"
                          href={href({ page: String(page + 1) })}
                        >
                          다음
                        </Link>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="official-empty">
                    <div>
                      <strong>
                        {!report.configured && !report.latest
                          ? "공식 시세 연결을 준비하고 있습니다"
                          : "이 조건의 공식 자료가 없습니다"}
                      </strong>
                      <p>
                        발표가 없거나 수집되지 않은 가격은 0원으로 표시하지
                        않습니다.
                      </p>
                      {report.latest && report.latest !== day && (
                        <Link href={href({ day: report.latest })}>
                          최근 자료 보기 · {report.latest} →
                        </Link>
                      )}
                      {page > 1 && (
                        <Link href={href({ page: "1" })}>첫 페이지로 →</Link>
                      )}
                    </div>
                  </div>
                )}
              </>
            )
          )}
        </section>
      )}
    </>
  );
}
function Change({
  price,
  previous,
  label,
}: {
  price: number;
  previous: number | null;
  label: string;
}) {
  const change = previous ? ((price - previous) / previous) * 100 : null;
  return (
    <small
      className={
        change === null || change === 0
          ? ""
          : change > 0
            ? "price-up"
            : "price-down"
      }
    >
      {label}{" "}
      {change === null
        ? "비교 자료 없음"
        : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`}
    </small>
  );
}
