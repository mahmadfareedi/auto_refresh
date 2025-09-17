# Refresh App Chrome Extension

Lightweight controls for cache-busting reloads and per-tab auto refresh timers.

## Quick Start

1. Open Chrome and go to `chrome://extensions`.
2. Toggle **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select this project folder.
4. Pin the "Refresh App" icon so the popup is always one click away.

## Using The Popup

- **Hard Refresh** — Clears cache storage first, then reloads the active tab with `bypassCache` enabled. Useful when a deploy isn’t showing up.
- **Normal Refresh** — Performs the standard browser reload while keeping cache intact.
- **Auto Refresh** — Enter an interval (seconds) or choose a preset, then press *Start Auto Refresh*. The toolbar badge shows a live countdown for that tab and resets after each automatic reload. Stop it anytime and the badge disappears.

> Tip: Auto refresh runs only on pages that allow injected scripts (no effect on Chrome Web Store or `chrome://` URLs).

## Developer

Built by [meltadata.io](https://meltadata.io).

If Chrome prompts for permissions, accept them so the extension can clear cache, talk to the active tab, and remember your auto-refresh preferences.
