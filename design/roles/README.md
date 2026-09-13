# 역할별 화면·기능 명세

## 이 폴더는 무엇인가

MANSUN의 **각 역할(7개)** 이 어떤 화면에서 어떤 일을 어떻게 하는지 정리한 명세 묶음. 구현·테스트·UI 디자인의 단일 출처(SSoT)로 사용한다.

기존 문서와의 관계:

| 문서 | 결 |
|------|----|
| 기획서 / 요구사항 v0.3 | 도메인·UC·정책 (Why·What) |
| `design/00 ~ 06` | 멀티테넌트 아키텍처 결정 (How — 구조) |
| `design/roles/` (본 문서) | 역할별 화면·기능 명세 (How — 사용자 관점) |
| `docs/` (mockup) | HTML 시각화 (운영자·중매인만) |

## 읽는 법

1. 본 `README.md` 의 매트릭스로 전체 그림을 잡는다
2. 관심 역할의 개별 문서로 들어가서 화면별 상세를 본다
3. 화면별 액션·입력 필드·상호작용 흐름은 각 역할 문서 안에 있다
4. 권한·라우팅·라이프사이클은 본 폴더에서 재정의하지 않는다 → 필요하면 `design/02-iam.md`, `design/04-ui-changes.md` 로 점프

## 7개 역할 (한눈에)

| # | 역할 | 디바이스 | 스코프 | mockup | 주된 책임 |
|---|------|---------|--------|--------|----------|
| 00 | [Platform Admin](00-platform-admin.md) | 데스크톱 | Platform | 없음 | Tenant 등록·정지, 플랫폼 통계 |
| 01 | [수협 Admin](01-suhyup-admin.md) | 데스크톱 | Tenant | 없음 | Tenant 설정·사용자·면허 관리 |
| 02 | [운영자](02-operator.md) | 데스크톱 | Tenant | ✓ 5p | 경매 진행 전 과정 |
| 03 | [입고담당](03-receiver.md) | 모바일 (현장) | Tenant | 없음 | 현장 입고 입력 |
| 04 | [중매인](04-broker.md) | 모바일 | Tenant + Self | ✓ 3p | 입찰 |
| 05 | [선주](05-shipper.md) | 모바일 | Self | 없음 | 본인 출하/정산 조회 |
| 06 | [노조](06-union.md) | 모바일·데스크톱 | Tenant(읽기) | 없음 | 작업 일정 조회 |

## 역할 × 화면 매트릭스

각 셀: `✓` 접근 가능, `R` 읽기 전용, `-` 권한 없음, `*` mockup 존재

| 화면 | URL 패턴 | P.Admin | T.Admin | Op | Recv | Brk | Ship | Union |
|------|----------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 로그인 | `/login` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 수협 선택 | `/select-tenant` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Platform** |
| 플랫폼 대시보드 | `/platform` | ✓ | - | - | - | - | - | - |
| Tenant 목록 | `/platform/tenants` | ✓ | - | - | - | - | - | - |
| Tenant 등록 | `/platform/tenants/new` | ✓ | - | - | - | - | - | - |
| Tenant 상세 | `/platform/tenants/{code}` | ✓ | - | - | - | - | - | - |
| 글로벌 사용자 | `/platform/users` | ✓ | - | - | - | - | - | - |
| 플랫폼 통계 | `/platform/stats` | ✓ | - | - | - | - | - | - |
| 플랫폼 감사 로그 | `/platform/audit-logs` | ✓ | - | - | - | - | - | - |
| **Tenant — 공통** |
| Tenant 대시보드 | `/t/{code}` | R | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 알림함 | `/t/{code}/notifications` | - | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Tenant — Admin** |
| 수협 설정 | `/t/{code}/admin/settings` | R | ✓ | - | - | - | - | - |
| 사용자/멤버 관리 | `/t/{code}/admin/members` | R | ✓ | - | - | - | - | - |
| 중매인 면허 | `/t/{code}/admin/brokers` | R | ✓ | - | - | - | - | - |
| 선주 등록 | `/t/{code}/admin/shippers` | R | ✓ | - | - | - | - | - |
| 감사 로그 (Tenant) | `/t/{code}/admin/audit-logs` | R | ✓ | - | - | - | - | - |
| 통계/리포트 | `/t/{code}/admin/stats` | R | ✓ | ✓ | - | - | - | - |
| **Tenant — 운영** |
| 운영자 대시보드 *  | `/t/{code}/operator/dashboard` | R | ✓ | ✓ | - | - | - | - |
| 입고 등록 * | `/t/{code}/operator/intake` | R | ✓ | ✓ | ✓ | - | - | - |
| 경매 공지 * | `/t/{code}/operator/notice` | R | ✓ | ✓ | - | - | - | - |
| 개찰·결과 * | `/t/{code}/operator/results` | R | ✓ | ✓ | - | - | - | - |
| 정산 * | `/t/{code}/operator/settlement` | R | ✓ | ✓ | - | - | - | - |
| 입찰 내역 (전체) | `/t/{code}/operator/bids` | R | ✓ | ✓ | - | - | - | - |
| **Tenant — 입고담당** |
| 입고 현장 메인 | `/t/{code}/receiver` | R | ✓ | ✓ | ✓ | - | - | - |
| 신규 입고 | `/t/{code}/receiver/new` | - | - | ✓ | ✓ | - | - | - |
| **Tenant — 중매인** |
| 진행중 경매 * | `/t/{code}/broker/auctions` | - | - | - | - | ✓ | - | - |
| 입찰 화면 * | `/t/{code}/broker/bid/{auction_id}` | - | - | - | - | ✓ | - | - |
| 내 입찰 결과 * | `/t/{code}/broker/results` | - | - | - | - | ✓ | - | - |
| 내 정산 내역 | `/t/{code}/broker/settlement` | - | - | - | - | ✓ | - | - |
| **Tenant — 선주** |
| 출하 메인 | `/t/{code}/shipper` | - | - | - | - | - | ✓ | - |
| 선박별 출하 | `/t/{code}/shipper/vessels` | - | - | - | - | - | ✓ | - |
| 출하 상세 | `/t/{code}/shipper/intake/{id}` | - | - | - | - | - | ✓ | - |
| 정산 내역 | `/t/{code}/shipper/settlement` | - | - | - | - | - | ✓ | - |
| **Tenant — 노조** |
| 작업 일정 | `/t/{code}/union/schedule` | - | - | - | - | - | - | ✓ |
| 작업량 통계 | `/t/{code}/union/stats` | - | - | - | - | - | - | ✓ |

> Platform Admin 의 `R` 표시는 운영 도메인 데이터를 **읽기 전용**으로 볼 수 있다는 의미 (`design/02-iam.md` 참조).

## UC ↔ 역할 매트릭스

요구사항 v0.3 §3 의 UC를 어느 역할이 수행하는지.

| UC | 제목 | 주관 역할 | 보조 역할 | 명세 위치 |
|----|------|-----------|-----------|----------|
| UC-01 | 입고 등록 | Receiver | Operator (겸임) | `03-receiver.md`, `02-operator.md` |
| UC-02 | 경매 공지 | Operator (자동/수동) | — | `02-operator.md` |
| UC-03 | 입찰 | Broker | — | `04-broker.md` |
| UC-04 | 개찰 | System (자동) / Operator (수동) | — | `02-operator.md` |
| UC-05 | 결과 통보 | System | Broker·Shipper·Operator 가 수신 | `02-operator.md`, `04-broker.md`, `05-shipper.md` |
| UC-06 | 정산 | Operator | T.Admin (정책 변경) | `02-operator.md`, `01-suhyup-admin.md` |
| UC-07 | 사용자/권한 관리 | T.Admin | P.Admin (Tenant 등록·정지) | `01-suhyup-admin.md`, `00-platform-admin.md` |
| UC-08 | 통계/리포트 | T.Admin, Operator | Broker·Shipper(Self), Union(작업량) | 모든 역할 문서 |

## 공통 컴포넌트

각 역할 문서에서 중복 정의하지 않고 본 절을 참조.

### `<TopBar>` (헤더 공통)

| 영역 | 표시 |
|------|------|
| 브랜드 | `🐟 MANSUN` |
| Tenant 칩 | 현재 Tenant 이름 + (다중 소속자) ▾ → `<TenantSwitcher>` 펼침 |
| 알림 벨 | 미확인 개수 배지, 클릭 시 `/t/{code}/notifications` |
| 사용자 메뉴 | 이름·역할 표시, 드롭다운에 `프로필`, `로그아웃` |

### `<TenantSwitcher>` (Tenant 전환 드롭다운)

- 본인 소속 Tenant 카드 목록 + 현재 활성 표시
- "다른 수협 보기" → `/select-tenant` 풀 화면 이동
- 다중 소속자만 노출. 단일 소속자는 텍스트 표시만
- 전환 시: 폼 작성 중이면 경고 모달 → 토큰 재발급 → 의미 동일 페이지로 리다이렉트
- 자세한 동작은 [`design/04-ui-changes.md`](../04-ui-changes.md#2-테넌트-전환-드롭다운-모든-페이지-공통) 참조

### `<TenantStatusBanner>`

- Tenant 상태가 `suspended`/`archived` 일 때 모든 페이지 상단 노란/회색 배너
- 메시지: "이 수협은 현재 정지/아카이브 상태입니다. 조회만 가능합니다."

### `<PermissionGate>`

- 역할별 조건부 렌더링 컴포넌트. 메뉴/버튼/페이지 단위
- 사용 예: 운영자 메뉴 중 "정산"은 `role='operator' AND tenant.status='active'` 일 때만 표시

### `<AuditLogTable>`

- 모든 감사 로그 화면에서 재사용
- 컬럼: 시각·구분·내용·처리자·IP·Tenant(Platform 한정)
- 필터: 기간·구분·처리자, 검색
- 페이지네이션: 50건/페이지

### `<Toast>` / `<Modal>`

- Toast: 성공/실패 메시지 (2초 자동 소거)
- Modal: 확정(낙찰/정산 등) 시 confirm + 사유 입력 옵션

## 표기 규약

### Mockup 매핑 표시

| 기호 | 의미 |
|------|------|
| `[mockup: docs/operator/dashboard.html]` | 해당 mockup 파일에 대응 |
| `[mockup 없음 — 구현 필요]` | mockup 단계에서 누락 → 구현 시 새로 만듦 |

### 시퀀스 다이어그램

- Mermaid `sequenceDiagram` 사용
- 액터: 역할명 (Operator, Broker, ...) 또는 시스템 (System, Notification)
- 외부 시스템: Suhyup ERP, KakaoTalk, SMS Gateway 등 명확히 명명
- 한 다이어그램은 3~5 단계 이내. 길면 분리

### 입력 필드 표

```
| 필드 | 타입 | 필수 | 검증 규칙 | 예시 |
|------|------|------|----------|------|
```

- 타입: `text` / `number` / `enum` / `date` / `datetime` / `file` / `phone` / `email` / `password`
- 필수: ✓ / ☐
- 검증: 최소·최대, 정규식, 형식, 사용자 정의 규칙
- 예시: 값 1~2개

### 액션 라벨

- 동사형 (`개찰 실행`, `공지 발송`, `정산 확정`)
- mockup의 버튼 라벨과 일치 — mockup이 없으면 UI 라벨 후보를 본 명세에서 결정
- 위험 액션은 별도 표시 (`⚠ 정지`, `⚠ 아카이브`)

## 단일 테넌트 호환

본 명세는 멀티 Tenant 환경을 가정하나, **Tenant가 1개만 있는 환경(파일럿 단계)** 에서도 모든 흐름이 깨지지 않아야 한다:

- 다중 소속자 UX는 자동 숨김
- `/select-tenant` 는 단일 소속자에게 표시되지 않음
- URL의 `{code}` 는 단일 Tenant 의 code 로 고정

## 모든 문서의 공통 마무리

각 역할 문서 끝에:

- **결정** (확정 사항)
- **Open** (미결정 항목 — `design/06-open-questions.md` 와 교차 참조)

---

**결정**: 본 README 의 매트릭스·공통 컴포넌트·표기 규약 모두 확정.
**Open**: 새로운 화면 도입 시 본 README 매트릭스 업데이트 필수 — 운영 규칙.
