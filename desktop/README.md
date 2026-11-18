# Hash Rush desktop (Electron)

The web game in a desktop window, the first step toward Steam.

```bash
npm install
npm start          # runs the game from the repository root
npm run dist:all   # Windows, Linux and macOS (universal) apps in dist/
```

- Files are served as `app://hash-rush/…` (ES modules don't load from `file://`).
  A packaged build carries the game in `resources/game`.
- The page sees `window.hashRushDesktop` (`src/client/desktop.js`): no service
  worker or update checks (Steam updates the app), and invite links point at the
  web game.
- F11 or Alt+Enter toggles fullscreen. F12 opens DevTools outside packaged builds.
- Web links open in the system browser.
- Steam: name, achievements, Rich Presence and the overlay (`steam.cjs`). A controller works in rounds and menus.
- `dist:mac` skips signing for local builds.
- The Steam release steps are in [STEAM.md](STEAM.md).
