// The chat as it looks on every page that has one: lines float up from the corner
// of the screen, then fade to a faint trace for a few seconds, and there is one
// place to type, a bar across the bottom that sits on top of a phone's keyboard the way a messenger's does. While it is
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

// How long a line stays up in a bubble over its speaker: longer lines get longer
// to be read.
export const lineLife = (text) => 6000 + 80 * String(text || '').length;

// A floating line is crisp for a few seconds, three at most at a time, then
// lingers faint as long again: still there to be touched (see browse below) for
// the whole conversation, without opening the bar and its keyboard, and soon
// out of the way of whatever it covers.
const CRISP = 5000;
const CRISP_MAX = 3;
const FAINT = 5000;
const FLOAT_MAX = 8;

// A line floating up over the screen in `log` (a .chatLog), crisp for `ms`.
export function floatLine(log, { name, text, color, sys }, ms = CRISP) {
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
  setTimeout(() => line.classList.add('faint'), ms);
  setTimeout(() => line.remove(), ms + FAINT);
  // Being read back (see browse below), the log keeps everything.
  if (log.closest('.browse')) return;
  const crisp = [...log.children].filter((el) => !el.classList.contains('faint'));
  for (const el of crisp.slice(0, -CRISP_MAX)) el.classList.add('faint');
  while (log.children.length > FLOAT_MAX) log.firstChild.remove();
}

// Builds the bar, its button and the floating log (#lobbyChat) on this page.
//   send(text)    says a line
//   lines()       the conversation so far, shown while typing
//   quick         ready-made lines, one tap each
//   empty         what the open bar shows while nothing has been said yet
//   openers       ids of other buttons that open and close the bar
//   enterOpens()  whether Enter on the page opens the bar right now
//   logs          ids of other floating logs, refilled like #lobbyChat on closing
export function createChat({ send, lines, quick = [], placeholder = '', empty = '', title = '', openers = [], enterOpens = () => true, logs = [] }) {
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
  // More lines than fit: the row slides sideways, and its far edge fades while
  // there is more to see that way. A mouse wheel slides it too.
  const more = () => row.classList.toggle('more', row.scrollLeft + row.clientWidth < row.scrollWidth - 4);
  row.addEventListener('scroll', more, { passive: true });
  row.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      row.scrollLeft += e.deltaY;
    },
    { passive: false },
  );
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
  // The log is not part of the box: a tap on it puts the keyboard away like a tap
  // anywhere else would, while a drag still scrolls it.
  let tapAt = null;
  history.addEventListener('pointerdown', (e) => (tapAt = { x: e.clientX, y: e.clientY }));
  history.addEventListener('pointerup', (e) => {
    if (onPhone() && tapAt && Math.hypot(e.clientX - tapAt.x, e.clientY - tapAt.y) < 10) toggle(false);
    tapAt = null;
  });
  history.addEventListener('pointercancel', () => (tapAt = null));

  // Once the keyboard is down the last few lines float up again, crisp for a few
  // seconds however old, so what was just read does not vanish at once.
  // A touch on a floating line opens the whole conversation in its place, to
  // scroll back through without the keyboard. Only a touch that lands on a line
  // does: the map around and under it is still the game's, for swipes and taps.
  // It folds back to the last few lines on another tap, inside it or anywhere
  // else, or once left alone for a while.
  let browsing = null;
  let browseTimer = 0;
  const stayBrowsing = () => {
    clearTimeout(browseTimer);
    browseTimer = setTimeout(stopBrowsing, 8000);
  };
  function stopBrowsing() {
    if (!browsing) return;
    clearTimeout(browseTimer);
    browsing.classList.remove('browse');
    browsing = null;
    refloat();
  }
  for (const log of [float, ...logs.map($)]) {
    const box = log?.querySelector('.chatLog');
    if (!box) continue;
    const open = () => {
      stopBrowsing();
      browsing = log;
      log.classList.add('browse');
      box.replaceChildren(...lines().map(historyLine));
      box.scrollTop = box.scrollHeight;
    };
    // Open, a tap on it folds it again; a slide is a scroll and leaves it open.
    let tap = null;
    // A slide that starts on the folded lines opens them and scrolls at once,
    // the way anyone tries to: the page cannot scroll a log that was not yet
    // scrollable when the finger came down, so this one finger scrolls it by hand.
    let drag = null;
    box.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      stayBrowsing();
      if (browsing === log) {
        tap = { id: e.pointerId, x: e.clientX, y: e.clientY, top: box.scrollTop };
        return;
      }
      tap = null;
      open();
      drag = { id: e.pointerId, y: e.clientY };
      try {
        box.setPointerCapture(e.pointerId);
      } catch {
        // scrolled while over the log only
      }
    });
    box.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId || browsing !== log) return;
      box.scrollTop -= e.clientY - drag.y;
      drag.y = e.clientY;
    });
    // A mouse wheel over the folded lines does the same.
    box.addEventListener(
      'wheel',
      (e) => {
        if (browsing === log) return stayBrowsing();
        e.preventDefault();
        stayBrowsing();
        open();
        box.scrollTop += e.deltaY;
      },
      { passive: false },
    );
    box.addEventListener('scroll', () => browsing === log && stayBrowsing(), { passive: true });
    box.addEventListener('pointerup', (e) => {
      if (drag && drag.id === e.pointerId) drag = null;
      const was = tap;
      tap = null;
      if (!was || was.id !== e.pointerId || browsing !== log) return;
      if (Math.hypot(e.clientX - was.x, e.clientY - was.y) < 10 && Math.abs(box.scrollTop - was.top) < 4) stopBrowsing();
    });
    box.addEventListener('pointercancel', () => {
      tap = null;
      drag = null;
    });
  }
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (browsing && !browsing.contains(e.target)) stopBrowsing();
    },
    true,
  );

  function refloat() {
    const recent = lines().slice(-3);
    for (const log of [float, ...logs.map($)]) {
      const box = log?.querySelector('.chatLog');
      if (!box) continue;
      box.textContent = '';
      for (const line of recent) floatLine(box, line);
    }
  }

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
  // Nor may a finger drag the page about under the keyboard: held in place by
  // the line above, it would stick and shake, the bar with it. Only the log and
  // the row of ready-made lines scroll, and the log not past its ends, where the
  // drag would pass on to the page.
  let fingerY = 0;
  window.addEventListener('touchstart', (e) => (fingerY = e.touches[0]?.clientY || 0), { passive: true });
  window.addEventListener(
    'touchmove',
    (e) => {
      if (bar.hidden || !e.cancelable) return;
      const y = e.touches[0]?.clientY || 0;
      const up = y < fingerY;
      fingerY = y;
      if (row.contains(e.target)) return;
      if (history.contains(e.target)) {
        const atTop = history.scrollTop <= 0;
        const atEnd = history.scrollTop + history.clientHeight >= history.scrollHeight - 1;
        if ((up && !atEnd) || (!up && !atTop)) return;
      }
      e.preventDefault();
    },
    { passive: false },
  );
  function toggle(open) {
    if (open) {
      clearTimeout(browseTimer);
      browsing?.classList.remove('browse');
      browsing = null;
    }
    if (bar.hidden === !open) {
      if (open && document.activeElement !== field) field.focus();
      return;
    }
    bar.hidden = !open;
    if (open) requestAnimationFrame(more);
    document.body.classList.toggle('chatting', open);
    clearTimeout(barTimer);
    clearTimeout(keepTimer);
    if (!open) {
      field.blur();
      refloat();
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
    // With a keyboard of its own, the bar goes once the line is sent, so the keys
    // move the hamster again at once; Enter opens it for the next line. A phone
    // keeps it up for the next line instead.
    if (!onPhone()) toggle(false);
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
    // The conversation changed under it (somebody renamed): shown again as it is now.
    redraw() {
      const boxes = [...(bar.hidden ? [] : [history]), ...(browsing ? [browsing.querySelector('.chatLog')] : [])];
      for (const box of boxes) {
        const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
        const top = box.scrollTop;
        box.replaceChildren(...lines().map(historyLine));
        box.scrollTop = atEnd ? box.scrollHeight : top;
      }
    },
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
