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

`/api/health`가 200이면 웹·DB 연결이 정상입니다. 로그인만 준비 중이면 카카오 키·운영자 환경 설정을 확인합니다. 이미지 오류는 UPLOAD_DIR 권한과 파일 보존 여부를, 알림 누락은 작업 프로세스 로그와 관심 조건·요약 시각을 확인합니다. 새 버전 롤백 시 코드와 DB 변경 내용을 함께 검토하고 기존 수협용 DB를 연결하지 않습니다.

## 카카오 로그인 설정
카카오디벨로퍼스에서 풍어 앱을 생성하고 카카오 로그인을 활성화합니다. REST API 키와 클라이언트 시크릿을 서버 `.env`의 `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`에 저장합니다. JavaScript 키와 Admin 키는 필요하지 않습니다. 추가 개인정보 동의 항목은 사용하지 않습니다.

카카오에 등록할 Redirect URI는 공개 주소 + `/api/auth/kakao/callback`입니다. 운영 값은 `https://pungeo.com/api/auth/kakao/callback`입니다. 로컬 검증 주소는 `http://localhost:3005/api/auth/kakao/callback`입니다.

기존 DB에는 `pnpm db:migrate`를 실행합니다. 카카오 계정 연결 테이블과 일회용 인증/가입 테이블을 추가하고, SMS 인증 번호 필드를 nullable로 바꿉니다. 기존 회원과 데이터는 보존합니다. 회원 연락처만 같아도 자동 병합하지 않으며 기존 SMS 계정과의 연결은 별도 검증 절차 없이 지원하지 않습니다.

카카오 가입자는 업무 연락처를 직접 입력합니다. 중매인은 기존과 동일하게 운영자 승인 후 판매할 수 있습니다. 카카오 로그인 연결과 카카오톡 메시지 발송은 별개이며, 알림은 계속 웹 내부에서만 제공합니다.


### 연결 완료 기록 (2026-10-04)
- 카카오 앱: 풍어(2026-10-04 만선에서 변경), 대표 도메인 `https://pungeo.com`, 앱 ID `1596957`, 회사명 `withD`
- 공개 운영 문의: `coding199103@gmail.com`
- 카카오 로그인 ON, OpenID Connect OFF, 추가 개인정보 동의 없음
- 공개 콜백 등록 및 실제 카카오 인증 → 신규 회원 정보 화면 이동 확인 (임시 주소 기준. `pungeo.com` 콜백으로 바꾼 뒤의 실제 로그인은 재확인 필요)
- 카카오 회원 운영자 부여: 가입 후 회원 UUID를 확인하여 `pnpm admin:grant --user-id 회원UUID` 실행. 직접 입력한 업무 연락처로 계정을 선택하지 않습니다.
- 공개 주소가 카카오 대표 도메인 필드의 50자 제한을 넘어서 선택 항목인 대표 도메인은 비워두었습니다. 로그인 콜백 URI는 전체 주소로 정상 등록했습니다.
