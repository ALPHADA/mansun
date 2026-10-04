# API v1

기본 경로 `/api/v1`. JSON 응답, 세션 쿠키 `mansun_session` 사용. 변경 요청은 `Content-Type: application/json`과 배포 주소에 일치하는 `Origin`이 필요합니다. 응답은 `private, no-store`입니다. 오류 형식은 `{ "error": "사용자 안내" }`이며 상태 코드 400/401/403/404/413/429/503을 구분합니다.

## 조회

| 경로               | 내용                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| GET /me            | 내 회원 정보 또는 null                                                          |
| GET /taxonomy      | 활성 지역·어종                                                                  |
| GET /listings      | 지역·어종·상태·검색어·페이지별 상품 (`region`, `species`, `state`, `q`, `page`) |
| GET /listings/:id  | 상품 상세. 비로그인 가격·연락처·인수 위치 제거                                  |
| GET /brokers/:id   | 중매인 소개. 비로그인 연락처 제거                                        |
| GET /requests      | 로그인 회원용 매입 요청                                                         |
| GET /storage       | 보관업체 소개. 비로그인 연락처·상세 주소 제거                                   |
| GET /market        | 로그인 회원용 등록·공식 시세 (`day=YYYY-MM-DD`, `region`)                       |
| GET /notifications | 내 알림 100개                                                                   |
| GET /api/health    | 웹·DB 연결 상태 (v1 밖)                                                         |

## 인증

- `POST /auth/request`: `{phone}` → `{challengeId}`. 번호별 60초 간격·일 10회, 서비스 전체 일 500회 제한. 5분 만료, 코드 해시 저장.
- `POST /auth/verify`: `{challengeId, code, signup?}`. 기존 회원은 세션 발급, 신규 회원은 `{needsSignup:true}` 후 동일 challenge에 가입 정보를 추가. 실패 5회 제한, 성공한 challenge 재사용 불가.
- `signup`: `{role, consent:true, profile}`. 역할은 `broker|buyer|storage`, 필드는 `src/lib/model.ts`의 스키마가 기준입니다.
- `POST /auth/logout`: 세션 폐기·쿠키 제거.

로컬 개발 미리보기의 `developmentCode`는 운영 환경이나 공개 도메인에서는 반환하지 않습니다. 시연 로그인 전용 공개 엔드포인트는 없습니다.

## 회원 기능

- `POST /profile`: 프로필·관심 조건·알림 설정. 직접 입력한 연락처를 바꿀 때 다른 회원이 쓰는 번호면 409.
- `POST /upload`: multipart `file`, 중매인만. 최대 10MB, 최대 일 100장. 이미지 디코딩 후 최대 1600px WebP로 재인코딩하고 메타데이터 제거.
- `POST /listings`: 상품 스키마. `id`가 있으면 본인 활성 상품 수정. 본인 업로드 사진과 `confirmed:true` 필수.
- `POST /listings/close`: `{id}`.
- `POST /requests`: 매입 요청 스키마. 매입회원만 가능.
- `POST /requests/close`: `{id}`.
- `POST /storage`: 보관업체 소개. 회원당 하나를 생성/수정. `species`는 어종 이름 배열(1개 이상).
- `POST /taxonomy/species`: `{name}`. 로그인 회원이 목록에 없는 어종을 추가하고 `{name}`(공백 정리된 이름)을 받습니다. 한글·영문·숫자만, 회원당 하루 20개, 운영자가 숨긴 이름은 409. 상품·매입 요청·프로필(주요 취급 어종, 관심 어종)·보관업체의 어종은 모두 활성 어종 목록에 있어야 하며 아니면 400.
- `POST /favorites`: `{id}` → `{saved:boolean}`.
- `POST /notifications/read`: `{id?}`. 미지정 시 내 알림 모두 읽음.
- `POST /reports`: `{kind,id,reason}`. `kind=listing|request|storage|broker`, 사유 5자 이상, 일 10회 제한.
- `POST /activity`: `{kind:"visit"|"contact",target?}`. 방문은 회원별 일 1건.

## 운영자

`POST /admin/member`, `/admin/content`, `/admin/report`, `/admin/taxonomy`, `/admin/official`은 모두 서버에서 운영자 권한을 검사하고 성공한 작업을 트랜잭션 안에서 감사 기록으로 저장합니다. 클라이언트가 제출한 역할·관리자 표시는 권한 근거로 사용하지 않습니다.

네이티브 앱은 이 서비스 계층을 재사용할 수 있지만, 앱용 인증 전달·Origin 정책과 푸시 알림은 별도 도입 대상입니다.

## 카카오 로그인
- `GET /api/auth/kakao?next=/market`: 카카오 인가 화면으로 이동. 10분짜리 일회용 state를 서버와 HttpOnly 쿠키로 대조합니다.
- `GET /api/auth/kakao/callback`: 인가 코드 교환 및 카카오 회원번호 확인. 기존 회원은 로그인, 새 회원은 `/signup/kakao`로 이동합니다.
- `POST /api/v1/auth/kakao/signup`: 카카오 인증 후 30분 이내 역할·프로필·약관 동의 입력. 기존 signupSchema를 사용합니다. Origin 검증과 일회용 가입 쿠키가 필요합니다.
- 카카오 ID는 서버에서만 확인합니다. 브라우저에서 보내는 ID, 이메일 또는 업무 연락처로 기존 계정을 연결하지 않습니다. 카카오 회원이 직접 입력한 업무 연락처는 SMS 로그인 번호와 별개입니다.
- 카카오 토큰은 사용자 확인 요청에만 사용하고 DB/브라우저/로그에 저장하지 않습니다.
