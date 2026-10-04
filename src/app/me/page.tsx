import Link from "next/link";
import { currentUser } from "@/server/auth";
import { listings, requests } from "@/server/queries";
import { Heading, LoginGate, ProductCard, Empty } from "@/components/ui";
import { Action } from "@/components/actions";
import {
  UserCircle,
  ArrowUpRight,
  Plus,
  Heart,
  SignOut,
  ShieldCheck,
} from "@/components/icons";
import { roleNames } from "@/lib/model";
export const metadata = { title: "내 정보" };
export default async function Me({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const u = await currentUser();
  if (!u) return <LoginGate next="/me" />;
  const { tab } = await searchParams,
    saved = tab === "saved";
  const items = await listings(u, saved ? { saved: true } : { own: true });
  const req = u.role === "buyer" ? await requests(u, true) : [];
  return (
    <>
      <div className="me-header">
        <span className="avatar large">
          <UserCircle size={46} />
        </span>
        <div>
          <span className="eyebrow">
            {roleNames[u.role]}
            {u.admin ? " · 운영자" : ""}
          </span>
          <h1>{u.profile.business}</h1>
          <p>
            {u.profile.name} · {u.profile.region}
          </p>
        </div>
        <Link href="/me/profile" className="button secondary">
          내 정보 수정
          <ArrowUpRight size={18} />
        </Link>
      </div>
      <div className="me-shortcuts">
        <Link href="/me/profile">
          <Heart size={22} />
          <span>
            관심 지역·어종
            <strong>
              {u.profile.interests.regions.join(", ") || "전국"} ·{" "}
              {u.profile.interests.species.join(", ") || "전체 어종"}
            </strong>
          </span>
          <ArrowUpRight size={20} />
        </Link>
        <Link href="/notifications">
          <ShieldCheck size={22} />
          <span>
            내 알림함
            <strong>
              {u.profile.notifications
                ? `매일 ${u.profile.digestHour}시 요약`
                : "요약 알림 꺼짐"}
            </strong>
          </span>
          <ArrowUpRight size={20} />
        </Link>
        {u.admin && (
          <Link href="/admin">
            <ShieldCheck size={22} />
            <span>
              운영 관리<strong>회원 관리 · 신고 · 이용 현황</strong>
            </span>
            <ArrowUpRight size={20} />
          </Link>
        )}
      </div>
      <div className="tabs">
        <Link className={!saved ? "active" : ""} href="/me">
          내 활동
        </Link>
        <Link className={saved ? "active" : ""} href="/me?tab=saved">
          관심 상품
        </Link>
      </div>
      {saved ? (
        <>
          {items.length ? (
            <div className="product-grid">
              {items.map((l) => (
                <ProductCard key={l.id} item={l} user={u} saved />
              ))}
            </div>
          ) : (
            <Empty
              title="관심 상품을 저장해보세요"
              description="다시 보고 싶은 상품의 하트를 누르면 여기에 모입니다."
              href="/"
              label="오늘 물건 둘러보기"
            />
          )}
        </>
      ) : u.role === "broker" ? (
        <>
          <Heading
            title="내가 올린 물건"
            action={
              <Link href="/listings/new" className="button">
                <Plus size={19} />
                물건 올리기
              </Link>
            }
          />
          {items.length ? (
            <div className="product-grid">
              {items.map((l) => (
                <ProductCard key={l.id} item={l} user={u} />
              ))}
            </div>
          ) : (
            <Empty
              title="첫 물건을 올려보세요"
              description="오늘 확보한 물건의 사진과 판매 조건을 알려주세요."
              href="/listings/new"
              label="물건 올리기"
            />
          )}
        </>
      ) : u.role === "buyer" ? (
        <>
          <Heading
            title="내 매입 요청"
            action={
              <Link href="/requests/new" className="button">
                <Plus size={19} />
                매입 요청
              </Link>
            }
          />
          {req.length ? (
            <div className="my-requests">
              {req.map((r) => (
                <div key={r.id}>
                  <h3>
                    {r.data.species} · {r.data.quantity}
                    {r.data.unit}
                  </h3>
                  <p>
                    {r.data.region} · {r.data.deadline}까지
                  </p>
                  {r.closed_at ? (
                    <span className="muted">모집 완료</span>
                  ) : (
                    <Action endpoint="requests/close" payload={{ id: r.id }}>
                      모집 마감
                    </Action>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Empty title="아직 작성한 매입 요청이 없습니다" />
          )}
        </>
      ) : (
        <Empty
          title="보관업체 소개를 관리하세요"
          description="시설 정보와 취급 조건을 등록하고 새로운 거래처와 연결하세요."
          href="/storage/new"
          label="내 업체 관리"
        />
      )}
      <div className="logout">
        <Action endpoint="auth/logout" to="/" className="text-button muted">
          <SignOut size={18} />
          로그아웃
        </Action>
      </div>
    </>
  );
}
