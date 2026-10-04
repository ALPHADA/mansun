import Link from "next/link";
import { currentUser } from "@/server/auth";
import { notifications } from "@/server/queries";
import { Heading, Empty, LoginGate } from "@/components/ui";
import { Action } from "@/components/actions";
import { Bell, ArrowUpRight } from "@/components/icons";
import { dateLabel } from "@/lib/model";
export const metadata = { title: "알림함" };
export default async function Notifications() {
  const u = await currentUser();
  if (!u)
    return (
      <LoginGate
        next="/notifications"
        message="로그인하고 내 알림을 확인하세요"
      />
    );
  const items = await notifications(u);
  return (
    <div className="narrow">
      <Heading
        title="나에게 온 소식"
        description={`관심 조건의 하루 요약은 매일 ${u.profile.digestHour}시에 알림함으로 도착합니다.`}
        action={
          <Action endpoint="notifications/read" className="text-button">
            모두 읽음
          </Action>
        }
      />
      {items.length ? (
        <div className="notification-list">
          {items.map((n) => (
            <article key={n.id} className={n.read_at ? "read" : "unread"}>
              <div className="notification-icon">
                <Bell size={23} />
              </div>
              <div>
                <small>{dateLabel(n.created_at)}</small>
                <h3>{n.title}</h3>
                <p>{n.body}</p>
                <div className="row">
                  <Link href={n.href} className="text-link">
                    확인하기
                    <ArrowUpRight size={15} />
                  </Link>
                  {!n.read_at && (
                    <Action
                      endpoint="notifications/read"
                      payload={{ id: n.id }}
                      className="text-button muted"
                    >
                      읽음 처리
                    </Action>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title="아직 도착한 알림이 없습니다"
          description="관심 지역과 어종을 설정하면 새 물건과 매입 요청을 모아 알려드립니다."
          href="/me/profile"
          label="관심 조건 설정"
        />
      )}
    </div>
  );
}
