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
} from "@/components/icons";
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
      <div className="marine-home">
        <Link href="/sea">
          바다정보 <span>물때 · 해상 날씨</span>
        </Link>
        <Link href="/market?view=trends">
          위판 동향 <span>일간 · 주간 변화</span>
        </Link>
      </div>
      <section id="today" className="section">
        <div className="section-heading">
          <div>
            <h1>오늘 올라온 물건</h1>
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
              placeholder="어종·위판장 검색"
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
                <option value="">전국</option>
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
                <option value="">모든 상태</option>
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
    </>
  );
}
