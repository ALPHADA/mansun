import Link from "next/link";
import { requirePermission } from "@/lib/auth/context";
import { myProfile, myVessels } from "@/services/shipper";
import { listMemberships } from "@/services/auth";
import { Badge } from "@/components/Badge";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/authz/matrix";
import { logoutAction } from "@/app/(auth)/actions";
import { InlineEditField, NotificationPrefsForm, PasswordForm } from "./MyForms";

export const metadata = { title: "마이페이지" };
export const dynamic = "force-dynamic";

export default async function ShipperMyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await requirePermission(code, "shipper.read_self", { write: false });
  const [p, vessels, memberships] = await Promise.all([myProfile(ctx), myVessels(ctx), listMemberships(ctx.session.userId)]);
  const others = memberships.filter((m) => m.tenantId !== ctx.tenant.id);

  return (
    <>
      <div className="detail-section">
        <h2>👤 {p.user.name} <span className="muted small" style={{ fontWeight: 400 }}>선주 · {ctx.tenant.name}</span></h2>
        <div className="detail-row"><span className="label">이메일</span><span className="value">{p.user.email ?? "-"}</span></div>
        <InlineEditField code={code} field="phone" label="전화" initial={p.user.phone ?? ""} placeholder="01012345678" readOnly={ctx.readOnly} hint="숫자만 10~11자리 · 알림톡/SMS 수신 번호" />
        <InlineEditField code={code} field="bankAccount" label="입금 계좌" initial={p.user.bankAccount ?? ""} placeholder="수협 101-1234-5678 (예금주)" readOnly={ctx.readOnly} hint="정산 지급 계좌 · 변경 시 수협 운영자에게 변경 사실이 감사 로그로 기록됩니다" />
        <div className="detail-row"><span className="label">본인 인증</span><span className="value">{p.user.identityVerified ? <Badge tone="success">완료</Badge> : <Badge tone="muted">미인증</Badge>}</span></div>
        <div className="detail-row"><span className="label">가입일</span><span className="value">{fmtDate(p.joinedAt)}</span></div>
        <div className="detail-row"><span className="label">최근 로그인</span><span className="value">{fmtDateTime(p.user.lastLoginAt)}</span></div>
      </div>
      {ctx.readOnly && <div className="readonly-note">현재 읽기 전용 상태입니다 (수협 상태 또는 조회 모드). 프로필·알림 설정 변경은 불가합니다.</div>}

      <div className="section-title">본인 선박 ({vessels.length}) <span className="muted" style={{ fontWeight: 400 }}>— 등록·갱신은 수협 관리자</span></div>
      <div className="detail-section">
        {vessels.length === 0 && <div className="muted small">등록된 선박이 없습니다</div>}
        {vessels.map((v) => <div key={v.id} className="detail-row"><span className="label">⚓ {v.name}</span><span className="value small">{v.registrationNo ?? "-"} · 누적 {v.intakeCount}건{!v.active && <Badge tone="muted">비활성</Badge>}</span></div>)}
        <div className="text-right small mt-8"><Link href={`/t/${code}/shipper/vessels`}>선박별 출하 이력 →</Link></div>
      </div>

      {others.length > 0 && (
        <>
          <div className="section-title">다른 소속 수협</div>
          <div className="detail-section">
            {others.map((m) => <div key={m.tenantId} className="detail-row"><span className="label">{m.tenantName}</span><span className="value small">{m.roles.map((r) => ROLE_LABEL[r]).join("·")} · 상단 수협 전환으로 이동</span></div>)}
            <div className="muted small mt-8">통합 출하/정산 보기는 지원하지 않습니다. 수협마다 수수료율이 다르므로 각각 조회하세요.</div>
          </div>
        </>
      )}

      <div className="section-title">알림 설정 ({ctx.tenant.name})</div>
      <div className="detail-section">
        <NotificationPrefsForm code={code} initial={p.prefs} readOnly={ctx.readOnly} />
      </div>

      <div className="section-title">비밀번호 변경</div>
      <div className="detail-section">
        <PasswordForm code={code} />
        <div className="muted small mt-8">MFA(2단계 인증)는 추후 지원 예정입니다.</div>
      </div>

      <form action={logoutAction} className="mt-16">
        <button type="submit" className="btn-secondary" style={{ width: "100%", padding: 12 }}>↩ 로그아웃</button>
      </form>
    </>
  );
}
