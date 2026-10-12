import { currentUser } from "@/server/auth";
import { market } from "@/server/queries";
import { Empty, LoginGate } from "@/components/ui";
import { kstDay, money } from "@/lib/model";
import { ChartLine, MapPin, ArrowUpRight } from "@/components/icons";
export default async function BrokerMarket({
  searchParams,
  next,
}: {
  next: string;
  searchParams: Promise<{ day?: string; region?: string }>;
}) {
  const p = await searchParams,
    u = await currentUser();
  const day =
    p.day &&
    /^\d{4}-\d{2}-\d{2}$/.test(p.day) &&
    !Number.isNaN(Date.parse(p.day)) &&
    new Date(p.day).toISOString().slice(0, 10) === p.day
      ? p.day
      : kstDay();
  const { groups, official } = await market(day, p.region || "");
  const real = groups.filter((g) => !g.demo),
    demo = groups.filter((g) => g.demo);
  return (
    <>
      <div className="market-summary">
        <div>
          <span>등록 상품</span>
          <strong>
            {real.reduce((s, g) => s + g.count, 0)}
            <small>건</small>
          </strong>
        </div>
        <div>
          <span>등록 어종</span>
          <strong>
            {new Set(real.map((g) => g.species)).size}
            <small>종</small>
          </strong>
        </div>
        <div>
          <span>등록 지역</span>
          <strong>
            {new Set(real.map((g) => g.region)).size}
            <small>곳</small>
          </strong>
        </div>
        <div className="summary-note">
          <ChartLine size={27} />
          <p>
            전국 수산물 경매 정보방 등록 상품 기준
            <br />
            <strong>지역 전체 위판량과 다릅니다.</strong>
          </p>
        </div>
      </div>
      <div className="section-heading">
        <h2>중매인 등록 판매가</h2>
        <span className="muted">단위·상태·규격별 집계</span>
      </div>
      <div className="notice subtle">
        수량은 중매인이 입력한 대략적인 등록 물량입니다. 판매 잔량이 아니며,
        가격은 최종 거래가와 다를 수 있습니다.
      </div>
      {!u ? (
        <LoginGate
          next={next}
          message="로그인하고 지역별 가격대를 확인하세요"
        />
      ) : real.length ? (
        <MarketTable groups={real} />
      ) : (
        <Empty
          title="이 날짜의 등록 시세가 없습니다"
          description="다른 날짜나 지역을 선택해주세요. 확인되지 않은 가격은 표시하지 않습니다."
          href="/"
          label="오늘 물건 보기"
        />
      )}
      {u && demo.length > 0 && (
        <details className="demo-section">
          <summary>시연 데이터로 집계 화면 보기 · 실제 시세 아님</summary>
          <MarketTable groups={demo} />
        </details>
      )}
      <section className="official-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">OFFICIAL REFERENCE</span>
            <h2>공식 경락 참고 정보</h2>
          </div>
        </div>
        <p className="muted">
          중매인 판매가와 별도로 표시합니다. 출처·기준일·규격을 확인해주세요.
        </p>
        {!u ? (
          <LoginGate next={next} compact />
        ) : official.length ? (
          <div className="official-list">
            {official.map((o) => (
              <article key={String(o.id)}>
                <h3>
                  {String(o.species)} · {String(o.grade)}
                </h3>
                <p>
                  <MapPin size={16} />
                  {String(o.region)} · {String(o.state)} ·{" "}
                  {String(o.basis_day).slice(0, 10)}
                </p>
                <strong>
                  {money(Number(o.price_min))}–{money(Number(o.price_max))}원/
                  {String(o.unit)}
                </strong>
                <a
                  href={String(o.source_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {String(o.source_name)}
                  <ArrowUpRight size={16} />
                </a>
              </article>
            ))}
          </div>
        ) : (
          <div className="official-empty">
            <ChartLine size={26} />
            <div>
              <strong>확인된 공식 자료가 아직 없습니다</strong>
              <p>
                최신성과 제공 범위가 검증된 자료부터 연결합니다. 자료가 없는
                날을 0원으로 표시하지 않습니다.
              </p>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
function MarketTable({
  groups,
}: {
  groups: Awaited<ReturnType<typeof market>>["groups"];
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>지역 / 어종</th>
            <th>상태 · 규격</th>
            <th>등록 가격대</th>
            <th>등록 물량</th>
            <th>표본</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => (
            <tr key={i}>
              <td>
                <small>{g.region}</small>
                <strong>{g.species}</strong>
              </td>
              <td>
                {g.state} · {g.grade}
                {g.weightKg && g.unit !== "kg"
                  ? ` · ${g.weightKg}kg/${g.unit}`
                  : ""}
              </td>
              <td>
                <strong>
                  {money(g.priceMin)}–{money(g.priceMax)}
                </strong>
                <small>원/{g.unit}</small>
              </td>
              <td>
                약 {money(g.quantity)}
                {g.unit}
              </td>
              <td>
                {g.count}건 · 중매인 {g.brokers}명
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
