import Link from "next/link";
import { currentUser } from "@/server/auth";
import { warehouses } from "@/server/queries";
import { Heading, Empty } from "@/components/ui";
import { Contact, Report } from "@/components/actions";
import {
  Warehouse,
  MapPin,
  Phone,
  ChatCircleText,
  Plus,
} from "@/components/icons";
export const metadata = { title: "보관업체" };
export default async function Storage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string }>;
}) {
  const p = await searchParams,
    u = await currentUser(),
    items = (await warehouses(u)).filter(
      (w) => !p.region || w.data.region.includes(p.region),
    );
  return (
    <>
      <Heading
        eyebrow="COLD STORAGE"
        title="좋은 물건, 안전하게 보관하세요"
        description="지역별 냉동·냉장 보관업체의 조건을 확인하고 직접 문의하세요."
        action={
          u?.role === "storage" ? (
            <Link className="button" href="/storage/new">
              <Plus size={20} />내 업체 관리
            </Link>
          ) : undefined
        }
      />
      <form className="inline-search">
        <MapPin size={20} />
        <input
          name="region"
          defaultValue={p.region}
          placeholder="지역으로 찾기 · 예: 부산"
          aria-label="보관업체 지역"
        />
        <button className="button secondary">검색</button>
      </form>
      {items.length ? (
        <div className="warehouse-grid">
          {items.map((w) => (
            <article className="warehouse-card" key={w.id}>
              <div className="warehouse-icon">
                <Warehouse size={34} />
              </div>
              <span className="state">{w.data.kind}</span>
              <h2>{w.data.name}</h2>
              <p className="muted">
                <MapPin size={16} />
                {w.data.region}
              </p>
              <dl className="specs">
                <div>
                  <dt>취급 어종</dt>
                  <dd>{[w.data.species].flat().join(" · ")}</dd>
                </div>
                <div>
                  <dt>운영 시간</dt>
                  <dd>{w.data.hours}</dd>
                </div>
                {u && (
                  <div>
                    <dt>주소</dt>
                    <dd>{w.data.address}</dd>
                  </div>
                )}
              </dl>
              <p className="preline">{w.data.conditions}</p>
              {w.contact ? (
                <div className="contact-buttons">
                  <Contact href={"tel:" + w.contact} target={w.id}>
                    <Phone size={18} />
                    전화 문의
                  </Contact>
                  <Contact
                    href={"sms:" + w.contact}
                    target={w.id}
                    className="button secondary"
                  >
                    <ChatCircleText size={18} />
                    문자
                  </Contact>
                </div>
              ) : (
                <Link className="button secondary" href="/login?next=/storage">
                  로그인 후 연락처 확인
                </Link>
              )}
              {u && <Report id={w.id} kind="storage" />}
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title="이 지역의 보관업체를 기다리고 있어요"
          description="보관업체 회원은 시설과 취급 조건을 등록할 수 있습니다."
          href={u?.role === "storage" ? "/storage/new" : "/login"}
          label="보관업체로 시작하기"
        />
      )}
    </>
  );
}
