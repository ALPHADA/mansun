# 04. UI 변경

## 신규 화면

### 1. 수협 선택 화면 (Tenant Picker)

| 항목 | 내용 |
|------|------|
| 진입 시점 | 로그인 직후, **다중 소속자**의 경우만 표시 (단일 소속은 자동 진입) |
| 경로 | `/select-tenant` |
| 표시 정보 | 소속된 Tenant 카드 목록 — Tenant 이름, 지역, 본인의 역할, 마지막 접속일 |
| 동작 | 카드 클릭 → 세션의 `active_tenant_id` 설정 → 해당 Tenant 기본 화면으로 이동 |
| 추가 옵션 | "Platform" 진입 옵션 (Platform Admin만) |
| 디자인 톤 | 모바일·데스크톱 모두 지원. 카드 그리드 |

### 2. 테넌트 전환 드롭다운 (모든 페이지 공통)

| 위치 | 운영자: 사이드바 상단 브랜드 옆 / 중매인: 모바일 헤더 |
|------|------|
| 표시 | 현재 Tenant 이름 + ▾ 아이콘 |
| 클릭 시 | 본인 소속 Tenant 목록 표시 + "다른 수협 보기" → 수협 선택 화면 |
| 전환 시 동작 | 1) 폼 작성 중이면 경고 모달 2) 토큰 재발급 3) 의미가 동일한 페이지로 리다이렉트 (없으면 새 Tenant의 기본 화면) |
| 단일 소속자 | 드롭다운 없이 텍스트만 표시 (Tenant 이름) |

### 3. Platform Console

Platform Admin 전용. 별도 도메인 데이터는 보지 않음.

| 페이지 | 경로 | 주요 요소 |
|--------|------|----------|
| 대시보드 | `/platform` | 활성/정지/아카이브 Tenant 수, 오늘 플랫폼 전체 거래량 KPI, 신규 가입 추세 |
| Tenant 목록 | `/platform/tenants` | 테이블: code, name, status, region, 활성 사용자, 오늘 거래 건수, 액션(설정 보기, 정지/활성화) |
| Tenant 등록 | `/platform/tenants/new` | 폼: code, name, region, 연락처, 초기 Admin 초청 |
| Tenant 상세 | `/platform/tenants/{code}` | Tenant 메타 + 설정 보기(읽기 전용) + Membership 목록 + 감사 로그 |
| 글로벌 사용자 | `/platform/users` | 사용자 검색, 글로벌 정지, 다중 소속 확인 |
| 통계 | `/platform/stats` | Tenant 간 비교 (거래량, 활성 사용자, 정산 상태) |

### 4. 수협 설정 페이지

수협 Admin 전용. `03-tenant-lifecycle.md` 의 설정 항목을 편집.

| 페이지 | 경로 | 주요 요소 |
|--------|------|----------|
| 설정 메인 | `/t/{code}/settings` | 좌측 탭: 일반, 경매 정책, 단위 환산, 수수료, 알림, 회계 연동, 사용자 관리 |
| 사용자 관리 | `/t/{code}/settings/members` | Membership 테이블: 역할별 필터, 면허번호, 상태, 초청 버튼 |

## 기존 Mockup 화면 변경점 (구현 단계에서 적용)

> 본 문서는 **변경 계획**이며, 현재 mockup 파일은 수정하지 않는다. 구현 단계에서 반영.

### 운영자 (`docs/operator/*.html` 계열)

| 위치 | 변경 |
|------|------|
| 사이드바 상단 브랜드 | `🐟 MANSUN` 옆에 `· 강구항 수협` 같은 현재 Tenant 라벨 추가 + 다중 소속자는 ▾ 드롭다운 |
| 사이드바 메뉴 | "수협 설정" 메뉴 항목 추가 (admin 역할만 표시) |
| 사이드바 하단 사용자 표시 | `김운영 / 운영자` → `김운영 / 강구항 수협 · 운영자` 로 Tenant 명시 |
| 모든 데이터 리스트 | 자동으로 active tenant 한정 — API 자체가 필터링하므로 UI 변경은 거의 없음 |
| 정산 페이지 수수료 표시 | Tenant 설정의 `fee_policy` 를 읽어 동적으로 적용 (현재 mockup의 하드코딩된 4%, 1.5%) |
| 개찰 페이지 동일가 처리 | Tenant 설정의 `tie_break_policy` 에 따라 안내 문구 변경 |

### 중매인 (`docs/broker/*.html` 계열)

| 위치 | 변경 |
|------|------|
| 모바일 헤더 | 사용자 라벨(`김중매 · M-201`) 아래 또는 옆에 **Tenant 칩** 추가 (`강구항 ▾`) |
| 경매 목록 카드 | 카드 자체는 한 Tenant 내 목록이므로 변경 없음. 단, 카드 상단에 작은 Tenant 표시(다중 소속자 혼동 방지용) |
| 입찰 화면 마감 시각 | Tenant 시간대 기준 표시. (실제 마감은 서버 UTC 기준 처리 — 표시만 Tenant 로케일) |
| 내 입찰 결과 화면 | "오늘의 낙찰" 카드는 active tenant 한정. 다중 소속자는 다른 Tenant 결과 보려면 전환 |

### 로그인 화면 (`docs/index.html`)

| 위치 | 변경 |
|------|------|
| 역할 선택 카드 | 역할 선택 UX 제거. 단일 로그인 → 소속 Tenant 자동 라우팅으로 변경 |
| 다중 소속자 | 로그인 성공 시 수협 선택 화면으로 이동 |
| Platform Admin | "Platform" 옵션이 수협 선택 화면에 함께 표시 |

> **Mockup 단계의 "역할로 로그인"은 학습용 UI 진입점이었고, 실제 시스템에선 사용자 계정 자체에 역할이 매핑되므로 역할 선택은 사라진다.**

## URL 라우팅 권고

### 권고: Path 기반 `/t/{tenant_code}/...`

```
/                              로그인
/select-tenant                 수협 선택 (다중 소속자)
/platform                      Platform Console (Platform Admin)
/platform/tenants              Tenant 목록
/platform/tenants/new
/platform/tenants/{code}
/t/{code}                      Tenant 대시보드 (역할에 따라 다른 기본 페이지)
/t/{code}/operator/dashboard
/t/{code}/operator/intake
/t/{code}/operator/notice
/t/{code}/operator/results
/t/{code}/operator/settlement
/t/{code}/operator/settings    수협 설정 (admin만)
/t/{code}/broker/auctions
/t/{code}/broker/bid/{auction_id}
/t/{code}/broker/results
```

**장점**
- 도메인 인증서 1개로 충분 (`mansun.kr` 단일)
- URL만 보고 어느 수협 데이터인지 명확
- 북마크/공유 가능
- 라우팅 미들웨어로 `code` → `active_tenant_id` 검증 단순화

**서브도메인 옵션 (`{code}.mansun.kr`) 비교**
- 장점: 시각적 분리, Tenant별 커스텀 도메인 확장 용이
- 단점: 인증서 와일드카드 필요, CORS·세션 쿠키 도메인 설정 복잡
- 본 단계에서는 도입 안 함. 향후 Enterprise Tier에서 옵션으로 고려

### 라우팅 가드

- `/t/{code}/...` 접근 시:
  1. `code` 유효성 검증 (`tenants.code` 조회)
  2. 세션의 `active_tenant_id` 와 `tenants.id` 일치 확인 — 다르면 자동 `active_tenant_id` 갱신 (소속자만, 비소속자는 404)
  3. Tenant 상태가 `suspended`/`archived` 면 읽기 전용 모드 + 배너
- `/platform/...` 접근 시: `is_platform_admin` 만 통과

## 공통 컴포넌트 (구현 시 추출)

| 컴포넌트 | 역할 |
|----------|------|
| `<TenantSwitcher>` | 현재 Tenant 표시 + 전환 드롭다운 |
| `<TenantStatusBanner>` | suspended/archived 경고 배너 (모든 페이지 상단) |
| `<PermissionGate>` | 역할별 조건부 렌더링 (예: 운영자 메뉴) |
| `<AuditLogTable>` | 감사 로그 표시 — Tenant 상세, 수협 설정 변경 이력 등에 재사용 |

---

**결정**:
- 신규 화면 4종 (수협 선택, 전환 드롭다운, Platform Console, 수협 설정)
- URL: Path 기반 `/t/{code}/...` 채택
- mockup의 "역할로 로그인" 폐기 → 계정-역할 매핑 기반

**Open**:
- 다중 소속자가 자주 전환할 때의 UX (즐겨찾기 Tenant 등 편의 기능)
- 모바일에서 Tenant 전환 시의 화면 전환 애니메이션
- 서브도메인 옵션의 Enterprise Tier 도입 시점
