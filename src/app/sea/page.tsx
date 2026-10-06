import Link from "next/link";
import { Heading } from "@/components/ui";
import { RememberPort } from "@/components/sea-port";
import { conditions } from "@/server/marine/queries";
import { ports, portFor, shiftDay } from "@/server/marine/model";
import { kstDay } from "@/lib/model";
export const metadata = { title: "바다정보" };
function date(v: unknown) {
  return v
    ? new Date(String(v)).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : "아직 수집되지 않음";
}
export default async function Sea({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams,
    port = portFor(typeof p.port === "string" ? p.port : undefined),
    today = kstDay();
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(today, i));
  const day = typeof p.day === "string" && days.includes(p.day) ? p.day : today;
  const report = await conditions(port.id, day),
    { feeds } = report;
  const tides = feeds.tide.data as {
    at: string;
    height: number;
    kind: string;
  }[];
  const next = tides.find((t) => Date.parse(t.at) > Date.now());
  const weather = (
    feeds.sea.data as {
      day: string;
      period: string;
      weather: string;
      wind: string;
      windMin: number;
      windMax: number;
      waveMin: number;
      waveMax: number;
    }[]
  ).filter((r) => r.day === day);
  const land = (
    feeds.land.data as { at: string; category: string; value: number }[]
  ).filter((r) => r.at.slice(0, 10) === day);
  const times = [...new Set(land.map((r) => r.at))];
  return (
    <>
      <RememberPort
        portIds={ports.map((p) => p.id)}
        port={port.id}
        explicit={typeof p.port === "string"}
      />
      <Heading
        title="바다정보"
        description="항구 인근 물때와 기상청 예보를 한곳에서 확인하세요."
      />
      <form key={port.id} className="price-filters" action="/sea">
        <label>
          항구
          <select name="port" defaultValue={port.id}>
            {ports.map((p) => (
              <option key={p.id} value={p.id}>
                {p.region} · {p.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button">항구 선택</button>
      </form>
      <section className="marine-warning" aria-label="기상특보">
        <strong>
          전국 기상특보 ·{" "}
          {feeds.warning.status === "ready"
            ? "수집된 현황"
            : feeds.warning.status === "stale"
              ? "갱신 지연"
              : "확인 대기"}
        </strong>
        {feeds.warning.data.length ? (
          <details>
            <summary>기상청 특보 원문 보기</summary>
            {(feeds.warning.data as { at: string; text: string }[]).map(
              (w, i) => (
                <p className="board-body" key={i}>
                  {w.text}
                </p>
              ),
            )}
          </details>
        ) : (
          <p>
            현재 특보 유무를 확인할 수 없습니다.{" "}
            <a
              href="https://www.weather.go.kr/w/weather/warning/status.do"
              target="_blank"
              rel="noreferrer"
            >
              기상청 특보 확인 ↗
            </a>
          </p>
        )}
        <small>
          발표 {date(feeds.warning.issued_at)} · 확인{" "}
          {date(feeds.warning.fetched_at)}
        </small>
      </section>
      <nav className="marine-days" aria-label="물때 날짜">
        {days.map((d) => (
          <Link
            key={d}
            href={`/sea?port=${port.id}&day=${d}`}
            aria-current={d === day ? "page" : undefined}
          >
            {d === today ? "오늘" : d.slice(5).replace("-", "/")}
          </Link>
        ))}
      </nav>
      <div className="marine-columns">
        <section className="marine-panel">
          <div className="marine-title">
            <h2>물때표</h2>
            <span>{day}</span>
          </div>
          <p className="muted">
            {port.name} 인근 · {port.station} 조석 예측지점
          </p>
          {feeds.tide.status !== "ready" && (
            <p className="notice">{feeds.tide.message || "승인 대기"}</p>
          )}
          {tides.length ? (
            <>
              <p>
                다음 물때{" "}
                {next
                  ? `${next.kind} ${next.at.slice(11, 16)}`
                  : "선택일의 물때가 모두 지났습니다"}
              </p>
              <ol className="tide-list">
                {tides.map((t) => (
                  <li key={t.at}>
                    <span>{t.kind}</span>
                    <strong>{t.at.slice(11, 16)}</strong>
                    <span>{t.height} cm</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <div className="marine-empty">
              <strong>물때 정보를 준비하고 있습니다</strong>
              <p>API 승인 및 관측소 연결 후 매일 자동으로 갱신됩니다.</p>
            </div>
          )}
          <small>
            <a href={feeds.tide.source.url}>국립해양조사원</a> · 수집{" "}
            {date(feeds.tide.fetched_at)}
            <br />
            조위는 관측소 기준면에 대한 예측 높이입니다.
          </small>
        </section>
        <section className="marine-panel">
          <div className="marine-title">
            <h2>해상 날씨</h2>
            <span>오전 · 오후</span>
          </div>
          <p className="muted">{port.sea} · 항구 주변 육상 날씨와 다릅니다.</p>
          {feeds.sea.status !== "ready" && (
            <p className="notice">{feeds.sea.message || "승인 대기"}</p>
          )}
          {weather.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>시간</th>
                    <th>날씨</th>
                    <th>바람</th>
                    <th>파고</th>
                  </tr>
                </thead>
                <tbody>
                  {weather.map((w, i) => (
                    <tr key={i}>
                      <td>{w.period}</td>
                      <td>{w.weather}</td>
                      <td>
                        {w.wind}
                        <br />
                        {w.windMin}~{w.windMax} m/s
                      </td>
                      <td>
                        {w.waveMin}~{w.waveMax} m
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="marine-empty">
              <strong>선택일의 예보가 없습니다</strong>
              <p>승인 후 제공되는 예보기간 내 자료부터 표시합니다.</p>
            </div>
          )}
          <small>
            <a href={feeds.sea.source.url}>기상청 해상예보</a> · 발표{" "}
            {date(feeds.sea.issued_at)}
            <br />
            수집 {date(feeds.sea.fetched_at)}
          </small>
        </section>
      </div>
      <section className="marine-panel">
        <h2>항구 인근 육상 날씨</h2>
        <p className="muted">
          {port.name} 인근 5 km 예보 격자 · 기온과 강수확률
        </p>
        {feeds.land.status !== "ready" && (
          <p className="notice">{feeds.land.message}</p>
        )}
        {times.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>시간</th>
                  <th>기온</th>
                  <th>강수확률</th>
                </tr>
              </thead>
              <tbody>
                {times.map((t) => (
                  <tr key={t}>
                    <td>{t.slice(11, 16)}</td>
                    <td>
                      {land.find((r) => r.at === t && r.category === "TMP")
                        ?.value ?? "—"}{" "}
                      ℃
                    </td>
                    <td>
                      {land.find((r) => r.at === t && r.category === "POP")
                        ?.value ?? "—"}{" "}
                      %
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>자료 연결 대기 중입니다.</p>
        )}
        <small>
          <a href={feeds.land.source.url}>기상청 단기예보</a> · 발표{" "}
          {date(feeds.land.issued_at)} · 수집 {date(feeds.land.fetched_at)}
        </small>
      </section>
      <p className="muted">
        모든 날짜·시각은 한국 시각입니다. 출항 전 최신 특보와 현장 통제를
        확인해주세요.
      </p>
      <Link className="text-link" href="/market?view=trends">
        전국 위판 동향 확인 →
      </Link>
    </>
  );
}
