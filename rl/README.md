# 강화학습 봇

게임의 실제 시뮬레이션(`src/sim`)을 그대로 돌려서 봇을 학습시키는 환경입니다.
규칙을 파이썬으로 다시 짜지 않았기 때문에, 여기서 배운 것이 곧 실제 게임에서의 실력입니다.

필요한 것: Node 20+, Python 3.10+, PyTorch, NumPy. GPU는 필요 없습니다.

## 사용법

```bash
python3 rl/pretrain.py --name pre
python3 rl/train.py --name first --minutes 60 --resume rl/runs/pre/policy.pt
```

- `pretrain.py`는 봇끼리 둔 판으로 정책(봇 따라 하기)과 가치(누가 이길지)를 먼저 배웁니다. 따라 하기만 하면 봇이 안 가는 곳에서 막히므로, 학습본이 직접 둔 판에 봇의 정답을 붙여 다시 배우는 DAgger를 3번 거칩니다. 이게 없으면 해씨 물기를 끝내 못 찾고 꿀밤만 배웁니다.

```bash
node rl/play.js rl/runs/first/policy.json 200
```

- `train.py`는 `rl/runs/<이름>/`에 `policy.pt`(이어서 학습용), `policy.json`(브라우저·Node용 가중치), `log.csv`를 남깁니다.
- 게임에 넣기: `node rl/export.js <policy.json> solo` → `src/ai/rl-solo.bin`(개인전용), `... team` → `src/ai/rl-team.bin`(팀전용). 반정밀도라 각 약 1.7MB. 로비엔 "컴퓨터 · RL" 하나만 있고, 판이 팀전이면 팀전용을 씁니다(없으면 개인전용). 관측은 `src/ai/observe.js` 하나를 학습과 게임이 같이 씁니다.
- 수비·역할 (기본으로 켜짐). 역할(`jobs()`, `src/ai/observe.js`)은 게임 상태로 정함: 팀전에서 씨 든 팀원은 공격, 팀에 씨가 없으면 해바라기에 가장 가까운 한 명이 공격. 상대 운반자마다 가장 가까운 남는 팀원이 한 명씩 마크(운반자 둘이면 마크 둘), 나머지는 해바라기에 가장 가까운 상대를 경계. 개인전은 각자 가장 가까운 상대 운반자를 마크.
  - `--catch 4`: 씨 든 상대를 잡으면 추가 점수, 그 상대가 집에 가까울수록 최대 3배.
  - `--delay 0.05`: 마크 중인 운반자 곁(200px)에 있으면 결정마다 점수. 상대 운반자 중 가장 잘 달린 쪽 기준이라, 하나 막느라 다른 운반자가 집에 가면 0.
  - `--role 1`: 마크·경계 담당이 맡은 상대에게 다가가면 점수.
  - 관측 끝에 10개(내 역할 셋, 팀원이 씨 들었는지, 상대 운반자 수, 맡은 상대의 위치·집까지 거리)가 붙어 199→209개. 예전 학습본도 이어서 학습 가능(새 입력은 가중치 0에서 시작).
- 팀 정신 보상(`--team-spirit 0.5`, 기본값): 팀전에서 자기 점수 보상의 절반을 팀 평균으로 받아, 팀원이 씨를 가져가게 돕는 것도 보상이 됩니다(OpenAI Five 방식). 0이면 끔.
- Elo: `node rl/elo.js RL1=rl/runs/long/policy.json RL2=rl/runs/team/policy.json` → 기본 모드당 600판(오차 ±80점 안팎, 정밀하게는 `1600`). 개인전(4인)·팀전(2대2) Elo 따로. 판마다 봇·학습본을 무작위로 앉히고 결과 전체에 맞춰 계산, 초보 = 1000, 400점 차이 = 10:1.
- RL끼리: `node rl/report.js 새.json 20 기존.json` 하면 초고수·RL'과 개인전·팀전으로 붙는 7줄을 맵마다 봅니다(수 분). 예전 전체 표는 끝에 `--all`. 학습에선 `--rivals rl/runs/long/policy.pt`로 기존 봇을 리그에 고정해, 자기 과거들과 함께 상대·팀원으로 계속 만납니다.
- RL·RL2하고만 학습: `--rivals A.pt B.pt --league 2 --self-play 0 --no-curriculum --bot-env 0` (리그 크기가 고정 상대 수와 같으면 과거 자신이 안 들어감).
- 초고수(ace)와 붙이는 단계: `--stage 4` (중수·고수·초고수 봇이 판의 절반에 들어옴). 팀전 비중은 `--teams 0.8`.
- 구성별·맵별 표: `node rl/report.js rl/runs/first/policy.json` (기본은 초고수 상대 3줄, `--all`이면 전체 구성; 구성×맵마다 Node 하나씩 동시에 돌림)
- `play.js`는 학습된 봇 한 마리를 초보·중수·고수 봇 세 마리와 붙여 승률을 냅니다. 4인전이면 25%가 본전입니다.
- 이어서 학습: `--resume rl/runs/first/policy.pt` (10회 반복마다 저장되므로 중간에 꺼져도 여기서 이어집니다)
- 맥북을 덜 쓰게 하려면 `--workers 4`.

## 구성

| 파일 | 하는 일 |
|---|---|
| `env.js` | 여러 판을 한꺼번에 돌리는 Node 프로세스. stdin으로 행동을 받고 stdout으로 관측·보상을 냅니다. |
| `train.py` | 학습기. Node 프로세스를 코어 수만큼 띄워 한 번에 수백 판을 굴립니다. |
| `policy.js` | 학습된 신경망을 배열 연산만으로 실행합니다. 브라우저에서도 그대로 씁니다. |
| `play.js` | 스크립트 봇 상대 승률 측정. |

## 반응 지연

학습된 봇은 판을 **0.15초(9틱) 늦게** 봅니다(`src/ai/observe.js`의 `REACTION_TICKS`). 고수·초고수와 같은 값입니다. 학습 환경(`env.js`, 설정 `reaction`)과 브라우저(`src/ai/rl-bot.js`)가 같은 지연을 씁니다. 그래서 이 지연이 들어가기 전에 학습된 가중치는 다시 학습해야 제 실력이 나옵니다. `reaction: 0`이면 예전처럼 지금 상태를 봅니다. 학습기에서는 `--reaction 9`(기본값)로 정하고, 저장되는 가중치의 meta에도 적힙니다.

## 쓰는 기법

- **PPO + GAE**: 여러 명이 동시에 겨루는 셀프플레이에서 여전히 가장 안정적인 기본기입니다.
  한 신경망을 모든 자리에서 같이 씁니다(자리마다 보이는 것만 다름).
- **SimBa식 신경망**(Lee 외, ICLR 2025): 관측값 실시간 정규화 + 잔차 블록 + LayerNorm.
  가중치 15만 개 정도로 작지만 학습이 잘 흔들리지 않습니다.
- **리그 + PFSP**(AlphaStar의 prioritized fictitious self-play): 과거의 자기 자신을 16개까지 보관해 두고,
  아직 잘 못 이기는 상대를 더 자주 고릅니다. 최신 자신하고만 붙으면 옛 수법에 다시 당하는 문제를 막습니다.
- **스크립트 봇 단계 올리기**: 처음에는 판의 70%에 초보 봇만 넣습니다. 봇은 씨를 물고 집에 가 버리므로 꿀밤만 쳐서는 집니다.
  학습본의 자리당 승률이 그 단계에서 가장 센 봇의 자리당 승률 이상이 되면(봇 판 1000판 기준) 다음 단계로 올라갑니다.
  0 초보(70%) → 1 초보+중수(70%) → 2 초보+중수+고수(60%) → 3 같은 봇, 35%로 줄이고 나머지는 자기 자신과 대결.
  단계는 `policy.json`에 저장되어 `--resume` 때 이어집니다. `--stage 1`로 직접 정할 수 있고, `--no-curriculum`이면 예전처럼 `--bot-env` 비율로 모든 봇을 섞습니다.
- **행동 묶기**: 1초에 15번 결정합니다(4틱마다). 행동은 이동 9방향 × 꿀밤 × 던지기로 나눠 고릅니다.
- **길 안내 입력**: 해바라기·집·굴까지의 걸어가는 거리를 맵 전체에 미리 계산해 두고, "어느 쪽이 가까워지는 방향인지"를 관측에 넣습니다.
  미로 길찾기를 처음부터 배우느라 시간을 쓰지 않습니다.

PQN(Gallici 외, ICLR 2025)처럼 더 단순한 Q러닝 계열도 검토했지만 쓰지 않았습니다.
상대가 계속 바뀌는 셀프플레이와, 여러 선택을 동시에 내는 행동 구조에는 PPO가 더 다루기 쉽습니다.

## 판 구성

학습하는 판은 매번 다르게 뽑습니다.

- **인원**: 2~8명 중 고르게.
- **방식**: 절반은 개인전, 절반은 팀전. 팀전은 2~4개 팀(인원보다 많지는 않게)으로, 팀원 수는 최대한 고르게 나눠 자리를 섞습니다.
- **맵**: 일곱 맵 전부. 함정·대포·파도·문·얼음·밤낮이 그대로 나옵니다.
- **상대**: 자기 자신, 과거의 자신, 스크립트 봇이 섞입니다.

`--maps meadow,ice`처럼 맵을 고르거나 `--teams 0`으로 개인전만 돌릴 수 있습니다.

## 관측 (199개 숫자)

- 나(19): 위치, 속도, 방향, 해씨 여부, 꿀밤 쿨다운과 동작 단계, 던지기 차지, 씨 무는 진행도, 집 안인지, 집·해바라기까지 거리, 젖었는지, 얼음 위인지 등
- 판 상황(18): 시간, 연장전 여부, 집 경계 위치, 누가 씨를 무는 중인지, 인원, 팀 수, 상대가 해씨를 들었는지, 밤인지와 밤까지 남은 시간, 어느 맵인지
- 길 안내(9): 해바라기·집·굴 각각의 방향과 거리
- 벽 거리(8): 8방향으로 벽이나 닫힌 문까지 거리
- 위험 요소(4 × 12): 가까운 함정·대포·파도의 위치, 종류, 터졌는지, 대포 방향과 내가 사선에 있는지
- 문(2 × 3): 지금 닫혀 있는 가까운 문의 위치
- 다른 햄스터(7 × 13): 가까운 순으로 상대 위치·속도·해씨·같은 팀 여부·꿀밤 동작·집 안 여부 등

## 보상

점수판의 누적 점수 체계를 그대로 씁니다. 점수가 오를 때마다 그만큼 받고, 판을 이기면 승리 보상을 따로 받습니다.

| 항목 | 보상 |
|---|---|
| 꿀밤 | 1 |
| 저지(해씨 든 상대를 잡음) | +1 |
| 던지기로 잡음 | 2 |
| 해씨 물기 | 2 |
| 슈퍼플레이 | 3 |
| 골인 | 5 |
| **승리** | **30** |

승리가 30인 이유: 한 판에 꿀밤만으로 10점 넘게 쌓일 수 있어서, 승리 보상이 그보다 확실히 커야 싸움만 하지 않고 이기려 듭니다.
팀전에서는 이긴 팀 모두가 승리 보상을 받고, 시간 종료로 이겨도 받습니다.
지는 것(`--lose`)과 맞는 것에는 기본으로 벌점이 없습니다. `env.js`의 `DEFAULTS`에서 바꿀 수 있습니다.

### 진행 보상

점수와 승리만으로는 첫 해씨를 영영 못 찾습니다. 씨를 물려면 "가만히 있기"를 33번 연속으로 골라야 하는데, 무작위로는 나오지 않기 때문입니다.
그래서 해바라기에 가까워질수록, 씨를 무는 진행도가 찰수록, 씨를 물고 집에 가까워질수록 조금씩 보상을 줍니다(최대 12).
잠재 함수의 변화량으로 주기 때문에 왔다 갔다 하면 0으로 상쇄되고, 무엇이 최선인지는 바뀌지 않습니다. `--shape 0`으로 끌 수 있습니다.

## 지금 상태 (2026-10-12)

환경과 학습기는 끝까지 돌지만, **아직 쓸 만한 봇은 나오지 않았습니다.** M4 Pro에서 12~14분씩(약 800만 결정) 세 번 돌린 결과입니다.

- 속도: 초당 약 1만~1만4천 판-결정(게임 틱으로 4만~5만). 병목은 게임이 아니라 파이썬 쪽 신경망 계산입니다.
- 배운 것: 꿀밤으로 점수 쌓기. 자기들끼리 붙이면 한 마리당 한 판에 20점쯤 냅니다.
- 못 배운 것: 해씨 물기. 자기들끼리는 모든 판이 105초 시간 종료로 끝나고, 스크립트 봇 셋과 붙이면 초보 상대로도 승률 0%입니다.
- 원인으로 보는 것: 시간 종료는 꿀밤 수로 승부가 나서 꿀밤만 노려도 승리 보상을 받고, 씨 물기는 발견하기가 훨씬 어렵습니다.

다음에 해볼 것: 몇 시간 단위로 길게 돌리기, 스크립트 봇이 낀 판의 비율 올리기(`--bot-env`), 씨 근처에서 시작하는 연습 판 섞기,
시간 종료 승리의 보상 낮추기, 신경망 계산을 MPS로 옮기거나 판 수를 늘려 처리량 올리기.

## 아직 안 된 것

- **길 안내와 문**: 길 안내 방향은 문이 닫힌 것을 모르고 계산됩니다. 닫힌 문은 벽 거리와 문 위치로만 알 수 있습니다.
- **게임 연결**: 학습된 봇을 게임의 봇 난이도로 고르는 기능은 아직 없습니다. `policy.js`가 그 용도로 준비돼 있습니다.
- **기억**: 신경망에 기억(RNN)이 없어서 지금 보이는 것만으로 판단합니다.

### Kickstarting from the ace

`--kick 0.5` has the ace bot (`--teacher 3`) think in every learner seat without
playing it, and adds copying what it would have done to the PPO loss, fading to 0
by the end of the run: the ace's team play (cutting carriers off at the door,
splitting a pincer, escorting) is the start, the rewards take over from there.
The log's "copies the teacher" is how likely the learner is to pick the ace's move.
Costs about half the speed, since the ace thinks in every seat.

    python3 rl/train.py --name rl6 --minutes 180 --resume rl/runs/long/policy.pt --teams 1.0 --kick 0.5 --rivals rl/runs/long/policy.pt rl/runs/team2/policy.pt

### Distillation into one policy for both kinds of round

`--distill-solo` / `--distill-team` name trained policies (policy.pt) the learner
copies in free-for-all and team rounds; `--distill` weighs matching them (KL
over the three heads), held for the first half of the run and fading to 0 by
the end. With `--kick` (the ace) and self-play on top, a learner can start from
nothing and end up one network for both kinds of round:

    python3 rl/train.py --name rl7 --minutes 480 --teams 0.5 --distill 0.3 --distill-solo rl/runs/long/policy.pt --distill-team rl/runs/rl6/policy.pt --kick 0.2 --rivals rl/runs/long/policy.pt rl/runs/rl6/policy.pt

The log's "off the teachers" is that KL: falling means it plays like them.

### Relearning with the 0.15 s delay (rl9, rl10: in the game)

Every bot, this one included, sees the others 0.15 s late (`--reaction 9`), so
the weights from before had to learn again. rl9 started from rl7 with a light
distill as an anchor; rl10 went on from rl9 without it, with a smaller entropy
bonus and learning rate: at the default 0.01 the entropy climbed past 2.2 and
the win rate fell to the fair share within 20 minutes.

    python3 rl/train.py --name rl9 --resume rl/runs/rl7/policy.pt --minutes 300 --teams 0.5 --distill 0.2 --distill-solo rl/runs/rl7/policy.pt --distill-team rl/runs/rl6/policy.pt --rivals rl/runs/long/policy.pt rl/runs/rl6/policy.pt rl/runs/rl7/policy.pt rl/runs/rl8/policy.pt
    python3 rl/train.py --name rl10 --resume rl/runs/rl9/policy.pt --minutes 240 --teams 0.5 --entropy 0.003 --lr 1.5e-4 --rivals rl/runs/rl6/policy.pt rl/runs/rl7/policy.pt rl/runs/rl8/policy.pt rl/runs/rl9/policy.pt

Elo with the delay (600 rounds a mode): free-for-all ace 1245, RL10 1234, hard
1194, RL9 1187, the old rl1 1026; teams ace 1703, hard 1493, RL10 1431, RL9
1368, the old rl6 1076. rl10 plays both kinds of round.

### Deciding every 2 ticks (`--frame-skip 2`)

The scripted bots think every tick; a policy at the default `--frame-skip 4`
decides 15 times a second, so with the 0.15 s delay it answers 0.15–0.22 s
late against their 0.15–0.17 s. `--frame-skip 2` (30 decisions a second) closes
that gap. The weights carry it in their meta, the game follows it, and
`elo.js`/`report.js` run each policy at its own rate (a round with several runs
at the quickest; the slower ones hold their move in between). Keep the horizon
in seconds by taking the square roots of gamma and lambda:

    python3 rl/train.py --name rl12 --resume rl/runs/rl10/policy.pt --frame-skip 2 --gamma 0.9985 --lam 0.975 --minutes 300 --teams 0.5 --entropy 0.003 --lr 1.5e-4 --rivals rl/runs/rl7/policy.pt rl/runs/rl9/policy.pt rl/runs/rl10/policy.pt rl/runs/rl11/policy.pt

### The best stretch is kept apart (best.pt, best.json)

A run can lose ground after its peak (rl12 won 0.37 against the bots in its
first half hour, then fell to the fair share for an hour after the change of
gamma and lambda), and the last weights are not always the best. Every 5
iterations the trainer looks at how far above a fair share the learner won over
the last 20, and the best such stretch so far goes to `best.pt`/`best.json`
next to `policy.pt` (its `edge` in the meta). Measure both:

    node rl/elo.js RL10=rl/runs/rl10/policy.json last=rl/runs/rl13/policy.json best=rl/runs/rl13/best.json
