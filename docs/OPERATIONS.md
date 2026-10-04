# 운영·백업·복원

## 분리 배포

- 서버: `ssh dana@100.127.129.79` (Tailscale: macmini)
- 새 경로: `/Users/dana/srv/mansun-market`
- 새 DB/앱 DB 역할: `mansun_market` / `mansun_market_app`
- 웹: `127.0.0.1:3005`
- 영구 데이터: `/Users/dana/srv/data/mansun-market`
- 기존 `/Users/dana/srv/mansun`, DB `mansun`, PM2 `mansun-web`은 유지합니다.

초기 배포에서는 개발·시연 데이터와 개발 인증 우회를 복사하지 않습니다. 환경 파일은 서버에만 있고 권한은 0600입니다.

```sh
cd /Users/dana/srv/mansun-market
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm build
pm2 start ecosystem.config.cjs
pm2 save
```

`mansun-market-web`, `mansun-market-jobs`, `mansun-market-backup` 프로세스가 별도로 실행됩니다. 새 배포는 코드 동기화·빌드 후 해당 이름의 프로세스만 재시작하세요.

## 공개 주소

공개 주소는 https://pungeo.com 입니다 (2026-10-04 전환). `www.pungeo.com`은 `next.config.ts`의 리다이렉트로 본 도메인에 308 이동합니다.

- 도메인: 가비아 등록(만기 2027-10-04), 네임서버는 Cloudflare(`ben.ns.cloudflare.com`, `rihana.ns.cloudflare.com`)
- Cloudflare: Free 플랜. `pungeo.com`, `www` 모두 `macmini` 터널(`a18845ef-9cf0-49bf-b494-c1e75aa60e35.cfargotunnel.com`)로 향하는 프록시 CNAME
- 서버: 다른 사이트와 함께 쓰는 `~/.cloudflared/config.yml`에 두 호스트 → `http://127.0.0.1:3005` 규칙. 터널은 root LaunchDaemon이라 규칙을 바꾸면 `sudo launchctl kickstart -k system/com.cloudflare.cloudflared`로 재시작해야 하고, 그동안 같은 터널의 다른 사이트도 잠깐 끊깁니다.
- 서버 `.env`: `APP_ORIGIN=https://pungeo.com`, `PUBLIC_ORIGIN_FILE=`(비움). 웹은 이 값으로 같은 출처 검사와 상품 문자 링크를 만듭니다. DB 5432는 로컬에 남습니다.

임시 trycloudflare 터널(`mansun-market-tunnel`)은 종료했고 `ecosystem.config.cjs`에서 뺐습니다. `scripts/tunnel.mjs`, `scripts/quick-tunnel.yml`은 임시 주소가 다시 필요할 때를 위해 남겨 두었습니다.

```sh
pm2 logs mansun-market-web --lines 40 --nostream
pm2 logs mansun-market-jobs --lines 40 --nostream
```

## 실제 가입 활성화

서버 `.env`에 문자 발송 제공사의 `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, 확인된 발신번호 `SOLAPI_FROM`과 운영 주체 `SERVICE_OPERATOR_NAME`, 공개 문의 연락처 `SERVICE_OPERATOR_CONTACT`를 설정하고 웹을 재시작합니다. API 키는 채팅·저장소·로그에 남기지 않습니다. 실제 계정으로 소량 인증 발송을 검증한 뒤 현장 참여자를 초대합니다.

최초 운영자는 가입 완료 후 `pnpm admin:grant 실제휴대폰번호`로 부여합니다. 중매인 사전 승인은 없고, 문제가 있는 계정은 웹 운영 관리에서 이용 정지합니다. 웹 가입으로 운영자 권한을 생성할 수 없습니다.

## 정기 작업과 보관

작업 프로세스가 1분마다 알림 요약과 과거 일별 집계 누락분을 처리합니다. 알림은 회원·날짜 고유 키로 중복 생성되지 않습니다. 집계와 알림 생성은 PostgreSQL advisory lock으로 중복 실행을 직렬화합니다.

백업 프로세스는 시작 시 한 번, 이후 서버 시각 오전 4시에 DB 덤프와 업로드 압축을 만듭니다. `/Users/dana/srv/backups/mansun-market`에 저장하며 자동 삭제는 하지 않습니다. 주기적으로 별도 장치에도 복사하고 용량을 점검하세요. 각 백업에 DB 아카이브 목록 검증과 복원 안내가 포함됩니다.

## 기존 프로젝트 보존

- 로컬 소스·환경·업로드·Git 보존: `/Users/dayoungchoi/Desktop/private/mansun-backups/20261004-131916/project.tar.gz`
- 파일별 SHA-256: 같은 폴더 `manifest.json` (812개 파일을 아카이브와 대조)
- 기존 로컬 DB: 같은 폴더 `database.dump` (독립 임시 DB에 복원 후 검증 완료)
- 이전 작업 파일: 같은 폴더 `working-copy/`
- 기존 서버 소스·DB: `/Users/dana/srv/backups/mansun-legacy-20261004-140232/`

기존 DB로 복원하지 말고 별도 빈 디렉터리·DB에서 확인합니다. 소스에는 비밀 설정이 포함되므로 백업을 웹 공개 폴더나 Git에 넣지 않습니다.

```sh
# 예: 새 서비스 백업 검증. 실제 백업 경로를 지정하세요.
createdb mansun_market_restore
pg_restore --no-owner --no-acl -d mansun_market_restore /private/backup/database.dump
# uploads.tar.gz는 복원 환경의 별도 UPLOAD_DIR에 풉니다.
```

## 장애 확인

`/api/health`가 200이면 웹·DB 연결이 정상입니다. 로그인만 준비 중이면 카카오 키·운영자 환경 설정을 확인합니다. 이미지 오류는 UPLOAD_DIR 권한과 파일 보존 여부를, 알림 누락은 작업 프로세스 로그와 관심 조건·요약 시각을 확인합니다. 새 버전 롤백 시 코드와 DB 변경 내용을 함께 검토하고 기존 수협용 DB를 연결하지 않습니다.

## 카카오 로그인 설정
카카오디벨로퍼스에서 풍어 앱을 생성하고 카카오 로그인을 활성화합니다. REST API 키와 클라이언트 시크릿을 서버 `.env`의 `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`에 저장합니다. JavaScript 키와 Admin 키는 필요하지 않습니다. 추가 개인정보 동의 항목은 사용하지 않습니다.

카카오에 등록할 Redirect URI는 공개 주소 + `/api/auth/kakao/callback`입니다. 운영 값은 `https://pungeo.com/api/auth/kakao/callback`입니다. 로컬 검증 주소는 `http://localhost:3005/api/auth/kakao/callback`입니다.

기존 DB에는 `pnpm db:migrate`를 실행합니다. 카카오 계정 연결 테이블과 일회용 인증/가입 테이블을 추가하고, SMS 인증 번호 필드를 nullable로 바꿉니다. 기존 회원과 데이터는 보존합니다. 회원 연락처만 같아도 자동 병합하지 않으며 기존 SMS 계정과의 연결은 별도 검증 절차 없이 지원하지 않습니다.

카카오 가입자는 업무 연락처를 직접 입력합니다. 연락처는 형식과 가짜 번호 여부, 다른 회원과의 중복만 검사하며 번호 소유는 확인하지 않습니다(소유 확인은 문자 인증 설정 후 가능). "이미 다른 회원이 사용 중인 연락처" 문의가 오면 운영 관리에서 그 번호를 먼저 적은 계정을 확인해 이용 정지합니다. 정지된 계정이 직접 입력한 연락처는 점유로 치지 않으므로 정지 후에는 실제 주인이 그 번호로 가입·변경할 수 있고, 그 뒤에는 선점 계정의 정지를 해제할 수 없습니다. 문자 인증 가입자가 같은 번호를 직접 입력해 둔 계정과 겹치면 운영 이력에 `contact.conflict`(대상: 해당 번호)가 남고 그 회원에게 수정 안내 알림이 갑니다. 중매인은 가입 즉시 판매할 수 있습니다. 카카오 로그인 연결과 카카오톡 메시지 발송은 별개이며, 알림은 계속 웹 내부에서만 제공합니다.


### 연결 완료 기록 (2026-10-04)
- 카카오 앱: 풍어(2026-10-04 만선에서 변경), 대표 도메인 `https://pungeo.com`, 앱 ID `1596957`, 회사명 `withD`
- 공개 운영 문의: `coding199103@gmail.com`
- 카카오 로그인 ON, OpenID Connect OFF, 추가 개인정보 동의 없음
- 공개 콜백 등록 및 실제 카카오 인증 → 신규 회원 정보 화면 이동 확인 (임시 주소 기준. `pungeo.com` 콜백으로 바꾼 뒤의 실제 로그인은 재확인 필요)
- 카카오 회원 운영자 부여: 가입 후 회원 UUID를 확인하여 `pnpm admin:grant --user-id 회원UUID` 실행. 직접 입력한 업무 연락처로 계정을 선택하지 않습니다.
- 공개 주소가 카카오 대표 도메인 필드의 50자 제한을 넘어서 선택 항목인 대표 도메인은 비워두었습니다. 로그인 콜백 URI는 전체 주소로 정상 등록했습니다.

## 공식 시세 자동 수집

공식 위판·KAMIS·중매인 판매가는 `/market` 탭으로 구분한다. 가격은 기존 정책대로 로그인 후 제공하며, 공식 자료는 `official_observations`에 별도로 저장한다. 기존 운영자 확인 자료(`official_prices`)는 중매인 탭 아래 참고자료로 유지한다.

1. `pnpm db:migrate`로 수집 테이블을 추가한다(기존 자료 삭제 없음).
2. 공공데이터포털에서 [위판 집계](https://www.data.go.kr/data/15059417/openapi.do)와 [위판장 위치](https://www.data.go.kr/data/15056511/openapi.do) API를 모두 활용 신청한다. 발급 키를 서버 `.env`의 `MOF_SERVICE_KEY`에 설정한다.
3. [KAMIS Open API](https://www.kamis.or.kr/customer/reference/openapi_list.do)에서 발급받은 ID·키를 `KAMIS_CERT_ID`, `KAMIS_CERT_KEY`로 설정한다. 공개 환경변수로 설정하지 않는다.
4. `pnpm prices:sync`로 최근 3일을 수집한다. 특정 기간은 `pnpm prices:sync 2026-09-30 30 mof`처럼 종료일·일수(최대 31일)·제공처를 지정한다. 인증 미설정/오류 시 종료코드 1이다.
5. 기존 PM2 `scripts/worker.ts` 반복 실행과 수동 `pnpm jobs` 모두 수집을 실행한다. 최근 3일을 공급자·날짜별 최대 4시간에 한 번 재조회한다. `pnpm prices:sync`는 간격 제한을 건너뛴다(`pnpm jobs`는 제한 적용). `/admin`에서 설정 유무·기준일·건수·성공/오류를 확인한다.

수집은 요청당 20초·제공처/날짜당 전체 60초 제한, MOF 최대 100페이지, 공급자/날짜별 동시 실행 잠금, 전체 페이지 검증 후 트랜잭션 반영을 적용한다. API 오류/비정상 가격/날짜 불일치/중복 식별자는 전체 날짜 반영을 취소하고 기존 자료를 보존한다. 빈 응답도 기존 자료를 삭제하지 않는다. KAMIS에 이미 저장된 도매/소매 단계 중 한쪽만 누락되면 해당 날짜 전체 갱신을 보류한다. 특정 날짜 오류는 다른 날짜 수집을 막지 않는다. 운영자 강제 정정·삭제는 별도 절차가 필요하다.

화면은 선택일 자료만 표시한다. 없으면 해당 검색 조건의 가장 최근 기준일 링크를 제공하고, 날짜를 오늘로 바꿔 표시하지 않는다. 위판은 제공된 상태·규격·포장 단위를 유지한다. KAMIS는 1차 범위에서 전국 조사 평균만 제공하며 도매/소매를 구분하고 전일·전주 값이 없으면 등락을 계산하지 않는다.

인증 후 확인할 항목: 실제 최신 기준일과 제공 위판장 범위, 응답 형태, KAMIS 조사일의 휴일 처리, 같은 조건의 공식 화면 가격 대조. 인증키 없이 수행한 fixture 테스트는 실제 연동 성공을 의미하지 않는다. 일별 위판 물량은 가격 범위 API에 포함되지 않아 별도 위탁판매 원자료를 확인한 뒤 추가한다. 월간 CSV를 통한 장기 과거 이력과 지역별 KAMIS는 다음 단계로 둔다.

실응답 확인(2026-10-04): MOF는 `responseJson.header.totalCount`와 `responseJson.body.item`을 반환한다. 페이지당 100건으로 조회한다(200/999 요청은 빈 객체를 반환함). 최저·최고가 중 명시적 0이 포함된 행은 가격 미제공으로 제외한다(다른 값은 유효한 양수 또는 0이어야 함). 빈 값·음수·역전 범위 등 잘못된 가격은 계속 수집 오류로 처리한다. 화면에 0원 항목 제외를 안내한다. KAMIS 신청은 접수 중이며 키 발급 후 실자료 검증이 필요하다.
