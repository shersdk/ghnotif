# GH Notify

A minimal, lightweight desktop app that watches a GitHub repository and notifies you the moment anyone commits, even while it runs quietly in the background.

Built with [Tauri 2](https://tauri.app) and vanilla TypeScript, with an Apple-style liquid-glass dark UI. No account, no login, no database. Just paste a repo and go.

I built this for myself. I was refreshing a repository over and over waiting for a push, and I wanted a tiny thing sitting in the tray that would tell me the second a new commit landed so I could stop checking.

## Features

- **Instant commit notifications** - native system notification plus an animated in-app row for every new commit on any branch.
- **Runs in the background** - minimize to the system tray and keep polling while you work.
- **Zero-login** - watch any public repo instantly; private repos and a higher rate limit are one optional token away.
- **Tracks all branches** - detects pushes to any branch, not just the default.
- **Liquid-glass dark UI** - translucent window with acrylic/mica backdrop, hairline commit rows, and spring-based animations.
- **Persists watched repos** - your watch list and last-known commits survive restarts.
- **Tiny footprint** - a single ~5 MB native binary, far lighter than Electron.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [Rust](https://rustup.rs) (stable toolchain)
- Platform webview: WebView2 (Windows), WebKitGTK (Linux), WKWebView (macOS) — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Install & run (dev)

```bash
npm install
npm run tauri dev
```

The app opens with an empty feed. Enter a repository — `owner/repo` or a full `https://github.com/owner/repo` URL — and press the **+** button to start watching.

### Build an installer

```bash
npm run tauri build
```

The output binary/installer is written to `src-tauri/target/release/bundle/`. Installing it registers the app's notification identity (so toasts show **GH Notify** instead of a terminal name).

## Usage

| Action | How |
|--------|-----|
| Watch a repo | Type `owner/repo` or a GitHub URL, press **+** |
| Stop watching | Hover a repo's section header and press **✕** |
| Keep checking in background | Close the window — it hides to the tray and keeps polling |
| Open the window again | Tray icon → **Show** |
| Quit | Tray icon → **Quit** |

### Private repos & rate limits

Public repos work with no login. The unauthenticated GitHub API is capped at **60 requests/hour** — plenty for a few repos at the default 60-second poll.

For private repos or heavier polling, add a personal access token to `localStorage`:

```js
localStorage.setItem("ghnotif.token", "github_pat_...")
```

(Or set `ghnotif.token` via the browser console in the app's devtools.)

### Polling interval

The app polls every **60 seconds** by default. Adjust `POLL_MS` in [`src/main.ts`](src/main.ts).

## Architecture

```
ghnotif/
├── src/                  # Frontend (vanilla TS + CSS)
│   ├── main.ts           # UI, polling loop, notifications
│   ├── styles.css        # Apple-style liquid-glass dark theme
│   └── lib/
│       ├── api.ts        # GitHub REST client (branches, commits)
│       ├── store.ts      # localStorage persistence
│       └── types.ts      # Shared types
├── src-tauri/            # Rust shell
│   └── src/lib.rs        # Tray, acrylic window, notification log
└── app-icon.svg          # Source icon
```

### How commit detection works

1. On watch, the app snapshots the current head commit of every branch.
2. Every 60s it fetches fresh commits per branch and diffs against the snapshot.
3. Any commits newer than the snapshot trigger a notification and an animated row, then the snapshot advances.
4. Diagnostics are appended to `%APPDATA%/com.ghnotif.app/ghnotif.log`.

## Tech Stack

- [Tauri 2](https://tauri.app) — tiny native cross-platform shell
- Vanilla TypeScript + Vite — no heavy frontend framework
- GitHub REST API — public, no auth required
- [`window-vibrancy`](https://crates.io/crates/window-vibrancy) — acrylic/mica translucency

## Roadmap

- [ ] Optional token input in the UI (no console needed)
- [ ] Webhook-based instant pushes (instead of polling)
- [ ] Notification click opens the commit on GitHub

## License

MIT
