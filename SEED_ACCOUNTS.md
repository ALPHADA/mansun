# 시드 계정 · 비밀번호 · 접속 정보 (개발용)

> ⚠️ 개발/시연 전용 값입니다. 운영 배포 전 반드시 변경하세요. 변경 위치는 각 절 끝에 표기.

## 1. 애플리케이션 로그인 계정

**공통 비밀번호: `mansun1234`** (로그인 화면 `/login`, 이메일 또는 전화번호로 로그인)

### Platform (MANSUN 운영)
| 이메일 | 전화 | 이름 | 권한 | 진입 화면 |
|---|---|---|---|---|
| platform@mansun.kr | 010-0000-0001 | MANSUN 운영팀 | Platform Admin | `/platform` |

### 강구항 수협 (`gangu`, 운영중 · 현장 호가 병행 Phase 2 · 동일가 선착순 · 수수료 4% / 1.5%)
| 이메일 | 전화 | 이름 | 역할 | 비고 |
|---|---|---|---|---|
| admin@gangu.kr | 010-0000-0002 | 정관리 | 수협 Admin | 위판과장 · 설정/멤버/면허 |
| operator@gangu.kr | 010-0000-0003 | 김운영 | 운영자 + 입고담당 | 입고·공지·개찰·정산 |
| receiver@gangu.kr | 010-0000-0004 | 한입고 | 입고담당 | 모바일 현장 입고 |
| broker@gangu.kr | 010-0000-0005 | 김중매 | 중매인 M-201 | **포항 수협 B-340 도 보유(다중 소속)** |
| lee@gangu.kr | 010-0000-0006 | 이상철 | 중매인 M-205 | 면허가 시드 후 5일 뒤 만료(알림 시연) |
| park@gangu.kr | 010-0000-0007 | 박철수 | 중매인 M-218 | |
| choi@gangu.kr | 010-0000-0008 | 최영수 | 중매인 M-302 | |
| shipper1@gangu.kr | 010-0000-0011 | 박성진 | 선주 | 제3만선호 · 포항에도 선주 소속 |
| shipper2@gangu.kr | 010-0000-0012 | 이상철(선주) | 선주 | 동해호 |
| shipper3@gangu.kr | 010-0000-0013 | 최영수(선주) | 선주 | 백호1호 |
| shipper4@gangu.kr | 010-0000-0014 | 김영길 | 선주 | 해랑호 |
| union@gangu.kr | 010-0000-0021 | 노조담당 | 노조 | 작업조 1반 |

### 포항 수협 (`pohang`, 운영중 · 디지털 단독 · 동일가 추첨 · 수수료 3.5% / 2%)
| 이메일 | 전화 | 이름 | 역할 |
|---|---|---|---|
| admin@pohang.kr | 010-0000-0031 | 포항관리 | 수협 Admin |
| operator@pohang.kr | 010-0000-0032 | 이운영 | 운영자 + 입고담당 |
| broker@gangu.kr | — | 김중매 | 중매인 B-340 (강구 계정과 동일 User) |
| shipper1@gangu.kr | — | 박성진 | 선주 (포항1호) |

### 통영 수협 (`tongyeong`, 준비중 `pending`)
계정 없음 — Platform Console에서 초기 Admin 초청 흐름 시연용.

**변경 방법**: `src/db/seed.ts` 의 `pw` (bcrypt 해시 원문) 와 `mk(...)` 호출부를 수정 후 `pnpm db:reset`. 운영에서는 시드를 쓰지 않고 Platform Console → Tenant 등록 → 초청 메일 흐름으로 계정을 만든다.

## 2. 개발 편의 경로 (프로덕션 자동 비활성)
| 경로 | 용도 |
|---|---|
| `GET /api/dev/login?email=<이메일>&tenant=<code>&role=<role>&next=<path>` | 비밀번호 없이 세션 발급 |
| `POST /api/internal/tick` | 스케줄러 즉시 실행 (개발: 누구나 / 운영: `INTERNAL_TOKEN` 헤더 또는 운영자 세션) |
| OTP 코드 | 개발 환경에서는 항상 `000000` (`SHOW_DEV_OTP=true` 면 화면에도 표시) |

## 3. 데이터베이스 (`scripts/db-setup.sh`, `.env`)
| 항목 | 값 |
|---|---|
| DB | `mansun` @ localhost:5432 |
| 소유자 롤 (마이그레이션·시드) | `mansun_owner` / `mansun_owner` → `DATABASE_OWNER_URL` |
| 앱 롤 (RLS 적용, 비-superuser) | `mansun_app` / `mansun_app` → `DATABASE_URL` |

**변경 방법**: `OWNER_PW=... APP_PW=... bash scripts/db-setup.sh` 로 생성하거나 `ALTER ROLE ... PASSWORD` 후 `.env` 의 URL 갱신.

## 4. 비밀 키
| 변수 | 개발 기본값 | 설명 |
|---|---|---|
| `SESSION_SECRET` | `.env.example` 의 dev 문자열 | JWT 서명 키. 32자 이상 랜덤 값으로 교체(교체 시 전원 재로그인) |
| `INTERNAL_TOKEN` | (미설정) | 운영에서 `/api/internal/tick` 호출용 |

## 5. 시드 데이터 요약
- 어종 12종(공유 마스터), 선박 5척, 강구 오늘 회차 1(시드 시점 +40분 마감, 입찰중) · 회차 2(+3시간), 입고 4건 / 경매 물품 14건(A01~A14), 입찰 12건(김중매·박철수·최영수·이상철), 광어 예가 15,000원.
- 포항은 회차/입고 없음(다중 소속 전환 시연용).
