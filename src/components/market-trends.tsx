import Link from "next/link";
import { Heading } from "./ui";
import { cachedTrends } from "@/server/marine/queries";
import { kstDay } from "@/lib/model";
const num = (n: number | null, suffix = "") =>
  n === null
    ? "—"
    : n.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + suffix;
function Delta({
  value,
}: {
  value: {
    delta: number | null;
    percent: number | null;
    reason: string | null;
  };
}) {
  return (
    <small>
      {value.delta === null ? (
        value.reason
      ) : (
        <>
          {value.delta > 0 ? "+" : ""}
          {num(value.delta)} ·{" "}
          {value.percent === null
            ? value.reason
            : `${value.percent > 0 ? "+" : ""}${num(value.percent)}%`}
        </>
      )}
    </small>
  );
}
export function MarketViewTabs({ view }: { view: "prices" | "trends" }) {
  return (
    <nav className="price-tabs" aria-label="시장 정보">
      <Link
        href="/market?view=trends"
        aria-current={view === "trends" ? "page" : undefined}
      >
        위판 동향
      </Link>
      <Link
        href="/market"
        aria-current={view === "prices" ? "page" : undefined}
      >
        가격 조회
      </Link>
    </nav>
  );
}
export default async function MarketTrends({
  params,
}: {
  params: Record<string, string | undefined>;
}) {
  const r = await cachedTrends(params),
    max = Math.max(1, ...r.chart.map((d) => d.weight ?? 0));
  return (
    <>
      <Heading
        title="전국 위판 동향"
        description="해양수산부 일자별 위판 원자료로 보는 물량과 거래금액의 변화"
      />
      <MarketViewTabs view="trends" />
      <form
        key={[r.day, r.period, r.region, r.market, r.species].join(":")}
        className="price-filters"
      >
        <input type="hidden" name="view" value="trends" />
        <label>
          기준일
          <input
            type="date"
            name="day"
            defaultValue={r.day}
            max={kstDay()}
            required
          />
        </label>
        <label>
          비교 기간
          <select name="period" defaultValue={r.period}>
            <option value="day">일간 · 전날 대비</option>
            <option value="week">주간 · 직전 7일 대비</option>
          </select>
        </label>
        <label>
          지역
          <select name="region" defaultValue={r.region}>
            <option value="">전국</option>
            {r.options.regions.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          위판장
          <select name="market" defaultValue={r.market}>
            <option value="">전체 위판장</option>
            {r.options.markets.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          어종
          <select name="species" defaultValue={r.species}>
            <option value="">전체 어종</option>
            {r.options.species.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <button className="button">조회</button>
      </form>
      <p>
        {r.from} ~ {r.day} {r.provisional && <strong>· 당일 잠정 자료</strong>}
        <br />
        <small>
          비교: {r.before} ~ {r.previousEnd}
        </small>
      </p>
      {r.status !== "ready" && (
        <div className="notice">
          <strong>
            {r.status === "pending"
              ? "API 승인·연결 대기"
              : r.status === "empty"
                ? "제공처 자료 없음"
                : "자료 갱신 확인 중"}
          </strong>
          <p>
            아직 수집되지 않은 값은 0으로 표시하지 않습니다. 연결 후 최근
            30일부터 자동 수집합니다.
          </p>
        </div>
      )}
      <div className="marine-columns">
        <section className="marine-panel">
          <h2>위판 물량</h2>
          <p className="marine-number">{num(r.weight, " kg")}</p>
          <Delta value={r.weightChange} />
        </section>
        <section className="marine-panel">
          <h2>위판 금액</h2>
          <p className="marine-number">{num(r.amount, " 원")}</p>
          <Delta value={r.amountChange} />
        </section>
      </div>
      <section className="marine-panel">
        <h2>최근 30일 물량</h2>
        {r.chart.some((d) => d.weight !== null) ? (
          <>
            <div
              className="marine-chart"
              role="img"
              aria-label="최근 30일 위판 물량. 상세 값은 아래 표에서 확인할 수 있습니다."
            >
              {r.chart.map((d) => (
                <div key={d.day} title={`${d.day}: ${num(d.weight, " kg")}`}>
                  <span
                    style={{
                      height:
                        d.weight === null
                          ? "0"
                          : `${Math.max(1, (d.weight / max) * 100)}%`,
                    }}
                  />
                  <small>{d.day.slice(8)}</small>
                </div>
              ))}
            </div>
            <details>
              <summary>일별 수치 확인</summary>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th>물량(kg)</th>
                      <th>금액(원)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.chart.map((d) => (
                      <tr key={d.day}>
                        <td>{d.day}</td>
                        <td>{num(d.weight)}</td>
                        <td>{num(d.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        ) : (
          <div className="marine-empty">
            수집 완료 후 일별 물량 그래프를 제공합니다.
          </div>
        )}
      </section>
      <section className="marine-panel">
        <h2>어종별 변화</h2>
        <p className="muted">
          같은 어종·상태·규격·거래 단위끼리 비교합니다. kg당 가격은 위판금액
          합계 ÷ 중량 합계입니다.
        </p>
        {r.groups.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>어종 / 조건</th>
                  <th>물량(kg)</th>
                  <th>물량 증감</th>
                  <th>금액(원)</th>
                  <th>kg당 가격</th>
                  <th>이전 kg당 가격</th>
                </tr>
              </thead>
              <tbody>
                {r.groups.map((g, i) => (
                  <tr key={i}>
                    <td>
                      {g.species}
                      <small>
                        {g.state} · {g.grade} · {g.unit}
                      </small>
                    </td>
                    <td>{num(g.weight)}</td>
                    <td>
                      <Delta value={g.change} />
                    </td>
                    <td>{num(g.amount)}</td>
                    <td>{num(g.price, " 원")}</td>
                    <td>{num(g.previousPrice, " 원")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.hasMore && (
              <p>
                처음 200개 조건입니다. 지역·위판장·어종을 좁혀 조회해주세요.
              </p>
            )}
          </div>
        ) : (
          <p>선택한 조건의 자료가 없습니다.</p>
        )}
      </section>
      {r.missingDays.length > 0 && (
        <p className="muted">
          비교 구간 수집·지역 확인 미완료: {r.missingDays.join(", ")}. 전체 기간
          수집 전에는 증감을 계산하지 않습니다.
        </p>
      )}
      <p className="muted">
        중량의 kg 단위를 확인하기 전에는 물량·kg당 가격을 표시하지 않습니다. 빈
        응답은 무거래로 단정하지 않습니다.
      </p>
      <small>
        <a href={r.source.url}>{r.source.name}</a> · 수집{" "}
        {r.fetchedAt
          ? new Date(r.fetchedAt).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
            })
          : "대기"}{" "}
        · 매일 06:30 / 12:30 / 18:30 갱신 (한국 시각)
      </small>
    </>
  );
}
