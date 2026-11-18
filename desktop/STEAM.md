# Releasing Hash Rush on Steam

What the code already does, and what has to be set up on the Steamworks site.

## In the code

- **Desktop app** (Electron, `desktop/`): `npm run dist:all` builds
  `dist/win-unpacked`, `dist/linux-unpacked` and `dist/mac-universal`.
- **Steam** (`steam.cjs`, steamworks.js): the Steam name becomes the player's default
  name, achievements unlock at the end of a round, Rich Presence `status` shows the
  map being played, and the Steam overlay is on. Without Steam the game runs the same.
- **Controller**: the left stick or D-pad steers, A/RB bonks, B/X/LB throws. Outside a
  round the D-pad moves through the menus, A presses, B and Start work like Escape.
- **Saves**: `localStorage` lives in the app's user data folder (below), which
  Steam Auto-Cloud can sync.

## Steamworks site checklist

1. **App ID**: put it in `steam.cjs` (`APP_ID`, now 480 = Valve's test app) and in
   `steampipe/app_build.vdf`. Put the depot ids in `steampipe/depot_*.vdf`.
2. **Achievements** (Stats & Achievements → Achievements), API names exactly:

   | API name | Name | How |
   | --- | --- | --- |
   | `WIN_FIRST` | First Seed Home | Win a round |
   | `WIN_10` | Seed Collector | Win 10 rounds |
   | `WIN_50` | Sunflower Tycoon | Win 50 rounds |
   | `WIN_TEAM` | Team Player | Win a team round |
   | `WIN_VS_PEOPLE` | Hamster vs Hamster | Win a round with another person in it |
   | `WIN_MAP_MEADOW` … `WIN_MAP_SKY` | (one per map) | Win on that map: meadow, desert, factory, ice, beach, graveyard, sky |
   | `WIN_ALL_MAPS` | World Tour | Win on every map |

   Each also needs a locked and an unlocked icon (64×64 JPG).
3. **Rich Presence**: add a localization token file with `#Status_Lobby` etc. if you
   want `steam_display`. As is, the `status` key shows in the friends list.
4. **Steam Cloud** (Auto-Cloud): set a root and path:
   - Windows: `WinAppDataRoaming` / `Hash Rush/`
   - macOS: `MacAppSupport` / `Hash Rush/`
   - Linux: `LinuxXdgConfigHome` / `Hash Rush/`

   Pattern `*`, recursive. The quota can stay small (a few MB).
5. **Launch options** (Installation → General):
   - Windows: `Hash Rush.exe`
   - macOS: `Hash Rush.app`
   - Linux: `hash-rush-desktop`
6. **Controller**: set the controller support level to *Full*. Under Steam Input, pick
   "gamepad" as the default configuration.
7. **Upload**: install steamcmd, then run `STEAM_USER=<account> npm run steam:upload`
   after `npm run dist:all`. Set the build live on a beta branch first and try it.

## Still to do before the release

- **macOS signing and notarization**: the mac build is unsigned now (`dist:mac` skips
  it). This needs a Developer ID Application certificate.
- **Windows signing**: optional, but SmartScreen warns about unsigned exe files.
- **Store page**: capsules, screenshots, trailer, description, IARC rating, price.
- **Online play from Steam**: invites still go through the web link. Steam lobby
  invites (`matchmaking`) are a later step.
