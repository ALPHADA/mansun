<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 코드 리뷰 절차

이 저장소에서 코드를 바꾸는 모든 작업에 적용한다. 작업자가 Codex든 Claude든 같다. 대상은 `src/`, `scripts/`, `tests/`, `e2e/`, SQL, 설정 파일의 변경이고, 문서만 바꾸는 작업은 제외한다.

1. **구현**: 작업을 끝내고 타입 체크(`pnpm exec tsc --noEmit`), 린트(`pnpm lint`), 관련 테스트를 통과시킨다. 아직 커밋하지 않는다.
2. **리뷰 요청**: 커밋되지 않은 변경을 codex 리뷰어와 claude 리뷰어에게 각각 한 번씩, 동시에 맡긴다. 리뷰어는 작업자와 별도의 새 컨텍스트여야 한다.
   - Claude가 작업자일 때: 서브에이전트 `review-codex`와 `review-claude`(`.claude/agents/`)를 함께 호출한다.
   - Codex가 작업자일 때: codex 리뷰어는 자체 서브에이전트 또는 `scripts/review.sh codex`, claude 리뷰어는 `scripts/review.sh claude`로 실행한다.
   - 두 리뷰어 모두 `scripts/review-prompt.md`의 지침과 출력 형식을 따른다. 작업 설명과 이전 회차에서 기각한 지적을 함께 전달한다.
3. **검증**: 지적을 그대로 받아들이지 않는다. 작업자가 지적마다 해당 코드를 읽거나 재현해서 사실인지 확인하고, 맞으면 고치고 틀리면 사유를 적어 기각한다. 리뷰어 둘의 의견이 갈리면 작업자가 코드로 확인해 정한다.
4. **반복**: blocker나 major 지적을 반영해 코드를 고쳤으면 1의 검사를 다시 통과시키고 다음 회차 리뷰를 받는다. 리뷰는 최대 3회다. 두 리뷰어가 모두 APPROVE한 뒤 minor만 반영한 경우에는 1의 검사만 다시 통과시키고 추가 리뷰 없이 5로 간다.
5. **커밋**: 두 리뷰어가 모두 `VERDICT: APPROVE`이거나 남은 지적을 전부 사유와 함께 기각했으면 머지해도 되는 상태다. 사용자에게 묻지 않고 현재 브랜치에 커밋하고 다음 작업으로 넘어간다. 커밋 메시지 본문에 리뷰 회차 수와 기각한 지적을 한 줄씩 적는다. 푸시와 서버 배포는 사용자가 요청할 때만 한다.
6. **3회 뒤에도 미해결이면**: 지금까지의 현황(회차별 지적, 반영한 것, 기각한 것과 사유, 남은 쟁점)을 정리해 사용자에게 보여 주고, 그 정리를 리뷰어에게도 전달해 최대 2회 더 리뷰받는다. 총 5회 뒤에도 blocker나 major가 남으면 커밋하지 말고 멈춰서 사용자에게 결정을 요청한다.

리뷰어 한쪽을 실행할 수 없거나(CLI 미설치, 인증 만료, 시간 초과 등) 결과가 `VERDICT: UNAVAILABLE`이면 승인으로 치지 않는다. 다른 리뷰어만으로 진행하지 말고 사용자에게 알린다.

리뷰어 CLI는 네트워크와 홈 디렉터리의 인증 정보가 필요하다. 작업자가 샌드박스 안에서 실행 중이면 `scripts/review.sh`는 샌드박스 밖에서 실행되도록 승인을 받아 실행한다.
