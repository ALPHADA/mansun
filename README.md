# MANSUN — 수산물 위판 경매 디지털 플랫폼

선박 입항 → 입고 → 공지 → 밀봉 입찰 → 개찰(디지털 + 현장 호가 결합) → 통보 → 정산 전 과정을 다루는 멀티테넌트(다중 수협) B2B 웹앱.
설계 문서는 [`design/`](design/00-overview.md), 역할별 화면 명세는 [`design/roles/`](design/roles/README.md), 초기 HTML mockup은 [`docs/`](docs/index.html).

## 스택
Next.js 16 (App Router) · React 19 · TypeScript · Drizzle ORM · PostgreSQL 14 (Row Level Security) · jose JWT 세션 · zod · vitest · Playwright

## 로컬 실행
```bash
brew services start postgresql@14      # 로컬 PG (또는 임의의 PG 14+)
pnpm install
cp .env.example .env                    # 필요 시 DATABASE_URL 등 수정
pnpm db:setup                           # DB + 롤(mansun_owner / mansun_app) 생성
pnpm db:migrate                         # 마이그레이션 + RLS 정책 적용
pnpm db:seed                            # 시연 데이터 (강구항·포항 수협, 오늘 회차, 입고 14건, 입찰)
pnpm dev                                # http://localhost:3000
```
`pnpm db:reset` 은 스키마를 드롭하고 마이그레이션·시드를 다시 수행한다.

### 시드 계정 (비밀번호 공통 `mansun1234`)
| 계정 | 역할 | 비고 |
|---|---|---|
| platform@mansun.kr | Platform Admin | `/platform` 콘솔 |
| admin@gangu.kr | 강구항 수협 Admin | 설정·멤버·면허 |
| operator@gangu.kr | 운영자 + 입고담당 | 입고·공지·개찰·정산 |
| receiver@gangu.kr | 입고담당 | 모바일 현장 입고 |
| broker@gangu.kr | 중매인 (강구 M-201 · 포항 B-340) | 다중 소속 → 수협 선택 화면 |
| lee@gangu.kr / park@gangu.kr / choi@gangu.kr | 중매인 | lee 면허 5일 후 만료 |
| shipper1~4@gangu.kr | 선주 | shipper1 박성진 = 제3만선호 |
| union@gangu.kr | 노조 | 작업조 1반 |
| admin@pohang.kr / operator@pohang.kr | 포항 수협 | 동일가 추첨 정책, 현장 경매 미사용 |

개발 편의: `GET /api/dev/login?email=…&tenant=…` 로 비밀번호 없이 세션 발급(프로덕션 비활성), `POST /api/internal/tick` 으로 스케줄러 즉시 실행.

## 구조
```
src/app/(auth)         로그인 · 수협 선택 · 초청 수락
src/app/platform       Platform Console (Tenant 등록/정지/아카이브, 글로벌 사용자, 통계, 감사)
src/app/t/[code]/      Tenant 컨텍스트 (URL code ↔ 세션 검증)
  operator/            대시보드 · 입고 · 공지 · 개찰/결과 · 현장 결과 입력 · 입찰 내역 · 정산
  receiver/            모바일 현장 입고 (오프라인 큐)
  broker/              진행중 경매 · 입찰 · 내 결과 · 정산 · 마이
  shipper/             출하 · 선박 · 출하 상세(이의 제기) · 정산 · 마이
  union/               오늘 · 7일 일정 · 회차 상세 · 작업량
  admin/               수협 설정(6탭) · 멤버 · 면허 · 선주 · 감사 로그 · 통계
  notifications/       알림함 (다중 수협 통합)
src/services           유스케이스 (모든 쓰기는 감사 로그)
src/domain             순수 로직: 개찰 엔진, 정산 계산, 상태 라벨
src/db                 Drizzle 스키마 · RLS · 시드 · withTenant/withPlatform
src/scheduler          10초 tick: 자동 공지, 상태 전이, 마감·자동 개찰, 재입찰 종료, 면허 만료 알림
src/adapters           SMS/알림톡/이메일/회계 ERP Mock(발송 로그 테이블), 로컬 파일 저장
```

### 핵심 규칙
- **테넌트 격리 2중화**: 모든 도메인 쿼리는 `withTenant(tenantId)` 트랜잭션 안에서 실행되고, PostgreSQL RLS(`src/db/rls.sql`)가 `app.current_tenant_id` 와 일치하지 않는 행을 차단한다. 앱은 비-superuser 롤로 접속한다.
- **권한 매트릭스** 단일 출처 `src/lib/authz/matrix.ts` (`design/02-iam.md`). 서버 액션은 `requirePermission()` 을 반드시 거친다. Platform Admin은 Tenant 도메인 데이터 읽기 전용.
- **시간**: 마감·입찰 시각은 서버 시각만 신뢰. 클라이언트 카운트다운은 `/api/time` 으로 보정.
- **개찰**: `final = max(디지털 최고가, 현장 최고가)`, 예가 미달 시 유찰, 동일가는 수협 정책(선착순/추첨/분할/재입찰). 결과는 append-only(`auction_results`)로 보존, 재개찰은 Admin 승인 후 1회.
- **정산**: 수수료율·VAT·박스 환산은 수협 설정(`tenants.fee_policy` 등)에서 동적으로 적용. 확정 시 회계 어댑터 호출 후 불변.

## 테스트
```bash
pnpm typecheck && pnpm lint && pnpm test   # vitest: 개찰 엔진·정산 계산·권한 매트릭스·RLS 격리(DB 필요)
pnpm e2e                                    # Playwright 스모크 (dev 서버 필요)
```
