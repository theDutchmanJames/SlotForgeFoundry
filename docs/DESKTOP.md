# Desktop app

Foundry ships as a desktop app for Windows, macOS and Linux, like the other
SlotForge apps. The app itself is the same single page the browser edition
uses (`dist/index.html`); `desktop/main.cjs` shows it in its own window.

## Downloads

| Copy | File | Built |
| --- | --- | --- |
| Windows installer | `SlotForgeFoundry-X.Y.Z-Setup-x64.exe` | here: `npm run dist:win` |
| Windows portable app | `SlotForgeFoundry-X.Y.Z-Portable-x64.exe` | here: `npm run dist:win` |
| macOS (Apple silicon and Intel) | `SlotForgeFoundry-X.Y.Z-mac-universal.dmg` and `.zip` | GitHub CI |
| Linux AppImage (portable) | `SlotForgeFoundry-X.Y.Z-linux-x86_64.AppImage` (and `arm64`) | GitHub CI |
| Linux .deb | `SlotForgeFoundry-X.Y.Z-linux-amd64.deb` (and `arm64`) | GitHub CI |

Output: `dist/desktop/vX.Y.Z/`. The builds are not signed, as with the other
SlotForge apps (Windows may show SmartScreen; macOS needs right-click → Open
the first time).

**macOS and Linux** are built by `.github/workflows/native-release.yml` when a
GitHub release is published (or by hand, with a tag). It runs the unit tests
and the desktop tests on each system, builds, writes checksums and attaches
the files to the release without replacing any that are there.

## Where the data lives

Everything (Library, autosave, settings, Planner cache) is in the app's
browser profile:

- **Installed:** Electron's folder for the app (`%APPDATA%\SlotForge Foundry`,
  `~/Library/Application Support/SlotForge Foundry`, `~/.config/SlotForge Foundry`).
- **Portable** (the portable .exe, an AppImage, a Mac copy outside
  Applications): a `SlotForge Foundry Data` folder beside the program.
- **Tests and advanced use:** `--portable-data-dir=<folder>` or
  `SLOTFORGE_DATA_DIR`.

The desktop app keeps its own Library, apart from the browser edition's. To
bring packs, layouts and STL parts across, back up the Library in one and
restore it in the other.

Help → Show data folder opens it.

## Update check

The SlotForge update check, copied from Circuit as it is
(`desktop/update-check.cjs`, `src/update-ui.js`, `src/update-window.css`; see
Circuit's `docs/update-check-handoff.md`). Foundry's names: `appName`
Foundry, `artifactPrefix` SlotForgeFoundry, `userAgent` SlotForge-Foundry, the
repository from `homepage` in `package.json`. The Restyle basics the window
sits on are in `src/update-basics.css`, scoped to the window and the
Settings → Updates card.

The browser edition has no update check (it never contacts GitHub).
Release notes: see `docs/releases/README.md` for the "What's new" section.

## Tests

- `npm test` includes `desktop/*.test.cjs` (update check, data location).
- `npm run test:desktop`: starts the app twice on a throwaway portable folder
  and checks Home, the packs, the desktop bridge, no console errors and that
  saved data survives a restart.
- `npm run test:desktop-ui`: the update window with a fake GitHub answer
  (What's new, Download into a folder with its checksum, Skip, Check now,
  Settings → Updates). `SLOTFORGE_UI_SHOTS=<folder>` saves pictures.

Run `npm run build` before the desktop tests.
