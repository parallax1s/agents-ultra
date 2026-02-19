# Agents Ultra

Factorio-style agent playground focused on a playable vertical slice.

## Vertical Slice Overview
This slice is centered on core placement interactions in a browser sandbox:
- Select a build item from slots `1` to `4`
- Rotate placement direction before placing
- Place and remove structures on the grid
- Pause and resume the simulation loop

The current slice is intentionally limited and does not yet include full logistics/economy systems.

## Prerequisites
- Node.js `20+`
- npm (bundled with Node.js)

## Setup
```bash
npm install
```

## Run (Development)
```bash
npm run dev
```
Then open: `http://localhost:5173`

## Build
```bash
npm run build
```

## Test and Typecheck
```bash
npm run test
npm run typecheck
```

## Controls
- `1` / `2` / `3` / `4`: select build slot
- `R`: rotate selected building orientation
- `LMB` (left mouse button): place
- `RMB` (right mouse button): remove
- `Space`: pause/resume

## Known Limitations
- No power system yet
- No splitters yet

## Troubleshooting
- `npm: command not found`: reinstall Node.js `20+` and confirm with `node -v` and `npm -v`.
- Port `5173` already in use: stop the conflicting process or run with a different Vite port.
- Right-click does not remove: ensure the browser is focused on the game canvas (some browser/OS context menu behaviors can interfere).
