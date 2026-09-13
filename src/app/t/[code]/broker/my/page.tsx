import { requireTenantContext } from "@/lib/auth/context";
import { getProfile, listMyBrokerLicenses, getNotificationPrefs } from "@/services/broker";
import { StatusBadge, Badge } from "@/components/Badge";
import { LICENSE_STATUS, MEMBERSHIP_STATUS } from "@/domain/status";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { logoutAction } from "@/app/(auth)/actions";
import { NotificationPrefsForm, PasswordForm } from "./MyForms";

export const metadata = { title: "마이페이지" };

const DEFAULT_PREFS = { inapp: true, kakao: true, sms: false, email: true, lostBidInapp: true };

export default async function BrokerMyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await requireTenantContext(code);
  const [profile, licenses, prefs] = await Promise.all([
    getProfile(ctx.session.userId),
    listMyBrokerLicenses(ctx.session.userId),
    ctx.membershipId ? getNotificationPrefs(ctx.membershipId) : Promise.resolve(null),
  ]);
  const current = licenses.find((l) => l.membershipId === ctx.membershipId);
  const expiringSoon = (d: string | null) => d ? (new Date(d).getTime() - Date.now()) < 30 * 86_400_000 : false;

  return (
    <>
      <div className="detail-section">
        <h2>👤 {profile?.name ?? ctx.session.name}</h2>
        <div className="detail-row"><span className="label">전화</span><span className="value">{profile?.phone ?? "-"}</span></div>
        <div className="detail-row"><span className="label">이메일</span><span className="value">{profile?.email ?? "-"}</span></div>
        <div className="detail-row"><span className="label">본인 인증</span><span className="value">{profile?.identityVerified ? <Badge tone="success">완료</Badge> : <Badge tone="muted">미인증</Badge>}</span></div>
        <div className="detail-row"><span className="label">최근 로그인</span><span className="value">{fmtDateTime(profile?.lastLoginAt)}</span></div>
        {current && <div className="detail-row"><span className="label">현재 수협 · 면허</span><span className="value">{current.tenantName} · {current.licenseNo ?? "-"}</span></div>}
      </div>

      <div className="section-title">면허 정보 ({licenses.length}개 수협)</div>
      {licenses.length === 0 && <div className="readonly-note">등록된 중매인 면허가 없습니다</div>}
      {licenses.map((l) => (
        <div key={l.membershipId} className={`license-card${l.membershipId === ctx.membershipId ? " current" : ""}`}>
          <div className="row">
            <div>
              <div className="name">{l.tenantName} {l.membershipId === ctx.membershipId && <span className="small muted">(현재)</span>}</div>
              <div className="sub">면허번호 {l.licenseNo ?? "-"} · 가입 {fmtDate(l.joinedAt)}</div>
            </div>
            <div className="flex" style={{ gap: 4 }}>
              {l.licenseStatus && <StatusBadge map={LICENSE_STATUS} value={l.licenseStatus} />}
              {l.status !== "active" && <StatusBadge map={MEMBERSHIP_STATUS} value={l.status} />}
            </div>
          </div>
          <div className="sub">
            만료일 {l.licenseExpiresAt ? fmtDate(l.licenseExpiresAt) : "미등록"}
            {l.licenseStatus === "active" && expiringSoon(l.licenseExpiresAt) && <span className="text-danger"> · 만료 임박 — 수협에 갱신을 문의하세요</span>}
            {l.licenseStatus !== "active" && l.licenseStatus && <span className="text-danger"> · 입찰 불가</span>}
          </div>
        </div>
      ))}

      <div className="section-title">알림 설정 ({ctx.tenant.name})</div>
      <div className="detail-section">
        {ctx.membershipId ? <NotificationPrefsForm code={code} initial={prefs ?? DEFAULT_PREFS} readOnly={ctx.readOnly} /> : <div className="readonly-note">활성 멤버십이 없어 설정할 수 없습니다</div>}
        <div className="small muted mt-8">입찰 등록 확인·낙찰 통보·인증번호는 필수 알림으로 항상 발송됩니다.</div>
      </div>

      <div className="section-title">비밀번호 변경</div>
      <div className="detail-section">
        <PasswordForm code={code} />
      </div>

      <form action={logoutAction} className="mt-16">
        <button type="submit" className="btn-secondary" style={{ width: "100%", padding: 12 }}>↩ 로그아웃</button>
      </form>
    </>
  );
}
