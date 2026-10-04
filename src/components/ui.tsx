import { BrandName } from "./brand-name";
import Link from "next/link";
import {
  Fish,
  ArrowRight,
  MapPin,
  LockKey,
  Package,
  ArrowLeft,
  ShieldCheck,
} from "./icons";
import { Favorite } from "./actions";
import { money, type PublicListing, type User } from "@/lib/model";
export function Heading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Empty({
  title = "아직 올라온 물건이 없습니다",
  description = "관심 지역을 넓혀보거나, 필요한 물건을 매입 요청에 남겨보세요.",
  href = "/requests/new",
  label = "매입 요청 남기기",
}: {
  title?: string;
  description?: string;
  href?: string;
  label?: string;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Package size={36} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      <Link href={href} className="button secondary">
        {label}
        <ArrowRight size={18} />
      </Link>
    </div>
  );
}
export function Back({
  href = "/",
  label = "오늘 물건",
}: {
  href?: string;
  label?: string;
}) {
  return (
    <Link className="back" href={href}>
      <ArrowLeft size={18} />
      {label}
    </Link>
  );
}
export function LoginGate({
  message = "로그인하고 가격과 연락처를 확인하세요",
  next = "/",
  compact = false,
}: {
  message?: string;
  next?: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "login-inline" : "login-gate"}>
      <LockKey size={compact ? 17 : 26} />
      <div>
        <strong>{message}</strong>
        {!compact && <p>수산업 종사자를 위한 풍어 · 휴대폰 번호로 간편하게</p>}
      </div>
      <Link className="button" href={"/login?next=" + encodeURIComponent(next)}>
        로그인
        <ArrowRight size={17} />
      </Link>
    </div>
  );
}
export function ProductCard({
  item,
  user,
  saved = false,
}: {
  item: PublicListing;
  user: User | null;
  saved?: boolean;
}) {
  const d = item.data;
  const expired = !!item.closed_at || new Date(item.expires_at) < new Date();
  return (
    <article className={"product " + (expired ? "expired" : "")}>
      <div className="product-image">
        <Link href={"/listings/" + item.id}>
          <img
            src={d.photos[0]}
            alt={`${d.species} ${d.grade}`}
            loading="lazy"
          />
        </Link>
        {user && <Favorite id={item.id} initial={saved} />}
      </div>
      <div className="product-info">
        <div className="product-top">
          <span className={"state state-" + d.state}>{d.state}</span>
          <span className="muted">{d.market}</span>
          {item.demo && <span className="demo-tag">시연</span>}
        </div>
        <Link href={"/listings/" + item.id}>
          <h3>
            {d.species} <span>{d.grade}</span>
          </h3>
        </Link>
        <p className="stock">
          약 {money(d.quantity)}
          {d.unit} · 최소 {money(d.minimum)}
          {d.unit}
        </p>
        <div className="product-price">
          {d.priceMin !== undefined ? (
            <>
              <strong>
                {money(d.priceMin)}
                {d.priceMax !== d.priceMin ? "–" + money(d.priceMax!) : ""}
              </strong>
              <span>원 / {d.unit}</span>
            </>
          ) : (
            <Link
              href={"/login?next=/listings/" + item.id}
              className="locked-price"
            >
              <LockKey size={16} />
              로그인 후 가격 확인
            </Link>
          )}
        </div>
        <div className="product-bottom">
          <span>
            <MapPin size={14} />
            {d.region}
          </span>
          <span>{expired ? "판매 마감" : "현장 픽업"}</span>
        </div>
        <Link className="seller-link" href={"/brokers/" + item.owner_id}>
          <ShieldCheck size={14} />
          {item.seller?.business || "중매인 소개"}
        </Link>
      </div>
    </article>
  );
}
export function Brand({ homeTitle = false }: { homeTitle?: boolean }) {
  return (
    <Link href="/" className="brand" aria-label="홈">
      <span className="brand-symbol">
        <Fish size={29} weight="bold" />
      </span>
      {homeTitle ? (
        <BrandName />
      ) : (
        <span>
          풍어<span className="brand-caption">바다의 오늘, 거래의 시작</span>
        </span>
      )}
    </Link>
  );
}
