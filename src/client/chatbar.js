// The chat as it looks on every page that has one: lines float up from the corner
// of the screen and fade, and there is one place to type, a bar across the bottom
// that sits on top of a phone's keyboard the way a messenger's does. While it is
// open the whole conversation so far shows above it. Enter or the chat button
// opens it; Enter on an empty bar or Escape closes it. What was typed stays in the
// box for next time.

export const cleanChat = (raw) => String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 80);

const onPhone = () => matchMedia('(pointer: coarse)').matches;

function stamp(at) {
  const time = document.createElement('time');
  const d = new Date(at || Date.now());
  time.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return time;
}

// One line in the conversation: { name, text, color, sys, at }. A line with
// `sys` has no speaker (somebody came in, the connection failed).
function historyLine({ name, text, color, sys, at }) {
  const line = document.createElement('div');
  if (sys) line.className = 'sys';
  if (sys) line.append(stamp(at), text);
  else {
    const who = document.createElement('b');
    who.textContent = name;
    if (color) who.style.color = color;
    line.append(stamp(at), who, ` ${text}`);
  }
  return line;
}

// A line floating up over the screen in `log` (a .chatLog), fading away on its own.
export function floatLine(log, { name, text, color, sys }) {
  const line = document.createElement('div');
  if (sys) {
    line.className = 'sys';
    line.append(text);
  } else {
    const who = document.createElement('b');
    who.textContent = String(name);
    if (color) who.style.color = color;
    line.append(who, ` ${text}`);
  }
  log.append(line);
  line.addEventListener('animationend', () => line.remove());
  while (log.children.length > 12) log.firstChild.remove();
}

// Builds the bar, its button and the floating log (#lobbyChat) on this page.
//   send(text)    says a line
//   lines()       the conversation so far, shown while typing
//   quick         ready-made lines, one tap each
//   empty         what the open bar shows while nothing has been said yet
//   openers       ids of other buttons that open and close the bar
//   enterOpens()  whether Enter on the page opens the bar right now
export function createChat({ send, lines, quick = [], placeholder = '', empty = '', title = '', openers = [], enterOpens = () => true }) {
  const $ = (id) => document.getElementById(id);
  const float = document.createElement('div');
  float.id = 'lobbyChat';
  float.className = 'chat';
  float.hidden = true;
  float.innerHTML = '<div class="chatLog"></div>';
  document.body.append(float);

  const bar = document.createElement('form');
  bar.id = 'chatBar';
  bar.className = 'chatForm';
  bar.hidden = true;
  const row = document.createElement('div');
  row.className = 'quick';
  for (const said of quick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = said;
    // A tap must not take the focus, or the keyboard would drop.
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => send(said));
    row.append(b);
  }
  const field = document.createElement('input');
  Object.assign(field, { name: 'chat', maxLength: 80, autocomplete: 'off', enterKeyHint: 'send', placeholder });
  const go = document.createElement('button');
  go.textContent = '↑';
  // The whole conversation so far, above the ready-made lines, while typing.
  const history = document.createElement('div');
  history.id = 'chatHistory';
  bar.append(history, ...(quick.length ? [row] : []), field, go);
  document.body.append(bar);
  const fab = document.createElement('button');
  fab.id = 'chatFab';
  fab.type = 'button';
  fab.hidden = true;
  fab.textContent = '💬';
  if (title) fab.title = fab.ariaLabel = title;
  document.body.append(fab);

  // The log over the keyboard is see-through and fades once nothing has been said
  // or touched for a while; a touch brings it back.
  let historyTimer = 0;
  const wake = () => {
    history.classList.remove('dim');
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => history.classList.add('dim'), 14000);
  };
  history.addEventListener('pointerdown', wake);
  history.addEventListener('scroll', wake, { passive: true });

  let barTimer = 0;
  // A phone also scrolls the page about as its keyboard comes and goes, and the
  // screen jerks with it. The page stays where it was from the moment the bar
  // opens until the keyboard has gone down again.
  let keepY = null;
  let keepTimer = 0;
  window.addEventListener(
    'scroll',
    () => {
      if (keepY !== null && Math.abs(window.scrollY - keepY) > 1) window.scrollTo(window.scrollX, keepY);
    },
    { passive: true },
  );
  function toggle(open) {
    if (bar.hidden === !open) {
      if (open && document.activeElement !== field) field.focus();
      return;
    }
    bar.hidden = !open;
    document.body.classList.toggle('chatting', open);
    clearTimeout(barTimer);
    clearTimeout(keepTimer);
    if (!open) {
      field.blur();
      keepTimer = setTimeout(() => (keepY = null), 800);
      return;
    }
    if (onPhone()) keepY ??= window.scrollY;
    const said = lines();
    history.replaceChildren(...said.map(historyLine));
    if (!said.length && empty) {
      const hint = historyLine({ text: empty, sys: true });
      hint.classList.add('empty');
      history.append(hint);
    }
    history.scrollTop = history.scrollHeight;
    wake();
    // A phone slides the whole page up when the box being typed in would end up
    // under its keyboard. So the bar starts high on the screen, where no keyboard
    // reaches, and only comes down onto the keyboard once that is up. Up there it
    // is not drawn, so all anyone sees is the bar arriving on the keyboard.
    bar.classList.toggle('rising', onPhone());
    if (onPhone()) {
      bar.style.bottom = 'auto';
      bar.style.top = `${Math.round(window.innerHeight * 0.2)}px`;
      barTimer = setTimeout(() => seat(true), 700);
    } else seat(true);
    field.focus();
    // A phone may refuse to bring up a keyboard; then there is no bar either.
    if (document.activeElement !== field) toggle(false);
  }

  // Sits the bar on the bottom of what can be seen: the top of the keyboard.
  function seat(now) {
    const vv = window.visualViewport;
    if (bar.hidden) return;
    const seen = vv ? vv.offsetTop + vv.height : window.innerHeight;
    // Until the keyboard has come up there is nothing to sit on yet.
    if (now !== true && bar.classList.contains('rising') && vv && vv.height > window.innerHeight - 80) return;
    clearTimeout(barTimer);
    bar.classList.remove('rising');
    // Held by its foot, so that whatever grows on top of it grows upwards, away
    // from the keyboard.
    bar.style.top = 'auto';
    bar.style.bottom = `${Math.max(0, Math.round(document.documentElement.clientHeight - seen))}px`;
  }
  if (window.visualViewport) for (const type of ['resize', 'scroll']) window.visualViewport.addEventListener(type, seat);
  window.addEventListener('resize', seat);

  // On a phone the bar is up exactly while its box has the keyboard: whatever takes
  // the focus away puts it away too, so it never lingers without one.
  field.addEventListener('blur', () => {
    if (!onPhone()) return;
    setTimeout(() => {
      if (document.activeElement !== field) toggle(false);
    }, 0);
  });
  // The send key must not take the focus, or the keyboard would drop after each line.
  go.addEventListener('pointerdown', (e) => e.preventDefault());
  // On a phone a touch anywhere else puts the keyboard away, and does nothing else.
  const openerIds = ['chatFab', ...openers];
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!onPhone() || bar.hidden || bar.contains(e.target) || openerIds.includes(e.target.id)) return;
      toggle(false);
      e.stopPropagation();
    },
    true,
  );
  bar.addEventListener('submit', (e) => {
    e.preventDefault();
    // An empty line closes the bar.
    if (!cleanChat(field.value)) {
      toggle(false);
      return;
    }
    send(field.value);
    field.value = '';
  });
  field.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') toggle(false);
  });
  for (const id of openerIds) $(id).addEventListener('click', () => toggle(bar.hidden));
  // Enter opens the bar anywhere, the way it does in most games.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Enter' || !enterOpens()) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLAnchorElement) return;
    e.preventDefault();
    toggle(true);
  });

  return {
    toggle,
    // A line just said: added to the conversation showing above the bar.
    heard(line) {
      if (bar.hidden) return;
      history.querySelector('.empty')?.remove();
      history.append(historyLine(line));
      history.scrollTop = history.scrollHeight;
      wake();
    },
  };
}
