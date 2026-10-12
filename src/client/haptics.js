// A buzz in the hand for what a key would have told the fingers: that the press
// went in, that the bonk landed, that one landed on you. Glass says none of it.
//
// Android has a vibration call. iPhones have none for web pages, but their switch
// control ticks when it is flipped, so a hidden one is flipped instead; that gives
// one kind of tick and no more.

const STORE = 'hash-rush-buzz';

export function createHaptics() {
  const vibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  const apple = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  let on = true;
  try {
    on = localStorage.getItem(STORE) !== '0';
  } catch {
    // storage is blocked: it stays on
  }
  let flip = null;

  function tick() {
    if (!flip) {
      flip = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.setAttribute('switch', '');
      flip.append(box);
      flip.style.cssText = 'position:fixed;left:-99px;top:0;opacity:0;pointer-events:none';
      flip.setAttribute('aria-hidden', 'true');
      document.body.append(flip);
    }
    flip.click();
  }

  return {
    supported: vibrate || apple,
    enabled: () => on,
    // `pattern` is milliseconds, the way navigator.vibrate takes them.
    buzz(pattern) {
      if (!on) return;
      try {
        if (vibrate) navigator.vibrate(pattern);
        else if (apple) tick();
      } catch {
        // no buzz, then
      }
    },
    toggle() {
      on = !on;
      try {
        localStorage.setItem(STORE, on ? '1' : '0');
      } catch {
        // not remembered
      }
      return on;
    },
  };
}
