# Hash Rush desktop (Electron)

The web game in a desktop window, the first step toward Steam.

```bash
npm install
npm start          # runs the game from the repository root
npm run dist:mac   # unpacked app in dist/ (also dist:win, dist:linux)
```

- Files are served as `app://hash-rush/…` (ES modules don't load from `file://`).
  A packaged build carries the game in `resources/game`.
- The page sees `window.hashRushDesktop` (`src/client/desktop.js`): no service
  worker or update checks (Steam updates the app), and invite links point at the
  web game.
- F11 or Alt+Enter toggles fullscreen. F12 opens DevTools outside packaged builds.
- Web links open in the system browser.
- `dist:mac` skips signing for local builds. Signing and notarizing come with the Steam build.
