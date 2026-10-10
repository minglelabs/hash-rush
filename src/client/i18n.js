// Interface text. Korean, Japanese and Chinese (Simplified / Traditional) speakers
// get their own language; everyone else gets English. `?lang=ja` overrides the
// browser setting, which is handy for checking a translation.

const TOUCH = (text) => `<span class="touch-only">· ${text}</span>`;

// Picks the right Korean subject particle for a name: 구름이 / 초코가.
function koSubject(name) {
  const code = name.charCodeAt(name.length - 1);
  const hangul = code >= 0xac00 && code <= 0xd7a3;
  return name + (hangul && (code - 0xac00) % 28 ? '이' : '가');
}

const STRINGS = {
  ko: {
    description: '해바라기씨를 물고 집에 제일 먼저 돌아오면 이기는 햄스터 눈치싸움 게임',
    tagline: '해바라기씨를 물고 <b>집에 제일 먼저</b> 돌아오면 승리! 꿀밤 한 대면 누구든 빈손으로 집에 돌아가요.',
    players: '참가자',
    start: '게임 시작',
    needOpponent: '상대가 한 명은 있어야 해요',
    howto: '놀이 방법',
    how: [
      `<b>이동</b> WASD · 방향키 · 마우스 클릭 ${TOUCH('화면 드래그')}`,
      `<b>꿀밤</b> Space · 상대 햄스터 클릭 ${TOUCH('꿀밤 버튼')}`,
      '해바라기 옆에 <b>가만히 2초</b> 서 있으면 씨를 물어요. 한 번에 한 마리만! 움직이거나 꿀밤을 치면 처음부터.',
      '씨를 문 채 집 안으로 들어가면 승리.',
      '길은 한 마리 폭이라 <b>서로 지나칠 수 없어요</b>. 막히면 싸우거나 다른 길로 돌아가요.',
      '꿀밤은 <b>딱 붙어야</b> 맞아요. 헛치면 잠깐 굳으니, 상대가 헛치게 만든 다음 한 대!',
      '집 안에서는 꿀밤을 칠 수도, 맞을 수도 없어요.',
    ],
    hint: '이동 WASD · 방향키 · 클릭 &nbsp;|&nbsp; 꿀밤 Space',
    lobby: '로비로',
    again: '한 판 더',
    bonk: '꿀밤',
    sound: '소리',
    kinds: {
      human: '사람 (나)',
      'bot:easy': '컴퓨터 · 쉬움',
      'bot:normal': '컴퓨터 · 보통',
      'bot:hard': '컴퓨터 · 어려움',
      closed: '닫힘',
      open: '열림 · 온라인 (준비 중)',
    },
    names: ['나', '구름', '초코', '먼지'],
    slotName: (n) => `${n}번 자리 이름`,
    slotKind: (n) => `${n}번 자리 종류`,
    fallbackName: (n) => `햄스터${n}`,
    go: '출발!',
    bonkWord: '뿅!',
    seedGot: '해씨 획득!',
    home: '집',
    lostSeed: '씨를 놓쳤어요! 다시 해바라기로!',
    gotSeedMe: '🌻 해씨 획득! 집으로 달려요!',
    gotSeedOther: (name) => `🌻 ${koSubject(name)} 씨를 물었어요! 막아요!`,
    winMe: '🎉 내가 이겼다!',
    winOther: (name) => `🏆 ${koSubject(name)} 이겼어요`,
    columns: ['꿀밤', '맞음', '해씨', '누적 승'],
    tally: (n) => `${n}승`,
  },

  en: {
    description: 'A hamster game of chicken: grab a sunflower seed and be the first one home.',
    tagline: 'Grab a sunflower seed and be the <b>first one home</b> to win! One bonk sends anyone home empty-handed.',
    players: 'Players',
    start: 'Start game',
    needOpponent: 'You need at least one opponent',
    howto: 'How to play',
    how: [
      `<b>Move</b> WASD · arrow keys · mouse click ${TOUCH('drag the screen')}`,
      `<b>Bonk</b> Space · click a rival hamster ${TOUCH('Bonk button')}`,
      '<b>Stand still for 2 seconds</b> next to the sunflower to grab a seed. One hamster at a time! Moving or bonking starts you over.',
      'Carry the seed into the burrow to win.',
      "Lanes are one hamster wide, so <b>nobody can pass</b>. If you're blocked, fight or take another way.",
      "A bonk only lands when you're <b>right next to</b> the target. Miss and you freeze for a moment, so make them miss first!",
      'Inside the burrow nobody can bonk or be bonked.',
    ],
    hint: 'Move WASD · arrows · click &nbsp;|&nbsp; Bonk Space',
    lobby: 'Lobby',
    again: 'Play again',
    bonk: 'Bonk',
    sound: 'Sound',
    kinds: {
      human: 'Human (me)',
      'bot:easy': 'Computer · Easy',
      'bot:normal': 'Computer · Normal',
      'bot:hard': 'Computer · Hard',
      closed: 'Closed',
      open: 'Open · Online (coming soon)',
    },
    names: ['Me', 'Cloud', 'Choco', 'Dusty'],
    slotName: (n) => `Name for slot ${n}`,
    slotKind: (n) => `Player type for slot ${n}`,
    fallbackName: (n) => `Hamster ${n}`,
    go: 'Go!',
    bonkWord: 'Bonk!',
    seedGot: 'Got a seed!',
    home: 'Home',
    lostSeed: 'You lost the seed! Back to the sunflower!',
    gotSeedMe: '🌻 Got a seed! Run home!',
    gotSeedOther: (name) => `🌻 ${name} has a seed! Stop them!`,
    winMe: '🎉 You win!',
    winOther: (name) => `🏆 ${name} wins`,
    columns: ['Bonks', 'Bonked', 'Seeds', 'Wins'],
    tally: (n) => `${n} W`,
  },

  ja: {
    description: 'ひまわりの種をくわえて、いちばん先に巣へ帰れば勝ち。ハムスターの駆け引きゲーム。',
    tagline: 'ひまわりの種をくわえて<b>いちばん先に巣へ</b>帰れば勝ち！ゲンコツ一発で、だれでも手ぶらで巣に逆戻り。',
    players: '参加者',
    start: 'ゲームスタート',
    needOpponent: '相手が1匹は必要です',
    howto: 'あそびかた',
    how: [
      `<b>移動</b> WASD · 矢印キー · マウスクリック ${TOUCH('画面をドラッグ')}`,
      `<b>ゲンコツ</b> Space · 相手のハムスターをクリック ${TOUCH('ゲンコツボタン')}`,
      'ひまわりのそばで<b>じっと2秒</b>立つと種をくわえます。一度に1匹だけ！動いたりゲンコツを打つと最初から。',
      '種をくわえたまま巣に入れば勝ち。',
      '道は1匹ぶんの幅なので<b>すれ違えません</b>。ふさがれたら戦うか、別の道へ回りましょう。',
      'ゲンコツは<b>ぴったりくっついて</b>いないと当たりません。空振りすると一瞬固まるので、相手に空振りさせてから一発！',
      '巣の中ではゲンコツを打つことも、打たれることもありません。',
    ],
    hint: '移動 WASD · 矢印 · クリック &nbsp;|&nbsp; ゲンコツ Space',
    lobby: 'ロビーへ',
    again: 'もう一回',
    bonk: 'ゲンコツ',
    sound: 'サウンド',
    kinds: {
      human: '人間（自分）',
      'bot:easy': 'コンピュータ · かんたん',
      'bot:normal': 'コンピュータ · ふつう',
      'bot:hard': 'コンピュータ · むずかしい',
      closed: '閉じる',
      open: 'オープン · オンライン（準備中）',
    },
    names: ['じぶん', 'くも', 'チョコ', 'グレー'],
    slotName: (n) => `${n}番の名前`,
    slotKind: (n) => `${n}番の種類`,
    fallbackName: (n) => `ハムスター${n}`,
    go: 'スタート!',
    bonkWord: 'ポカッ!',
    seedGot: '種ゲット!',
    home: '巣',
    lostSeed: '種を落とした！もう一度ひまわりへ！',
    gotSeedMe: '🌻 種ゲット！巣へ走れ！',
    gotSeedOther: (name) => `🌻 ${name}が種をくわえた！止めろ！`,
    winMe: '🎉 あなたの勝ち！',
    winOther: (name) => `🏆 ${name}の勝ち`,
    columns: ['ゲンコツ', 'くらった', '種', '通算勝利'],
    tally: (n) => `${n}勝`,
  },

  'zh-Hans': {
    description: '叼着瓜子第一个回到窝里就赢的仓鼠心理战游戏。',
    tagline: '叼着瓜子<b>第一个回到窝里</b>就赢！挨一下敲头，谁都得空手回窝。',
    players: '参加者',
    start: '开始游戏',
    needOpponent: '至少需要一个对手',
    howto: '玩法',
    how: [
      `<b>移动</b> WASD · 方向键 · 鼠标点击 ${TOUCH('拖动屏幕')}`,
      `<b>敲头</b> Space · 点击对手仓鼠 ${TOUCH('敲头按钮')}`,
      '在向日葵旁<b>站着不动2秒</b>就能叼到瓜子。一次只能一只！移动或敲头就要重新开始。',
      '叼着瓜子进到窝里就赢。',
      '路只有一只仓鼠宽，<b>谁也过不去</b>。被堵住了就打，或者绕别的路。',
      '敲头要<b>紧挨着</b>才打得中。打空会僵住一下，所以先骗对手打空，再给他一下！',
      '在窝里不能敲别人，也不会被敲。',
    ],
    hint: '移动 WASD · 方向键 · 点击 &nbsp;|&nbsp; 敲头 Space',
    lobby: '回大厅',
    again: '再来一局',
    bonk: '敲头',
    sound: '声音',
    kinds: {
      human: '玩家（我）',
      'bot:easy': '电脑 · 简单',
      'bot:normal': '电脑 · 普通',
      'bot:hard': '电脑 · 困难',
      closed: '关闭',
      open: '开放 · 联机（筹备中）',
    },
    names: ['我', '云朵', '巧克', '灰灰'],
    slotName: (n) => `${n}号位名字`,
    slotKind: (n) => `${n}号位类型`,
    fallbackName: (n) => `仓鼠${n}`,
    go: '出发!',
    bonkWord: '咚!',
    seedGot: '叼到瓜子!',
    home: '窝',
    lostSeed: '瓜子丢了！再去向日葵那儿！',
    gotSeedMe: '🌻 叼到瓜子了！快跑回窝！',
    gotSeedOther: (name) => `🌻 ${name}叼到瓜子了！拦住它！`,
    winMe: '🎉 我赢了！',
    winOther: (name) => `🏆 ${name}赢了`,
    columns: ['敲头', '被敲', '瓜子', '累计胜场'],
    tally: (n) => `${n}胜`,
  },

  'zh-Hant': {
    description: '叼著瓜子第一個回到窩裡就贏的倉鼠心理戰遊戲。',
    tagline: '叼著瓜子<b>第一個回到窩裡</b>就贏！挨一下敲頭，誰都得空手回窩。',
    players: '參加者',
    start: '開始遊戲',
    needOpponent: '至少需要一個對手',
    howto: '玩法',
    how: [
      `<b>移動</b> WASD · 方向鍵 · 滑鼠點擊 ${TOUCH('拖曳畫面')}`,
      `<b>敲頭</b> Space · 點擊對手倉鼠 ${TOUCH('敲頭按鈕')}`,
      '在向日葵旁<b>站著不動2秒</b>就能叼到瓜子。一次只能一隻！移動或敲頭就要重新開始。',
      '叼著瓜子進到窩裡就贏。',
      '路只有一隻倉鼠寬，<b>誰也過不去</b>。被堵住了就打，或者繞別的路。',
      '敲頭要<b>緊挨著</b>才打得中。打空會僵住一下，所以先騙對手打空，再給他一下！',
      '在窩裡不能敲別人，也不會被敲。',
    ],
    hint: '移動 WASD · 方向鍵 · 點擊 &nbsp;|&nbsp; 敲頭 Space',
    lobby: '回大廳',
    again: '再來一局',
    bonk: '敲頭',
    sound: '聲音',
    kinds: {
      human: '玩家（我）',
      'bot:easy': '電腦 · 簡單',
      'bot:normal': '電腦 · 普通',
      'bot:hard': '電腦 · 困難',
      closed: '關閉',
      open: '開放 · 連線（籌備中）',
    },
    names: ['我', '雲朵', '巧克', '灰灰'],
    slotName: (n) => `${n}號位名字`,
    slotKind: (n) => `${n}號位類型`,
    fallbackName: (n) => `倉鼠${n}`,
    go: '出發!',
    bonkWord: '咚!',
    seedGot: '叼到瓜子!',
    home: '窩',
    lostSeed: '瓜子掉了！再去向日葵那兒！',
    gotSeedMe: '🌻 叼到瓜子了！快跑回窩！',
    gotSeedOther: (name) => `🌻 ${name}叼到瓜子了！攔住牠！`,
    winMe: '🎉 我贏了！',
    winOther: (name) => `🏆 ${name}贏了`,
    columns: ['敲頭', '被敲', '瓜子', '累計勝場'],
    tally: (n) => `${n}勝`,
  },
};

// Only the browser's first language counts: anything that is not Korean,
// Japanese or Chinese gets English.
export function pickLanguage(tag) {
  const l = String(tag || '').toLowerCase();
  if (l.startsWith('ko')) return 'ko';
  if (l.startsWith('ja')) return 'ja';
  if (l.startsWith('zh')) return !l.includes('hans') && /hant|-(tw|hk|mo)\b/.test(l) ? 'zh-Hant' : 'zh-Hans';
  return 'en';
}

function detect() {
  if (typeof location !== 'undefined') {
    const forced = new URLSearchParams(location.search).get('lang');
    if (forced) return STRINGS[forced] ? forced : pickLanguage(forced);
  }
  return pickLanguage(typeof navigator !== 'undefined' ? navigator.language : 'en');
}

export const lang = detect();
const table = STRINGS[lang];

// t('start'), or t('winOther', name) for entries that take arguments.
export function t(key, ...args) {
  const v = table[key];
  return typeof v === 'function' ? v(...args) : v;
}

export const LANGUAGES = Object.keys(STRINGS);
export const stringsFor = (code) => STRINGS[code];
