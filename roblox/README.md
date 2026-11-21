# Hash Rush 로블록스판 (2D 테스트 버전)

웹판 규칙을 로블록스에 탑뷰로 옮긴 1차 테스트 버전입니다. 초원 맵 1개, 개인전, 2~8명, 사람끼리만.

## Studio에서 열기

`HashRush.rbxlx`를 Roblox Studio로 엽니다(더블클릭). 코드와 설정이 모두 들어 있습니다.

`src/`를 고친 뒤에는 `python3 build.py`로 이 파일을 다시 만듭니다.
[Rojo](https://rojo.space) 7 이상을 쓴다면 `rojo build -o HashRush.rbxlx`나 `rojo serve`도 같은 결과입니다.

`src/shared`는 ReplicatedStorage, `src/server`는 ServerScriptService, `src/client`는 StarterPlayerScripts로 들어갑니다.
`이름.server.luau`는 Script, `이름.client.luau`는 LocalScript, 나머지 `.luau`는 ModuleScript, 폴더는 Folder입니다.
Workspace의 `StreamingEnabled`와 Players의 `CharacterAutoLoads`는 꺼져 있어야 합니다.

## 테스트

- 판은 저절로 시작하지 않습니다. 각자 **준비** 버튼(또는 Enter)을 눌러야 하고, 모두 준비하면 바로, 일부만 준비하면 10초 뒤에 준비한 사람끼리 시작합니다. 판이 끝나면 결과 화면에서 다시 준비를 누를 때까지 기다립니다.
- 대기실에서 **개인전/팀전**을 바꿀 수 있습니다. 팀전은 자리 순서대로 빨강·파랑으로 나뉘고(사람부터 번갈아), 같은 편은 서로 때리지 못하고 통과하며, 한 마리가 해씨를 가져오면 팀 전체가 이깁니다.
- 빈자리는 봇이 채웁니다. 대기실에서 누구나 봇 수(−/+)와 난이도(쉬움·보통·어려움·고수·RL)를 바꿀 수 있고, 기본은 보통 3마리입니다. 사람이 한 명이라도 봇이 있으면 판이 시작됩니다.
- 여럿이 보려면 Studio의 **Test → Server & Clients, 플레이어 2~4명**으로 시작합니다.
- 모바일은 Studio의 기기 에뮬레이터에서 조이스틱(화면 왼쪽)과 꿀밤·던지기 버튼(오른쪽)으로 확인합니다.
- 승수 저장(DataStore)은 게임을 한 번 게시하고 **게임 설정 → 보안 → Studio의 API 서비스 접근 허용**을 켜야 Studio에서 동작합니다. 꺼져 있어도 게임은 진행되고 경고만 뜹니다.

## 구조

- `Config`: 수치 전부(스터드 단위, 웹판 10px = 1스터드).
- `Sim`: 틱마다 이동·충돌·꿀밤·던지기·캐기·승리 판정. Instance를 쓰지 않는 순수 로직.
- `Map`: 울타리·둥지·굴·해바라기 좌표와, 그것을 파트로 까고 조명을 잡는 `Map.render()`. 좌표는 클라이언트도 씁니다.
- `Round`: 대기실(명단·준비·봇 설정) → 카운트다운 3초 → 플레이 → 결과가 뜬 대기실 → 반복. 봇 자리의 입력도 여기서 받아 옵니다. 60Hz로 `Sim.step`을 돌리고 매 틱 스냅샷을 보냅니다.
- `Snapshot`: 스냅샷을 buffer로 묶고 푸는 코드(8명에 147바이트).
- `Input`: 이동 방향과 꿀밤·던지기 버튼 상태만 서버로 보냅니다.
- `View`: 카메라, 화면 문구(HUD·결과 화면), 이벤트 연출. 판에 들어가 있으면 카메라가 내 햄스터 위로 다가가 천천히 따라가고, 순간이동이나 둥지로 돌아갈 때만 바로 넘어갑니다. 대기·관전 중에는 맵 전체를 봅니다. 화면 밖에서 해씨를 든 햄스터와 가야 할 곳(해바라기, 집)은 화면 가장자리에 화살표로 표시합니다. 내 햄스터는 핑만큼 앞서 그려서 키가 바로 먹습니다(판정은 서버 그대로).
- `Hamster`: 햄스터 한 마리의 모양과 움직임. 생김새와 색은 웹판 `src/client/looks.js` 그대로이고, 몸에 자리 색(팀전은 팀 색) 테두리를 두릅니다.
- `Tutorial`: 처음 온 사람(판 기록 0)에게 자동으로, 그리고 대기실의 🎓 버튼으로 시작하는 튜토리얼. 내 컴퓨터에서 Sim으로 따로 판을 돌리며 움직이기 → 해씨 캐기 → 집으로 → 꿀밤 → 던지기 → 소매치기 → 순간이동을 한 단계씩 직접 해 봅니다.
- `Fx`, `Sounds`: 음악과 효과음, 별·먼지, 튀어나오는 글자, 화면 흔들림, 히트스톱. 소리는 웹판 것을 그대로 씁니다(아래 소리).
- `Bot`, `BotNav`, `BotSearch`, `BotRng`: 웹판 규칙 기반 봇(`src/ai/bot.js`, `nav.js`, `search.js`)을 옮긴 것.
- `RLBot`, `RLObserve`, `RLPolicy`, `weights/`: 웹판 RL 봇. `weights/`는 `python3 tools/pack_weights.py`가 `src/ai/rl-solo.bin`에서 만듭니다.

## 봇 검증

`node`와 `luau` 명령줄이 있으면 로블록스 없이 돌릴 수 있습니다.

- `sh roblox/test/run.sh`: 웹판과 같은 판을 양쪽에서 돌려 RL 봇이 보는 숫자 230개와 고르는 행동이 같은지 비교하고, 판단 한 번에 걸리는 시간을 잽니다.
- `node roblox/tools/wrap.mjs && luau --codegen roblox/test/bots.luau`: 규칙 기반 봇끼리 난이도별로 판을 돌려 해씨를 캐고 꿀밤을 치고 집에 돌아오는지 확인합니다.
- `node roblox/tools/wrap.mjs && luau roblox/test/tutorial.luau`: 튜토리얼을 처음부터 끝까지 플레이해 단계가 차례로 넘어가는지 확인합니다. Studio 없이 돕니다.

## 소리

효과음과 음악은 웹판(`src/client/audio.js`, `music.js`)이 합성하는 소리를 그대로 파일로 뽑아 씁니다. 웹판 소리가 바뀌면 다시 뽑습니다.

1. `node roblox/tools/audio/server.mjs`를 켜고 브라우저로 `http://localhost:5288/roblox/tools/audio/render.html`을 열어 두 버튼(effects, music)을 누릅니다. `roblox/tools/audio/out/`에 WAV가 생깁니다.
2. `python3 roblox/tools/audio/build.py`가 올릴 파일(`effects.ogg`, `music-round-1.ogg`, `music-round-2.ogg`, `music-lobby.ogg`)과 `src/client/Sounds.luau`를 만듭니다. 판 음악은 12분을 한 파일로 올리면 로블록스가 "Audio duration too long"으로 거절해서, 곡 단위로 6분 반 안쪽씩 나눕니다.
3. 파일을 Studio의 Asset Manager(Import)로 올리고, 받은 아이디로 `python3 roblox/tools/audio/build.py --effects ID --game ID ID --lobby ID`를 한 번 더 돌린 뒤 `python3 build.py`. 아이디는 `tools/audio/ids.json`에 남습니다.

아이디가 빠진 소리는 로블록스 공식·APM 음원이 대신 나옵니다.

## 봇 Elo

`node roblox/tools/elo.mjs [모드별 판 수, 기본 600] [solo|team]`은 로블록스 Sim에서 봇끼리 붙여 Elo 표를 냅니다.
웹판 `rl/elo.js`와 같은 방식입니다: 판마다 네 자리를 풀(초보·중수·고수·초고수·RL)에서 무작위로 뽑고, 전체 결과에 Elo를 한 번에 맞추며, 초보를 1000에 둡니다. 400점 차이가 10 대 1입니다.
개인전은 4인, 팀전은 2 대 2이고 팀 실력은 두 마리 평균으로 봅니다. 그래서 섞인 짝으로 잰 팀전 표는 같은 종류끼리 짝지은 맞대결과 다르게 나올 수 있습니다. 같은 종류끼리 짝지은 2 대 2 맞대결은 `node roblox/tools/duel.mjs`(RL 포함)가, 규칙 봇을 웹판과 나란히 놓은 비교는 `node roblox/tools/teams.mjs`가 보여 줍니다.

## 웹판과 다른 점

- 초원 외 맵과 위험 요소는 없습니다.
- 던지기는 꿀밤 버튼과 따로 있는 버튼입니다(웹판 PC도 F·K로 같음).

## 공개 전 할 일

1. 크리에이터 대시보드에서 콘텐츠 성숙도 설문 작성.
2. 비공개 상태에서 친구 초대로 테스트.
3. 문제없으면 공개.
