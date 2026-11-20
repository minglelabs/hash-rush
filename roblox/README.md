# Hash Rush 로블록스판 (2D 테스트 버전)

웹판 규칙을 로블록스에 탑뷰로 옮긴 1차 테스트 버전입니다. 초원 맵 1개, 개인전, 2~8명, 사람끼리만.

## Studio에서 열기

`HashRush.rbxlx`를 Roblox Studio로 엽니다(더블클릭). 코드와 설정이 모두 들어 있습니다.

`src/`를 고친 뒤에는 `python3 build.py`로 이 파일을 다시 만듭니다.
[Rojo](https://rojo.space) 7 이상을 쓴다면 `rojo build -o HashRush.rbxlx`나 `rojo serve`도 같은 결과입니다.

손으로 넣으려면 아래 위치에 같은 이름으로 스크립트를 만들어 붙여 넣고,
Workspace의 `StreamingEnabled`와 Players의 `CharacterAutoLoads`를 끕니다.

| 파일 | Studio 위치 | 종류 |
| --- | --- | --- |
| `src/shared/Config.luau` | ReplicatedStorage/Config | ModuleScript |
| `src/shared/Snapshot.luau` | ReplicatedStorage/Snapshot | ModuleScript |
| `src/shared/Sim.luau` | ReplicatedStorage/Sim | ModuleScript |
| `src/shared/Map.luau` | ReplicatedStorage/Map | ModuleScript |
| `src/server/Round.server.luau` | ServerScriptService/Round | Script |
| `src/client/Input.client.luau` | StarterPlayerScripts/Input | LocalScript |
| `src/client/View.client.luau` | StarterPlayerScripts/View | LocalScript |
| `src/client/Hamster.luau` | StarterPlayerScripts/Hamster | ModuleScript |
| `src/client/Fx.luau` | StarterPlayerScripts/Fx | ModuleScript |

## 테스트

- 판은 저절로 시작하지 않습니다. 각자 **준비** 버튼(또는 Enter)을 눌러야 하고, 모두 준비하면 바로, 일부만 준비하면 10초 뒤에 준비한 사람끼리 시작합니다. 판이 끝나면 결과 화면에서 다시 준비를 누를 때까지 기다립니다.
- Studio에서 혼자 **Test**(F5)로 시작하면 꿀밤을 주고받을 **연습 상대**가 함께 나옵니다. 실서버에는 나오지 않고, 실서버는 2명부터 시작합니다.
- 여럿이 보려면 Studio의 **Test → Server & Clients, 플레이어 2~4명**으로 시작합니다.
- 모바일은 Studio의 기기 에뮬레이터에서 조이스틱(화면 왼쪽)과 꿀밤·던지기 버튼(오른쪽)으로 확인합니다.
- 승수 저장(DataStore)은 게임을 한 번 게시하고 **게임 설정 → 보안 → Studio의 API 서비스 접근 허용**을 켜야 Studio에서 동작합니다. 꺼져 있어도 게임은 진행되고 경고만 뜹니다.

## 구조

- `Config`: 수치 전부(스터드 단위, 웹판 10px = 1스터드).
- `Sim`: 틱마다 이동·충돌·꿀밤·던지기·캐기·승리 판정. Instance를 쓰지 않는 순수 로직.
- `Map`: 울타리·둥지·굴·해바라기 좌표와, 그것을 파트로 까고 조명을 잡는 `Map.render()`. 좌표는 클라이언트도 씁니다.
- `Round`: 로비(준비) → 카운트다운 3초 → 플레이 → 결과가 뜬 로비(준비) → 반복. 60Hz로 `Sim.step`을 돌리고 매 틱 스냅샷을 보냅니다.
- `Snapshot`: 스냅샷을 buffer로 묶고 푸는 코드(8명에 139바이트).
- `Input`: 이동 방향과 꿀밤·던지기 버튼 상태만 서버로 보냅니다.
- `View`: 카메라, 화면 문구(HUD·결과 화면), 이벤트 연출. 내 햄스터는 핑만큼 앞서 그려서 키가 바로 먹습니다(판정은 서버 그대로).
- `Hamster`: 햄스터 한 마리의 모양과 움직임(뒤뚱 걸음, 꿀밤 휘두르기, 볼 부풀리기, 기절).
- `Fx`: 효과음, 별·먼지, 튀어나오는 글자, 화면 흔들림, 히트스톱.

## 웹판과 다른 점

- 씨 훔치기(소매치기), 팀전, 초원 외 맵과 위험 요소, 봇은 없습니다.
- 던지기는 꿀밤 버튼과 따로 있는 버튼입니다(웹판 PC도 F·K로 같음).
- 효과음은 로블록스에 기본으로 들어 있는 소리만 높낮이를 바꿔 씁니다. 전용 효과음과 음악은 아직 없습니다.

## 공개 전 할 일

1. 크리에이터 대시보드에서 콘텐츠 성숙도 설문 작성.
2. 비공개 상태에서 친구 초대로 테스트.
3. 문제없으면 공개.
