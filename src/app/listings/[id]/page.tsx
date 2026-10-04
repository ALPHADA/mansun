import Link from "next/link";
import { publicOrigin } from "@/server/config";
import { notFound } from "next/navigation";
import { currentUser } from "@/server/auth";
import { listing } from "@/server/queries";
import { db } from "@/server/db";
import { Back, LoginGate } from "@/components/ui";
import { Favorite, Contact, Report, Action } from "@/components/actions";
import {
  MapPin,
  Phone,
  ChatCircleText,
  ShieldCheck,
  Clock,
  ArrowUpRight,
} from "@/components/icons";
import { money, kgPrice, type ListingData } from "@/lib/model";
export const metadata = { title: "오늘의 물건" };
export default async function Detail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    u = await currentUser(),
    item = await listing(id, u);
  if (!item) notFound();
  const d = item.data,
    closed = !!item.closed_at || new Date(item.expires_at) < new Date();
  const saved = u
    ? (
        await db()`SELECT 1 FROM favorites WHERE user_id=${u.id} AND listing_id=${id}`
      ).length > 0
    : false;
  const perKg = u ? kgPrice(d as ListingData) : null;
  return (
    <>
      <Back />
      <div className="detail-layout">
        <div className="detail-gallery">
          {d.photos.map((p, i) => (
            <img
              key={p}
              src={p}
              alt={`${d.species} ${d.grade} 사진 ${i + 1}`}
            />
          ))}
        </div>
        <section className="detail-panel">
          <div className="detail-meta">
            <span className={"state state-" + d.state}>{d.state}</span>
            <span>{d.market}</span>
            {item.demo && <span className="demo-tag">시연 데이터</span>}
            {u && <Favorite id={id} initial={saved} />}
          </div>
          <h1>{d.species}</h1>
          <p className="detail-grade">{d.grade}</p>
          {item.demo && (
            <div className="notice">
              화면 확인용 가상 물건입니다. 실제 판매 상품이 아니며 연락 기능은
              제공하지 않습니다.
            </div>
          )}
          {closed && (
            <div className="notice">
              판매가 마감된 물건입니다. 새로 올라온 물건을 확인해주세요.
            </div>
          )}
          {u ? (
            <div className="detail-price">
              <strong>
                {money(d.priceMin!)}
                {d.priceMax !== d.priceMin ? "–" + money(d.priceMax!) : ""}
              </strong>
              <span>원 / {d.unit}</span>
              {perKg && d.unit !== "kg" && (
                <small>
                  입력 중량 기준 최소 {money(perKg)}원/kg · {d.weightKg}kg/
                  {d.unit}
                </small>
              )}
              <p>중매인 제시 판매가 · 최종 가격은 연락 후 협의</p>
            </div>
          ) : (
            <LoginGate next={"/listings/" + id} />
          )}
          <dl className="specs">
            <div>
              <dt>판매 가능 수량</dt>
              <dd>
                약 {money(d.quantity)}
                {d.unit}
              </dd>
            </div>
            <div>
              <dt>최소 구매량</dt>
              <dd>
                {money(d.minimum)}
                {d.unit}
              </dd>
            </div>
            <div>
              <dt>인수 지역</dt>
              <dd>
                <MapPin size={16} />
                {d.region}
              </dd>
            </div>
            <div>
              <dt>픽업 가능 시간</dt>
              <dd>{d.pickupHours}</dd>
            </div>
            {u && (
              <div>
                <dt>상세 픽업 위치</dt>
                <dd>{d.pickup}</dd>
              </div>
            )}
            <div>
              <dt>마지막 수정</dt>
              <dd>
                {new Intl.DateTimeFormat("ko-KR", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Asia/Seoul",
                }).format(new Date(item.updated_at))}
              </dd>
            </div>
          </dl>
          {d.note && (
            <div className="detail-note">
              <h3>물건 안내</h3>
              <p>{d.note}</p>
            </div>
          )}
          <Link className="broker-box" href={"/brokers/" + item.owner_id}>
            <span className="avatar">{item.seller?.business.slice(0, 1)}</span>
            <div>
              <small>
                <ShieldCheck size={15} />
                확인된 중매인
              </small>
              <strong>{item.seller?.business}</strong>
              <span>
                <Clock size={14} />
                응대 {item.seller?.hours}
              </span>
            </div>
            <ArrowUpRight size={24} />
          </Link>
          {u && item.seller?.contact && !closed && (
            <div className="contact-buttons">
              <Contact href={"tel:" + item.seller.contact} target={id}>
                <Phone size={21} />
                전화 문의
              </Contact>
              <Contact
                href={
                  "sms:" +
                  item.seller.contact +
                  "?body=" +
                  encodeURIComponent(
                    `[만선] ${d.species} ${d.grade} 문의드립니다.\n${publicOrigin()}/listings/${id}\n희망 수량: `,
                  )
                }
                target={id}
                className="button secondary"
              >
                <ChatCircleText size={21} />
                문자 문의
              </Contact>
            </div>
          )}
          {u?.id === item.owner_id && (
            <div className="owner-actions">
              {!closed && (
                <>
                  <Link
                    className="button secondary"
                    href={"/listings/new?edit=" + id}
                  >
                    수정
                  </Link>
                  <Action
                    endpoint="listings/close"
                    payload={{ id }}
                    confirmMessage="이 물건을 판매 완료로 처리할까요?"
                  >
                    판매 완료
                  </Action>
                </>
              )}
              <Link
                className="button secondary"
                href={"/listings/new?copy=" + id}
              >
                복사해서 새로 등록
              </Link>
            </div>
          )}
          {u && <Report id={id} kind="listing" />}
        </section>
      </div>
    </>
  );
}
