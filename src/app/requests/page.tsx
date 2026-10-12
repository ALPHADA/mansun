import Link from "next/link";
import { currentUser } from "@/server/auth";
import { requests } from "@/server/queries";
import { Heading, Empty, LoginGate } from "@/components/ui";
import { Action, Contact, Report } from "@/components/actions";
import {
  Plus,
  MapPin,
  Phone,
  ChatCircleText,
  ArrowUpRight,
} from "@/components/icons";
import { money } from "@/lib/model";
export const metadata = { title: "매입 요청" };
export default async function Requests() {
  const u = await currentUser();
  if (!u)
    return (
      <>
        <Heading
          title="매입 요청"
          description="필요한 어종·수량·지역을 등록하세요."
        />
        <LoginGate
          next="/requests"
          message="로그인하고 매입 수요를 확인하세요"
        />
      </>
    );
  const items = await requests(u);
  return (
    <>
      <Heading
        title="이런 물건을 찾고 있어요"
        description="필요한 어종·수량·지역을 등록하세요."
        action={
          <Link href="/requests/new" className="button">
            <Plus size={20} />
            매입 요청하기
          </Link>
        }
      />
      <div className="notice subtle">
        중매인은 매입 조건을 확인하고 직접 연락해주세요. 연락처는 로그인한
        회원에게만 공개됩니다.
      </div>
      {items.length ? (
        <div className="request-list">
          {items.map((r) => (
            <article className="request-card" key={r.id}>
              <div className="request-date">
                <span>모집 중</span>
                <small>{r.data.deadline}까지</small>
              </div>
              <div className="request-content">
                <div className="eyebrow">
                  <MapPin size={15} />
                  {r.data.region}
                  {r.demo && <span className="demo-tag">시연</span>}
                </div>
                <h2>
                  {r.data.species} <span>{r.data.grade}</span>
                </h2>
                <p>
                  {money(r.data.quantity)}
                  {r.data.unit} 필요 · 총 예산 {money(r.data.budget)}원 · 수령{" "}
                  {r.data.receiveDate}
                </p>
                {r.data.note && <p className="preline muted">{r.data.note}</p>}
                <span className="buyer-name">{r.business}</span>
                <div className="request-actions">
                  {r.contact ? (
                    <>
                      <Contact
                        href={"tel:" + r.contact}
                        target={r.id}
                        className="button secondary small"
                      >
                        <Phone size={17} />
                        전화 문의
                      </Contact>
                      <Contact
                        href={
                          "sms:" +
                          r.contact +
                          "?body=" +
                          encodeURIComponent(
                            `[전국 수산물 경매 정보방] ${r.data.species} ${r.data.quantity}${r.data.unit} 매입 요청 문의드립니다.`,
                          )
                        }
                        target={r.id}
                        className="button secondary small"
                      >
                        <ChatCircleText size={17} />
                        문자 문의
                      </Contact>
                    </>
                  ) : (
                    <Link href="/login?next=/requests" className="text-link">
                      로그인 후 연락하기
                      <ArrowUpRight size={17} />
                    </Link>
                  )}
                  {u?.id === r.owner_id && (
                    <Action
                      endpoint="requests/close"
                      payload={{ id: r.id }}
                      confirmMessage="이 매입 요청을 마감할까요?"
                      className="button small secondary"
                    >
                      모집 마감
                    </Action>
                  )}
                </div>
                {u && <Report id={r.id} kind="request" />}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title="새 매입 요청을 기다리고 있어요"
          description="어종과 수량, 원하는 지역을 남기면 중매인이 확인할 수 있습니다."
        />
      )}
      {!u && <LoginGate next="/requests" />}
    </>
  );
}
