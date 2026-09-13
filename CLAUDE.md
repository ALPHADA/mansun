@AGENTS.md

# MANSUN — 개발 규약

수산물 위판 경매 B2B 플랫폼(멀티테넌트). 표기는 항상 **MANSUN**. UI 텍스트는 한국어, 코드/식별자는 영어.

## 스택
Next.js 16 (App Router, `src/`), React 19, TypeScript strict, Drizzle ORM + postgres.js, PostgreSQL 14 (RLS), jose(JWT 쿠키), zod, vitest. Tailwind 없음 — `src/styles/globals.css`의 mockup 디자인 시스템 클래스 사용.

## 명령
`pnpm dev` (기본 3000; 세션에서는 `-p 3100` 사용중) · `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm db:setup` · `pnpm db:generate` · `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:reset`(스키마 드롭+마이그레이션+시드)
시드 계정 비밀번호 `mansun1234`: platform@mansun.kr(P.Admin) · admin@gangu.kr · operator@gangu.kr(operator+receiver) · receiver@gangu.kr · broker@gangu.kr(강구 M-201 + 포항 B-340) · lee@gangu.kr/park@gangu.kr/choi@gangu.kr(broker) · shipper1~4@gangu.kr · union@gangu.kr · admin@pohang.kr · operator@pohang.kr

## 디렉터리
- `src/db/schema/{platform,domain}.ts` 스키마 + 타입(`Tenant`, `Auction` …). `src/db/rls.sql` RLS 정책(마이그레이션 후 자동 적용).
- `src/db/context.ts` — **모든 도메인 테이블 접근은 `withTenant(tenantId, tx => …)` 안에서**. 플랫폼 테이블(tenants/users/memberships/platform_admins/fish_species/audit_logs/notifications/notification_logs/invitations/otp_codes)은 `db` 직접 사용 가능. 스케줄러·플랫폼 집계는 `withPlatform`.
- `src/lib/auth/session.ts` 세션 JWT · `src/lib/auth/context.ts` — `requireTenantContext(code)`(페이지), `requirePermission(code, perm, {write})`(서버 액션), `hasPermission(ctx, perm)`, `requirePlatformAdmin()`, `requireSession()`.
- `src/lib/authz/matrix.ts` — 권한 매트릭스 단일 출처(`Permission`), `ROLE_HOME`, `ROLE_LABEL`.
- `src/lib/errors.ts` — `AppError`, `validation()/stateError()/forbidden()/notFound()`, `ActionResult`, `toActionError`. `src/lib/action.ts` — `run(fn)` 서버 액션 래퍼.
- `src/lib/format.ts` — `won`, `num`, `unitLabel`, `fmtDateTime/fmtTime/fmtDate`, `localDateStr`, `toLocalInput/fromLocalInput`(KST datetime-local), `remainingLabel`.
- `src/domain/` 순수 로직: `auction/award.ts`(개찰 결정, `makeAuctionNo`), `settlement/calc.ts`, `status.ts`(상태 라벨/배지 맵 `AUCTION_STATUS` 등, `TIE_BREAK_LABEL`).
- `src/services/` 유스케이스: `auth`, `audit`, `notification`(notify/usersByRoles/listNotifications/markRead), `round`, `vessel`(listVessels/listShippers/createVessel), `species`, `intake`, `notice`, `auction`(listAuctions/getAuction/openAuction/openAllClosed/enterFieldResult/requestReauction/raiseObjection/listDisputes/decideDispute/listActiveBrokers), `bid`(placeBid/myBids/myBidFor/listAllBids/recentAveragePrice/bidsForAuction), `settlement`(generateSettlements/listSettlements/getSettlement/confirmRoundSettlements/markPaid/roundSettlementSummary).
- `src/adapters/` 외부 연동(notification mock, accounting mock, storage local). `src/scheduler/tick.ts` 10초 tick (`POST /api/internal/tick`으로 수동).
- `src/components/` — `SidebarShell`(데스크톱), `MobileShell`(모바일 420px 프레임+하단 탭), `TenantChrome.tsx`의 `tenantChrome(code)`(레이아웃 공통), `Badge`/`StatusBadge`, `Countdown`(서버 시각 보정), `Modal`/`ConfirmModal`, `useToast()`, `NavLink`.
- 라우트: `src/app/t/[code]/{operator,admin,broker,receiver,shipper,union}/…`, `src/app/platform/…`, `(auth)/`.

## 페이지/액션 패턴
```tsx
// page.tsx (서버 컴포넌트)
export default async function Page({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string,string|undefined>> }) {
  const { code } = await params;
  const ctx = await requireTenantContext(code);      // 레이아웃이 역할 가드, 페이지는 세부 권한 hasPermission()
  const data = await someService(ctx.tenant.id, …);
  return <><div className="panel">…</div><SomeClientForm code={code} … /></>;
}
// actions.ts (같은 폴더, "use server")
export async function doThing(code: string, input: X): Promise<ActionResult<Y>> {
  return run(async () => { const ctx = await requirePermission(code, "intake.write"); return service(ctx, input); }, "완료 메시지");
}
// 클라이언트 컴포넌트: useTransition + useToast + router.refresh()
```
- 쓰기 액션은 반드시 `requirePermission(code, perm)` (readOnly/정지 Tenant/Platform Admin 자동 차단). 읽기 전용 화면에서는 `ctx.readOnly`면 버튼 숨김.
- 모든 쓰기 서비스는 `audit()` 기록. 시각은 서버 기준(`new Date()`), 표시는 KST 포맷터.
- 폼 `datetime-local`은 `toLocalInput()/fromLocalInput()`으로 KST 변환.
- 라우트 파라미터/`searchParams`는 Promise — `await` 필수 (Next 16).
- 스타일: `.panel/.panel-header/.panel-body(.dense)`, `.data-table`, `.kpi-grid/.kpi-card`, `.form-grid`, `.badge-*`, `.auction-card`, `.result-card`, `.detail-section/.detail-row`, `.bid-input-wrap`, `.notice-box`, `.chips/.chip`, `.tabs`, `.live-banner`, `.hero-card`, `.empty-state`, `.list-item`, `.kv` 등 — `globals.css` 참조. 새 클래스는 최소화하고 필요 시 `globals.css` 끝에 추가.
- 금액은 `won()`, 숫자는 `num()`; 상태 배지는 `<StatusBadge map={AUCTION_STATUS} value={a.status} />`.
- 문서 SSoT: `design/roles/*.md`(화면·필드·검증), `design/02-iam.md`(권한), `design/03-tenant-lifecycle.md`(설정 항목).
