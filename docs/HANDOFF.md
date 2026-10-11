# 인수인계 (2026-10-11)

클라우드 세션에서 하던 작업을 로컬로 넘기기 위한 정리입니다. 모든 작업은 `main`에 머지되어 있습니다.

- 최신 `main`: `2583cae` (Add a room list to the lobby, #27)
- 배포: GitHub Pages, `main` 머지 후 1~2분 → https://minglelabs.github.io/hash-rush/
- 남은 원격 브랜치: `codex/sweet-ritchie-2ttusu` (전부 머지됨, 지워도 됨)

## 1. 로컬에서 이어서 시작하기

```bash
cd ~/hash-rush
git checkout main && git pull          # 메인 폴더는 main으로 유지
npm run dev                            # http://localhost:5173
npm test                               # 시뮬레이션 테스트 24개, 약 2분

# 새 작업은 워크트리에서
git worktree add ../hash-rush-<작업명> -b <브랜치> origin/main
```

이전 로컬 세션에서 남은 뒷정리:

- 워크트리 `mobile-layout`, 로컬 브랜치 `feat/mobile-layout` 삭제 (`git worktree remove …`, `git branch -D feat/mobile-layout`)
- 켜져 있던 미리보기 서버 종료 (포트 5199 등)
- 원격 `codex/sweet-ritchie-2ttusu` 삭제 (선택)

## 2. 최근 작업 (PR 순)

| PR | 내용 |
| --- | --- |
| #14 | 방장 탭이 돌아오면 방 재등록 |
| #15 | 직접 연결이 막히면 ExpressTURN 중계 |
| #16 | 컴퓨터 기본 난이도 어려움 |
| #17 | 맵 축소(12×13칸), 세로 화면에서 컨트롤을 맵 아래로 |
| #18 | 🏠 터널 확대, 조이스틱 18px만 당겨도 최고속도, 모바일 HUD 확대, 모바일 소리 수정, iOS 확대 방지 |
| #19 | 조이스틱 중심을 화면 가장자리에서 90px 안쪽으로 |
| #20 | 손님 나가기 버튼 이름 "방 나가기", 재대결 대기 문구 |
| #21 | 최대 8명, "+ 자리 추가" 버튼, 연장전 집 범위 확대 |
| #22, #23 | 온라인 방 채팅, 탭 한 번 빠른 채팅 |
| #24, #25 | OG 이미지(링크 미리보기) |
| #26 | 채팅 기본 닫힘, 결과 화면에도 채팅 |
| #27 | 로비 방 목록(참가·관전), 공개 MQTT 브로커 사용 |

## 3. 바꾼 값과 위치

| 무엇 | 위치 | 값 |
| --- | --- | --- |
| 🏠 터널 크기 | `src/sim/map.js` `WARPS` | r 24 → 34 |
| 조이스틱 최고속도 거리 | `src/client/input.js` `STICK_FULL` | 18px (손잡이 이동 범위는 `STICK_RANGE` 46px) |
| 조이스틱 가장자리 여유 | `src/client/input.js` `STICK_EDGE` | 90px |
| 최대 인원 | `src/client/main.js` `MAX_SLOTS` | `LOOKS.length` = 8, 기본 4명 |
| 햄스터 외형 | `src/client/looks.js` | 8종 (5~8번 주황·청록·분홍·겨자) |
| 5명 이상 둥지 | `src/sim/map.js` `NEST_ARC_BIG` → `MAP.bigNests` | 넓은 호 8칸 |
| 연장전 집 한계 | `src/sim/game.js` `limit` | 해바라기 링 −20 → `flower.x` (판이 반드시 끝나게) |
| 세로 화면 HUD | `style.css` 맨 아래 `@media (orientation: portrait)` | 글씨·버튼 확대 |
| 이름표 크기 | `src/client/render.js` | 세로 화면 ×1.55 |
| 소리 켜기 | `src/client/audio.js` `unlock`, `main.js` `tryUnlock` | 탭마다 재시도, iOS 무음 스위치 대응 |
| 확대 방지 | `src/client/main.js` (gesture/touch 핸들러) | 핀치·더블탭 확대 차단 |
| 방 목록 | `src/client/net.js` `announceRoom` · `watchRooms` | 토픽 `minglelabs/hash-rush/v1/rooms/<방ID>` |
| OG 이미지 | `og.png`, 다시 만들기: `tools/og.html` + `node tools/og.mjs` | 1200×630 |

## 4. 외부 서비스

모두 무료 공개 서비스라서 장애가 나면 해당 기능만 멈춥니다.

- **PeerJS 공개 중계** (`0.peerjs.com`): 방 연결 시작. 스크립트 `peerjs@1.5.4` (unpkg)
- **ExpressTURN 무료 계정**: 직접 연결이 막힐 때 중계. 유럽 서버라 느림. 계정 정보는 `net.js`에 공개되어 있음
- **MQTT 공개 브로커** (`broker.emqx.io` → 실패 시 `broker.hivemq.com`): 방 목록. 스크립트 `mqtt@5.10.1` (unpkg)
  - 방마다 retained 메시지 하나, 방장 연결이 끊기면 last will로 자동 삭제
  - 1분마다 갱신, 3분 소식 없으면 목록에서 숨김
  - 누구나 가짜 방을 올릴 수 있음 (글자로만 표시해서 안전)
- **Google Fonts** (Fredoka, Jua): OG 이미지 생성 도구에서만 사용

## 5. 실기기에서 확인 못 한 것

- iOS 크롬/사파리에서 소리 (iOS 16 이하 무음 모드는 여전히 안 날 수 있음)
- iOS 핀치·더블탭 확대 방지, 꿀밤 광클
- 조이스틱을 왼쪽 끝에서 밀 때 느낌
- 5명 이상 온라인 대전
- **방 목록을 실제 공개 브로커로** (로컬 브로커로만 테스트함)
- 맵 축소 후 데스크톱 화면, 카톡 링크 미리보기 (카톡은 미리보기를 캐시함)

## 6. 알려진 자잘한 문제

- 8명일 때 휴대폰에서 상단 이름 칩 둘째 줄이 왼쪽 위 터널에 살짝 닿음
- 캐릭터가 붙어 있으면 이름표끼리 겹침
- OG 이미지에서 "Hash Rush"의 마지막 "h"가 꽃잎에 살짝 겹침
- 아주 빠르게 두 번 탭하면 두 번째 탭은 무시됨 (iOS 더블탭 확대 방지 때문)
- 연장전이 170초 넘게 가면 집이 해바라기 앞쪽 절반까지 덮음 (4명 판도 해당)

## 7. 테스트 팁

- `npm run sim -- 100 hard,hard,hard,hard`: 봇끼리 판 길이·승률 확인
- 8명 하드 봇은 연장전 확대 전에는 300초 넘게 안 끝났고, 지금은 약 180초 안에 끝남
- 방 목록 로컬 테스트: `npm i aedes ws mqtt`로 WebSocket MQTT 브로커를 띄우고, Playwright에서
  `wss://broker.emqx.io` 접속을 `ws://localhost:<포트>`로 바꿔 두 페이지를 열어 확인
- Chromium은 `/opt/pw-browsers/chromium` (클라우드 환경 기준)
