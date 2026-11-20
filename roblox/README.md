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
| `src/server/Sim.luau` | ServerScriptService/Sim | ModuleScript |
| `src/server/Map.luau` | ServerScriptService/Map | ModuleScript |
| `src/server/Round.server.luau` | ServerScriptService/Round | Script |
| `src/client/Input.client.luau` | StarterPlayerScripts/Input | LocalScript |
| `src/client/View.client.luau` | StarterPlayerScripts/View | LocalScript |

## 테스트

- Studio의 **테스트 → 로컬 서버, 플레이어 2~4명**으로 시작합니다. 2명이 모이면 10초 뒤 판이 시작됩니다.
- 모바일은 Studio의 기기 에뮬레이터에서 조이스틱(화면 왼쪽)과 꿀밤·던지기 버튼(오른쪽)으로 확인합니다.
- 승수 저장(DataStore)은 게임을 한 번 게시하고 **게임 설정 → 보안 → Studio의 API 서비스 접근 허용**을 켜야 Studio에서 동작합니다. 꺼져 있어도 게임은 진행되고 경고만 뜹니다.

## 구조

- `Config`: 수치 전부(스터드 단위, 웹판 10px = 1스터드).
- `Sim`: 틱마다 이동·충돌·꿀밤·던지기·캐기·승리 판정. Instance를 쓰지 않는 순수 로직.
- `Map`: 울타리·둥지·굴·해바라기 좌표와, 그것을 파트로 까는 `Map.render()`.
- `Round`: 로비 → 카운트다운 3초 → 플레이 → 결과 5초 → 반복. 60Hz로 `Sim.step`을 돌리고 매 틱 스냅샷을 보냅니다.
- `Snapshot`: 스냅샷을 buffer로 묶고 푸는 코드(8명에 139바이트).
- `Input`: 이동 방향과 꿀밤·던지기 버튼 상태만 서버로 보냅니다.
- `View`: 카메라 고정, 햄스터 그리기, 화면 문구.

## 웹판과 다른 점

- 씨 훔치기(소매치기), 팀전, 초원 외 맵과 위험 요소, 봇은 없습니다.
- 던지기는 꿀밤 버튼과 따로 있는 버튼입니다(웹판 PC도 F·K로 같음).
- 효과음은 아직 없습니다.

## 공개 전 할 일

1. 크리에이터 대시보드에서 콘텐츠 성숙도 설문 작성.
2. 비공개 상태에서 친구 초대로 테스트.
3. 문제없으면 공개.
