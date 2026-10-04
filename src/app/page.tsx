import Link from "next/link";
import { currentUser } from "@/server/auth";
import { listings, taxonomy } from "@/server/queries";
import { db } from "@/server/db";
import { ProductCard, Empty } from "@/components/ui";
import {
  ArrowRight,
  ArrowUpRight,
  MagnifyingGlass,
  MapPin,
  SlidersHorizontal,
  ShieldCheck,
  Anchor,
} from "@/components/icons";
import { kstDay, dateLabel } from "@/lib/model";
export const metadata = { title: { absolute: "전국 수산물 경매 정보방" } };
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const p = await searchParams,
    user = await currentUser(),
    tax = await taxonomy();
  const region = p.region ?? user?.profile.interests.regions[0] ?? "",
    species = p.species ?? user?.profile.interests.species[0] ?? "";
  const items = await listings(user, {
    region,
    species,
    state: p.state,
    q: p.q,
    page: Number(p.page) || 1,
  });
  const saved = user
    ? await db()`SELECT listing_id FROM favorites WHERE user_id=${user.id}`
    : [];
  let nearby: typeof items = [];
  if (!items.length && region) {
    const prefix = region.slice(0, 2);
    nearby = (await listings(user, { region: prefix, species })).filter(
      (x) => !x.data.region.includes(region),
    );
  }
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-kicker">
            <span className="live-dot" />
            {dateLabel(kstDay() + "T00:00:00+09:00")} · 바다의 오늘을 만나다
          </div>
          <h1>
            좋은 물건이 있는 곳,
            <br />
            <em>좋은 거래가 시작되는 곳.</em>
          </h1>
          <p>
            전국 중매인의 오늘 물건을 확인하고
            <br className="mobile-only" /> 믿을 수 있는 새 거래처를 만나보세요.
          </p>
          <div className="hero-links">
            <a href="#today">
              오늘 올라온 물건
              <ArrowRight size={19} />
            </a>
            <Link href="/requests">
              찾는 물건 요청하기
              <ArrowUpRight size={19} />
            </Link>
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="sea-letter">滿船</div>
          <div className="hero-note">
            <Anchor size={20} />
            <span>
              바다에서 당신의 일터까지
              <br />
              <strong>오늘도, 풍어입니다.</strong>
            </span>
          </div>
        </div>
      </section>
      <div className="trust-line">
        <span>
          <ShieldCheck size={18} />
          운영자가 확인한 중매인
        </span>
        <span>
          <MapPin size={18} />
          전국 산지의 오늘 물건
        </span>
        <span>
          <Anchor size={18} />
          직접 연락하고 현장에서 픽업
        </span>
      </div>
      <section id="today" className="section">
        <div className="section-heading">
          <div>
            <div className="eyebrow">TODAY’S CATCH</div>
            <h2>오늘 올라온 물건</h2>
          </div>
          <Link href="/market" className="text-link">
            지역별 가격대 보기
            <ArrowUpRight size={18} />
          </Link>
        </div>
        <form className="market-search" action="/">
          <div className="search-input">
            <MagnifyingGlass size={23} />
            <input
              name="q"
              defaultValue={p.q}
              placeholder="어종, 규격, 위판장 또는 중매인 검색"
              aria-label="상품 검색"
            />
          </div>
          <button className="button" type="submit">
            검색
          </button>
          <div className="filter-row">
            <label>
              <MapPin size={18} />
              <select name="region" defaultValue={region} aria-label="지역">
                <option value="">전국 모든 지역</option>
                {region && !tax.regions.includes(region) && (
                  <option>{region}</option>
                )}
                {tax.regions.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label>
              <SlidersHorizontal size={18} />
              <select name="species" defaultValue={species} aria-label="어종">
                <option value="">모든 어종</option>
                {tax.species.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              <select
                name="state"
                defaultValue={p.state || ""}
                aria-label="상품 상태"
              >
                <option value="">선어 · 활어 · 냉동</option>
                <option>선어</option>
                <option>활어</option>
                <option>냉동</option>
              </select>
            </label>
            <button type="submit" className="filter-apply">
              조건 적용
            </button>
            <Link href="/?region=&species=" className="muted reset">
              초기화
            </Link>
          </div>
        </form>
        <div className="quick-filters">
          {["", "꽃게", "오징어", "고등어", "갈치", "우럭", "새우", "문어"].map(
            (s) => (
              <Link
                key={s}
                className={"chip " + (species === s ? "active" : "")}
                href={"/?" + new URLSearchParams({ region, species: s })}
              >
                {s || "전체"}
              </Link>
            ),
          )}
        </div>
        <div className="results-caption">
          <span>
            <strong>{region || "전국"}</strong> · {species || "전체 어종"}
          </span>
          <span>최신 등록순 · 최대 60건</span>
        </div>
        {items.length ? (
          <div className="product-grid">
            {items.map((item) => (
              <ProductCard
                key={item.id}
                item={item}
                user={user}
                saved={saved.some((f) => f.listing_id === item.id)}
              />
            ))}
          </div>
        ) : (
          <Empty />
        )}
        {items.length === 60 && (
          <Link
            className="button secondary more"
            href={
              "/?" +
              new URLSearchParams({
                region,
                species,
                page: String((Number(p.page) || 1) + 1),
              })
            }
          >
            다음 물건 보기
            <ArrowRight size={18} />
          </Link>
        )}
        {nearby.length > 0 && (
          <>
            <h3 className="section-subtitle">같은 권역에서 찾은 물건</h3>
            <div className="product-grid">
              {nearby.slice(0, 4).map((item) => (
                <ProductCard key={item.id} item={item} user={user} />
              ))}
            </div>
          </>
        )}
      </section>
      <section className="request-banner">
        <div>
          <span className="eyebrow">원하는 물건이 보이지 않나요?</span>
          <h2>
            찾는 물건을 남기면,
            <br />
            새로운 거래가 찾아옵니다.
          </h2>
          <p>필요한 어종과 수량, 지역을 중매인에게 알려주세요.</p>
        </div>
        <Link href="/requests/new" className="button">
          매입 요청 남기기
          <ArrowRight size={20} />
        </Link>
      </section>
      <div className="service-links">
        <Link href="/guide">
          <div>
            <span>중매인을 위한 풍어</span>
            <h3>오늘 물건으로 새 거래처를 만나세요.</h3>
            <p>사진 한 장부터, 간편하게 시작합니다.</p>
          </div>
          <ArrowUpRight size={28} />
        </Link>
      </div>
    </>
  );
}
