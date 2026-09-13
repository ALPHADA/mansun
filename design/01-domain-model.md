# 01. 도메인 모델

## 신규 핵심 엔티티

### Tenant (수협)

```sql
CREATE TABLE tenants (
  id              UUID PRIMARY KEY,
  code            TEXT UNIQUE NOT NULL,        -- 예: 'gangu', 'pohang' (URL·경매번호 prefix)
  name            TEXT NOT NULL,                -- 예: '강구항 수협'
  region          TEXT,                         -- 광역시·도
  status          TEXT NOT NULL,                -- 'pending' | 'active' | 'suspended' | 'archived'
  contact_email   TEXT,
  contact_phone   TEXT,
  fee_policy      JSONB NOT NULL,               -- {위판수수료, 중매인수수료, VAT 등}
  box_weight_table JSONB,                       -- {갈치: 20, 고등어: 18, ...} kg
  schedule        JSONB,                        -- 회차 운영 시간표
  digital_close_buffer_min INT DEFAULT 5,       -- 디지털 마감 ~ 현장 시작 사이 분
  tie_break_policy TEXT DEFAULT 'first_come',   -- 'first_come' | 'lottery' | 'split' | 'rebid'
  digital_price_visibility TEXT DEFAULT 'hidden', -- 'hidden' | 'auctioneer_only' | 'public'
  created_at      TIMESTAMPTZ NOT NULL,
  activated_at    TIMESTAMPTZ
);
```

- `code` 는 URL(`/t/gangu/...`)과 경매번호 prefix에 사용 → 변경 불가
- `fee_policy`, `box_weight_table`, `tie_break_policy` 등은 요구사항 v0.3 § 7 Action Items 중 수협마다 다른 정책을 Tenant 단위로 흡수

### User (글로벌)

```sql
CREATE TABLE users (
  id              UUID PRIMARY KEY,
  email           TEXT UNIQUE,                  -- 둘 중 하나는 필수
  phone           TEXT UNIQUE,
  name            TEXT NOT NULL,
  identity_verified BOOLEAN DEFAULT FALSE,      -- 실명·면허 1차 인증 여부
  created_at      TIMESTAMPTZ NOT NULL,
  last_login_at   TIMESTAMPTZ
);
```

- Tenant와 무관하게 존재 → 같은 사람이 강구·포항 수협에 동시 가입해도 계정 1개
- 본인 확인은 글로벌 1회 (`identity_verified`), Tenant 단위 면허 확인은 별도(Membership)

### Membership (User × Tenant × Role)

```sql
CREATE TABLE memberships (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  role            TEXT NOT NULL,                -- 'admin' | 'operator' | 'receiver'
                                                -- | 'broker' | 'shipper' | 'union'
  license_no      TEXT,                         -- 중매인 면허번호 등 Tenant 발급 식별자
  status          TEXT NOT NULL,                -- 'invited' | 'active' | 'suspended'
  invited_by      UUID REFERENCES users(id),
  joined_at       TIMESTAMPTZ,
  suspended_at    TIMESTAMPTZ,
  UNIQUE (user_id, tenant_id, role)
);

CREATE INDEX idx_membership_user ON memberships(user_id);
CREATE INDEX idx_membership_tenant ON memberships(tenant_id);
```

- 한 User × Tenant 에 여러 Role 부여 가능 (예: 입고담당 + 운영자 겸임 → 요구사항 § 2 참고 주석과 정합)
- `license_no` 는 Tenant 단위로 발급되므로 수협마다 다를 수 있음 — 의도된 분리

### Platform Admin (별도 모델)

```sql
CREATE TABLE platform_admins (
  user_id         UUID PRIMARY KEY REFERENCES users(id),
  granted_by      UUID REFERENCES users(id),
  granted_at      TIMESTAMPTZ NOT NULL
);
```

- Membership과 분리 — Tenant 종속이 아니므로 별도 테이블
- 매우 소수(MANSUN 운영팀)만 부여되는 권한

## 기존 도메인 엔티티의 변경

요구사항 v0.3 의 모든 운영 데이터에 **`tenant_id NOT NULL` 강제 추가**.

| 엔티티 | 추가 컬럼 | 비고 |
|--------|-----------|------|
| `vessels` (선박) | `tenant_id` | 선박이 여러 수협 출하 시 같은 선박이 Tenant별 레코드 분리 |
| `intakes` (입고) | `tenant_id` | UC-01 |
| `auctions` (경매 물품) | `tenant_id`, `auction_no` | `auction_no` = `{tenant_code}-{date}-{seq}` |
| `bids` (입찰) | `tenant_id` | UC-03, 감사 로그 영구 보존 |
| `auction_results` (낙찰) | `tenant_id` | UC-04/05 |
| `settlements` (정산) | `tenant_id` | UC-06, 수수료율은 Tenant.fee_policy 적용 |
| `notices` (공지) | `tenant_id` | UC-02 |
| `notice_recipients` (공지 수신 로그) | `tenant_id` | 수신 대상 산정에 Tenant 한정 |

> 같은 선박이 강구·포항에 동시 출하하는 경우, **선박 마스터를 Tenant별로 별도 등록**하는 것이 합당하다고 본다.
> 글로벌 선박 마스터를 두면 어업권·등록기관 차이로 인한 데이터 충돌 위험이 크다.
> 다만 `shipper_user_id` 는 글로벌이므로 동일 선주가 두 수협에 본인 명의 선박을 등록 가능.

## 격리 정책

### 원칙

> **모든 도메인 쿼리는 active tenant 필터를 강제한다.**

다음 두 방어선을 함께 둔다.

1. **애플리케이션 레벨**: 모든 도메인 데이터 접근은 공통 데이터 액세스 레이어를 통과하고, 이 레이어는 세션의 `active_tenant_id`를 자동으로 WHERE 절에 주입. 누락 시 컴파일/런타임 에러.
2. **데이터베이스 레벨**: PostgreSQL RLS 등 행 단위 보안을 활성화. 세션 변수에 `app.current_tenant_id` 를 세팅하지 않으면 SELECT/INSERT 모두 거부.

### 예외

다음만 Tenant 필터를 적용하지 않는다 (또는 Platform 컨텍스트 한정):

- `tenants`, `users`, `memberships`, `platform_admins`
- 공유 마스터 (다음 절)
- Platform Admin이 진행하는 플랫폼 통계 집계

## 공유 vs 테넌트별 마스터

| 마스터 데이터 | 위치 | 사유 |
|----------------|------|------|
| 어종 표준명 (`fish_species`) | **공유** | 수산물 표준어종 코드(예: KOSIS)를 따르면 충분 |
| 등급 코드 (A/B/C) | **공유** | 단순한 enum |
| 박스/마리 환산 중량 | **Tenant별** | 위판장마다 박스 규격이 다름 (요구사항 § 7 Action Item) |
| 수수료율 | **Tenant별** | 위판수수료·중매인수수료가 수협마다 다름 |
| 회차 운영 시간표 | **Tenant별** | 새벽 경매 시각이 위판장마다 상이 |
| 알림 채널 자격증명 | **Tenant별** | 카카오 알림톡 발신 프로필이 수협 사업자번호와 묶임 |
| 동일가 처리 정책 | **Tenant별** | 수협별 규약에 따름 (§ 7) |

## 식별자 규약

| 식별자 | 형식 | 예시 |
|--------|------|------|
| Tenant code | 영문 소문자, 영숫자, 3~12자 | `gangu`, `pohang`, `tongyeong` |
| 경매번호 | `{tenant_code}-{YYYYMMDD}-{회차}{순번}` | `gangu-20260512-A01` |
| 면허번호 | Tenant별 독립 (현행 형식 유지) | `M-201` (Tenant A 발급), 동일 사용자가 Tenant B에서는 `B-340` |
| 정산서 번호 | `{tenant_code}-S-{YYYYMM}-{seq}` | `gangu-S-202605-0001` |

## 감사 로그

- 모든 쓰기 작업(입고, 입찰, 개찰, 정산, 공지 발송, 사용자 정지 등)에 다음 컬럼 기록:
  - `tenant_id`, `actor_user_id`, `action`, `target_id`, `before` (JSONB), `after` (JSONB), `at` (TIMESTAMPTZ)
- 보존: 영구 (요구사항 § 5 데이터 보존)
- Tenant 아카이브 후에도 감사 로그는 별도 정책으로 유지

---

**결정**:
- Tenant·User·Membership 3엔티티 분리
- 도메인 데이터에 `tenant_id` 강제, 이중 격리(앱 + DB)
- 어종/등급만 공유, 나머지는 Tenant별

**Open**:
- 선박 마스터의 글로벌 통합 vs Tenant 분리 — 본 문서는 분리 권고하나 `06-open-questions.md` 에서 재논의
- 어종 코드 표준의 출처(KOSIS, 수협 내부 코드 등)
