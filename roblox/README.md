# Hash Rush 로블록스판 (Hush Rush)

로블록스에서는 이름이 **Hush Rush**입니다. "Hash"가 로블록스 이름 검열에 걸려서(마약 은어로 보는 듯) 발음이 비슷한 이름으로 바꿨고, 게임 안 제목과 스토어 그림도 이 이름입니다. 코드와 파일 이름은 그대로 HashRush입니다.

웹판 규칙을 로블록스에 탑뷰로 옮긴 버전입니다. 초원 맵 1개, 개인전·팀전, 최대 8명(빈자리는 봇). 한국어·영어.

## Studio에서 열기

`HashRush.rbxlx`를 Roblox Studio로 엽니다(더블클릭). 코드와 설정이 모두 들어 있습니다.

`src/`를 고친 뒤에는 `python3 build.py`로 이 파일을 다시 만듭니다.
[Rojo](https://rojo.space) 7 이상을 쓴다면 `rojo build -o HashRush.rbxlx`나 `rojo serve`도 같은 결과입니다.

`src/shared`는 ReplicatedStorage, `src/server`는 ServerScriptService, `src/client`는 StarterPlayerScripts로 들어갑니다.
`이름.server.luau`는 Script, `이름.client.luau`는 LocalScript, 나머지 `.luau`는 ModuleScript, 폴더는 Folder입니다.
Workspace의 `StreamingEnabled`와 Players의 `CharacterAutoLoads`는 꺼져 있어야 합니다.

## 테스트

- **방장**: 웹판 방처럼 서버에 처음 들어온 사람이 방장(👑)입니다. 방장이 나가면 참가 중인 첫 사람, 없으면 관전 중인 첫 사람이 넘겨받고, 방장은 명단의 👑 버튼(두 번 눌러 확인)으로 넘길 수 있습니다.
- **참가와 관전**: 자리는 8개입니다. 자리가 있을 때 들어온 사람은 참가, 나머지는 관전합니다. 방장은 명단에서 누구든 넣기·빼기 할 수 있고, 각자는 자기만 관전·참가(자리가 있을 때)로 바꿀 수 있습니다. 참가자가 나가서 빈 자리는 가장 오래 기다린 관전자가 채웁니다. 단 방장이 뺐거나 스스로 관전을 고른 사람은 자동으로 들어가지 않습니다. 서버 크기는 50이라 나머지는 관전합니다.
- **원버튼 시작**: 들어오면 기본이 팀전 2:2(나 + 중수 봇 3마리, 같은 편 1·상대 2)이고, 혼자일 때 준비 버튼이 "▶ 바로 시작!"이라 한 번 누르면 바로 판이 열립니다. 개인전으로 바꾸면 나 + 초보·중수·고수 봇. 모드를 바꾸면 그 모드의 기본 구성으로 돌아가고, 방장은 그 뒤 무엇이든 바꿀 수 있습니다. 봇 수는 "총 4마리가 되게" 채우는 방식이라 사람이 늘면 봇이 그만큼 줄어듭니다. 튜토리얼 마지막 "▶ 시작하기!"도 바로 판을 시작합니다.
- 판은 저절로 시작하지 않습니다. 참가자가 각자 **준비** 버튼(또는 Enter)을 눌러야 하고, 모두 준비하면 바로, 일부만 준비하면 10초 뒤에 준비한 사람끼리 시작합니다. 판이 끝나면 결과 화면에서 다시 준비를 누를 때까지 기다립니다.
- 대기실에서 **개인전/팀전**을 바꿀 수 있습니다. 팀전은 자리 순서대로 빨강·파랑으로 나뉘고(사람부터 번갈아), 같은 편은 서로 때리지 못하고 통과하며, 한 마리가 해씨를 가져오면 팀 전체가 이깁니다.
- 빈자리는 봇이 채웁니다. 대기실에서 방장이 봇 수(−/+)와 난이도(쉬움·보통·어려움·고수·RL), 개인전·팀전을 바꿀 수 있고, 웹판 방처럼 명단의 봇 옆 난이도 칩을 눌러 봇마다 따로 정할 수도 있습니다(전체 난이도를 바꾸면 다시 모두 같아짐), 기본은 보통 3마리입니다. 사람이 한 명이라도 봇이 있으면 판이 시작됩니다.
- 여럿이 보려면 Studio의 **Test → Server & Clients, 플레이어 2~4명**으로 시작합니다.
- 모바일은 Studio의 기기 에뮬레이터에서 조이스틱(화면 왼쪽)과 꿀밤·던지기 버튼(오른쪽)으로 확인합니다.
- 승수 저장(DataStore)은 게임을 한 번 게시하고 **게임 설정 → 보안 → Studio의 API 서비스 접근 허용**을 켜야 Studio에서 동작합니다. 꺼져 있어도 게임은 진행되고 경고만 뜹니다.

## 구조

- `Config`: 수치 전부(스터드 단위, 웹판 10px = 1스터드).
- `Sim`: 틱마다 이동·충돌·꿀밤·던지기·캐기·승리 판정. Instance를 쓰지 않는 순수 로직.
- `Map`: 울타리·둥지·굴·해바라기 좌표와, 그것을 파트로 까고 조명을 잡는 `Map.render()`. 좌표는 클라이언트도 씁니다.
- `Lobby`: 방장, 참가·관전, 넣기·빼기 규칙. 로블록스 없이 도는 순수 상태라 `test/lobby.luau`로 검사합니다.
- `Round`: 대기실(명단·준비·봇 설정) → 카운트다운 3초 → 플레이 → 결과가 뜬 대기실 → 반복. 봇 자리의 입력도 여기서 받아 옵니다. 60Hz로 `Sim.step`을 돌리고 매 틱 스냅샷을 보냅니다.
- `Snapshot`: 스냅샷을 buffer로 묶고 푸는 코드(8명에 147바이트).
- `Input`: 이동 방향과 꿀밤·던지기 버튼 상태만 서버로 보냅니다.
- `View`: 카메라, 화면 문구(HUD·결과 화면), 이벤트 연출. 판에 들어가 있으면 카메라가 내 햄스터 위로 다가가 천천히 따라가고, 순간이동이나 둥지로 돌아갈 때만 바로 넘어갑니다. 대기·관전 중에는 맵 전체를 봅니다. 화면 밖에서 해씨를 든 햄스터와 가야 할 곳(해바라기, 집)은 화면 가장자리에 화살표로 표시합니다. 내 햄스터는 핑만큼 앞서 그려서 키가 바로 먹습니다(판정은 서버 그대로).
- `Hamster`: 햄스터 한 마리의 모양과 움직임. 생김새와 색은 웹판 `src/client/looks.js` 그대로이고, 몸에 자리 색(팀전은 팀 색) 테두리를 두릅니다.
- `Tutorial`: 처음 온 사람(판 기록 0)에게 자동으로, 그리고 대기실의 🎓 버튼으로 시작하는 튜토리얼. 내 컴퓨터에서 Sim으로 따로 판을 돌리며 움직이기 → 해씨 캐기 → 집으로 → 꿀밤 → 던지기 → 소매치기 → 순간이동을 한 단계씩 직접 해 봅니다.
- `Lang`: 화면에 나오는 말 전부(한국어·영어). 로블록스 언어가 한국어인 사람은 한국어, 나머지는 영어로 봅니다. 봇 이름·난이도·팀 이름도 여기서 옮기고, 맵 표지판은 서버가 쓴 것을 클라이언트가 자기 말로 다시 씁니다. Studio에서 영어로 보려면 ReplicatedStorage에 문자열 속성 `Locale` = `en-us`를 넣고 플레이합니다.
- `Fx`, `Sounds`: 음악과 효과음, 별·먼지, 튀어나오는 글자, 화면 흔들림, 히트스톱. 소리는 웹판 것을 그대로 씁니다(아래 소리).
- `Bot`, `BotNav`, `BotSearch`, `BotRng`: 웹판 규칙 기반 봇(`src/ai/bot.js`, `nav.js`, `search.js`)을 옮긴 것.
- `RLBot`, `RLObserve`, `RLPolicy`, `weights/`: 웹판 RL 봇. `weights/`는 `python3 tools/pack_weights.py`가 `src/ai/rl-solo.bin`에서 만듭니다. 웹판처럼 네트워크 위에 규칙 하나(그림자)를 얹습니다: 빈손일 때 10스터드 안에 해씨를 들고 10초 동안 꿀밤을 안 친 상대가 있으면, 그 앞쪽으로 붙어 따라가며 꿀밤을 참아 소매치기 게이지를 채웁니다.

## 봇 검증

`node`와 `luau` 명령줄이 있으면 로블록스 없이 돌릴 수 있습니다.

- `sh roblox/test/run.sh`: 웹판과 같은 판을 양쪽에서 돌려 RL 봇이 보는 숫자 230개와 고르는 행동이 같은지 비교하고, 판단 한 번에 걸리는 시간을 잽니다. 꿀밤이 사거리 끝이나 같은 거리의 두 햄스터 사이에 떨어진 판(여럿이 한 햄스터에 붙어 소매치기할 때 생김)은 누가 맞는지가 소수점 마지막 자리 반올림에 달려 있어, 그 틱까지만 비교합니다.
- `node roblox/tools/wrap.mjs && luau --codegen roblox/test/bots.luau`: 규칙 기반 봇끼리 난이도별로 판을 돌려 해씨를 캐고 꿀밤을 치고 집에 돌아오는지 확인합니다.
- `node roblox/tools/wrap.mjs && luau roblox/test/tutorial.luau`: 튜토리얼을 처음부터 끝까지 플레이해 단계가 차례로 넘어가는지 확인합니다. Studio 없이 돕니다.
- `node roblox/tools/wrap.mjs && luau roblox/test/lobby.luau`: 방장이 넘어가는 순서, 8자리, 넣기·빼기 권한, 빈 자리 채우기를 확인합니다.
- `node roblox/tools/wrap.mjs && luau roblox/test/lang.luau`: 영어에 한국어의 말이 빠짐없이, 같은 빈칸(%d, %s)으로 있는지 확인합니다.

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

## 스토어 그림

`sh roblox/tools/store/render.sh`가 웹판 그림 코드(og.png와 같은 것)로 `roblox/store/`에 `icon.png`(512×512), `thumb-en.png`·`thumb-ko.png`(1920×1080)를 만듭니다. 크롬을 헤드리스로 띄워 찍으므로 화면을 쓰지 않습니다. 그림은 `tools/store/art.html`.

## 출시

코드 쪽은 준비돼 있습니다: 한국어·영어, PC·모바일 조작, 튜토리얼, 승수 저장(DataStore), 웹판 소리, 혼자 와도 봇과 바로 시작.

남은 일은 로블록스 계정에서 할 것들입니다.

1. **게시**: Studio에서 `HashRush.rbxlx`를 열고 File → Publish to Roblox. 소유자는 소리 4개를 올린 계정(Asset Manager의 HashChat)과 **같게** 합니다. 다르면 소리가 나지 않습니다(다른 소유자면 오디오 권한을 따로 줘야 함). 새 경험은 비공개로 만들어집니다.
2. **크리에이터 대시보드 → 경험 설정**
   - 이름 `Hush Rush`(`Hash Rush`는 검열에 걸림), 설명은 아래 글, 장르 Party & Casual.
   - 아이콘 `roblox/store/icon.png`, 썸네일 `thumb-en.png`. 현지화 설정에서 한국어 썸네일로 `thumb-ko.png`, 한국어 이름·설명도 넣을 수 있습니다.
   - 기기: 컴퓨터·휴대폰·태블릿. 콘솔은 끕니다(대기실 버튼을 패드로 고를 수 없음).
   - 장소 → 액세스 → 최대 방문자 수: 기본 50 그대로(자리는 8개, 나머지는 관전하고 방장이 넣고 뺌).
   - 콘텐츠 성숙도 설문 작성(공개 전 필수). 만화풍 꿀밤뿐이고 피·무기 없음, 소통은 로블록스 기본 채팅뿐.
3. **비공개 테스트**: 친구를 테스터로 넣거나 공개 범위를 친구로 두고 폰과 PC로 한 판씩. 소리, 저장(다시 들어왔을 때 튜토리얼이 안 뜨는지), 2명 이상 판을 봅니다.
4. **공개**: 문제없으면 공개로 바꿉니다.

나중에 할 만한 것: 배지(첫 승, 10승), 게임패스·꾸미기, 콘솔용 패드 메뉴, 맵 추가.

### 스토어 설명

영어(기본):

```
🐹 Grab a sunflower seed and race home!

Stand still by the sunflower to dig up a seed, then carry it to your home on the sand before anyone stops you.
👊 Bonk rivals to make them drop their seed
💨 Throw your seed to knock down a whole line
🤏 Snatch seeds from carriers
🌀 Warp back to your nest through purple swirls

• Free-for-all or Red vs Blue team rounds, up to 8 hamsters
• Bots fill empty seats, from Easy to an AI that learned the game by playing it
• A short tutorial for first-timers

Controls: WASD / arrows to move, Space to bonk, F to throw. Phone: joystick + 👊 / 🌻 buttons.
```

한국어:

```
🐹 해씨 물고 집으로 달려라!

해바라기 옆에서 가만히 있으면 해씨가 나와요. 해씨를 물고 모래밭 집까지 돌아가면 승리!
👊 꿀밤으로 상대의 해씨를 떨어뜨리고
💨 해씨를 던져 줄 선 상대를 한꺼번에 쓰러뜨리고
🤏 해씨 든 상대에게 붙어 슬쩍 가져오고
🌀 보라색 소용돌이로 둥지까지 순간이동!

• 개인전 또는 레드 대 블루 팀전, 최대 8마리
• 빈자리는 봇이 채워요. 초보부터 게임을 스스로 익힌 AI까지
• 처음 온 사람을 위한 짧은 튜토리얼

조작: WASD·방향키 이동, Space 꿀밤, F 던지기. 휴대폰: 조이스틱 + 👊·🌻 버튼.
```
