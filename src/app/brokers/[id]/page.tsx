import { notFound } from "next/navigation";
import { currentUser } from "@/server/auth";
import { broker, listings } from "@/server/queries";
import { Back, ProductCard, LoginGate, Empty } from "@/components/ui";
import { Contact, Report } from "@/components/actions";
import { ShieldCheck, MapPin, Phone, ChatCircleText } from "@/components/icons";
export const metadata = { title: "중매인 소개" };
export default async function Broker({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    u = await currentUser(),
    b = await broker(id, u);
  if (!b) notFound();
  const items = await listings(u, { ownerId: id });
  const p = b.profile;
  return (
    <>
      <Back />
      <div className="profile-hero">
        <span className="avatar large">{p.business.slice(0, 1)}</span>
        <div>
          <span className="eyebrow">
            <ShieldCheck size={17} />
            운영자가 확인한 중매인
          </span>
          <h1>{p.business}</h1>
          <p>
            <MapPin size={17} />
            {p.region} · {p.market}
          </p>
        </div>
        {b.demo && <span className="demo-tag">시연 프로필</span>}
      </div>
      <div className="profile-body">
        <section>
          <h2>거래처 소개</h2>
          <p className="preline">
            {p.bio || "중매인이 소개를 준비하고 있습니다."}
          </p>
          <div className="tags">
            {p.specialties.map((s) => (
              <span className="chip" key={s}>
                {s}
              </span>
            ))}
          </div>
          {p.procurement && (
            <div className="notice">
              경매 매입 대행이 가능합니다. 희망 어종·수량·예산을 연락해
              알려주세요.
            </div>
          )}
        </section>
        <aside>
          <h3>거래 문의</h3>
          <p>
            담당 {p.name} · 응대 {p.hours}
          </p>
          {p.contact ? (
            <div className="contact-buttons">
              <Contact href={"tel:" + p.contact} target={id}>
                <Phone size={18} />
                전화
              </Contact>
              <Contact
                href={"sms:" + p.contact}
                target={id}
                className="button secondary"
              >
                <ChatCircleText size={18} />
                문자
              </Contact>
            </div>
          ) : (
            <LoginGate next={"/brokers/" + id} compact />
          )}
        </aside>
      </div>
      <h2 className="section-subtitle">이 중매인의 오늘 물건</h2>
      {items.length ? (
        <div className="product-grid">
          {items.map((l) => (
            <ProductCard key={l.id} item={l} user={u} />
          ))}
        </div>
      ) : (
        <Empty
          title="현재 판매 중인 물건이 없습니다"
          description="취급 품목과 매입 대행 가능 여부를 확인하고 직접 문의해보세요."
          href="/requests"
          label="매입 요청 둘러보기"
        />
      )}
      {u && <Report id={id} kind="broker" />}
    </>
  );
}
