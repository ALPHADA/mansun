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

`mansun-market-web`, `mansun-market-jobs`, `mansun-market-tunnel`, `mansun-market-backup` 프로세스가 별도로 실행됩니다. 새 배포는 코드 동기화·빌드 후 해당 이름의 프로세스만 재시작하세요.

## 공개 주소

최초 확인한 공개 주소: https://plastic-motorola-physical-hands.trycloudflare.com (재시작 시 변경 가능).

터널은 `scripts/quick-tunnel.yml`만 사용하므로 서버의 기존 `.cloudflared/config.yml`과 분리됩니다.

터널 프로세스가 만든 주소는 `/Users/dana/srv/data/mansun-market/public-origin`에 저장됩니다. 재시작 시 주소가 바뀔 수 있습니다. 웹은 이 파일을 읽어 같은 출처 검사와 상품 문자 링크에 반영합니다. 터널은 웹 3005 포트만 공개합니다. DB 5432는 로컬에 남습니다.

```sh
cat /Users/dana/srv/data/mansun-market/public-origin
pm2 logs mansun-market-web --lines 40 --nostream
pm2 logs mansun-market-jobs --lines 40 --nostream
```

임시 주소는 테스트용입니다. 안정적인 초대 링크가 필요해지면 고정 도메인과 정식 터널로 전환하고 `APP_ORIGIN`을 설정한 뒤 `PUBLIC_ORIGIN_FILE`을 비웁니다. 고정 도메인은 `pungeo.com`으로 정했습니다(2026-10-04 기준 미등록 확인, 구매·연결 전).

## 실제 가입 활성화

서버 `.env`에 문자 발송 제공사의 `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, 확인된 발신번호 `SOLAPI_FROM`과 운영 주체 `SERVICE_OPERATOR_NAME`, 공개 문의 연락처 `SERVICE_OPERATOR_CONTACT`를 설정하고 웹을 재시작합니다. API 키는 채팅·저장소·로그에 남기지 않습니다. 실제 계정으로 소량 인증 발송을 검증한 뒤 현장 참여자를 초대합니다.

최초 운영자는 가입 완료 후 `pnpm admin:grant 실제휴대폰번호`로 부여합니다. 그 뒤 웹 운영 관리에서 중매인을 승인합니다. 웹 가입으로 운영자 권한을 생성할 수 없습니다.

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

카카오에 등록할 Redirect URI는 공개 주소 + `/api/auth/kakao/callback`입니다. 임시 터널이 재시작되어 주소가 변경되면 카카오 Redirect URI 및 대표 도메인을 다시 등록해야 합니다. 운영용 고정 도메인으로 전환하는 것이 좋습니다. 로컬 검증 주소는 `http://localhost:3005/api/auth/kakao/callback`입니다.

기존 DB에는 `pnpm db:migrate`를 실행합니다. 카카오 계정 연결 테이블과 일회용 인증/가입 테이블을 추가하고, SMS 인증 번호 필드를 nullable로 바꿉니다. 기존 회원과 데이터는 보존합니다. 회원 연락처만 같아도 자동 병합하지 않으며 기존 SMS 계정과의 연결은 별도 검증 절차 없이 지원하지 않습니다.

카카오 가입자는 업무 연락처를 직접 입력합니다. 중매인은 기존과 동일하게 운영자 승인 후 판매할 수 있습니다. 카카오 로그인 연결과 카카오톡 메시지 발송은 별개이며, 알림은 계속 웹 내부에서만 제공합니다.


### 연결 완료 기록 (2026-10-04)
- 카카오 앱: 만선(등록 당시 이름. 콘솔에서 풍어로 변경 필요), 앱 ID `1596957`, 회사명 `withD`
- 공개 운영 문의: `coding199103@gmail.com`
- 카카오 로그인 ON, OpenID Connect OFF, 추가 개인정보 동의 없음
- 공개 콜백 등록 및 실제 카카오 인증 → 신규 회원 정보 화면 이동 확인
- 카카오 회원 운영자 부여: 가입 후 회원 UUID를 확인하여 `pnpm admin:grant --user-id 회원UUID` 실행. 직접 입력한 업무 연락처로 계정을 선택하지 않습니다.
- 공개 주소가 카카오 대표 도메인 필드의 50자 제한을 넘어서 선택 항목인 대표 도메인은 비워두었습니다. 로그인 콜백 URI는 전체 주소로 정상 등록했습니다.
