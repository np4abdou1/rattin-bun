# rattin

Stream torrents from the terminal. Search TMDB, pick a torrent, watch with MPV.

A TypeScript port of [np4abdou1/rattin](https://github.com/np4abdou1/rattin), running on **Node.js + tsx** with **WebTorrent 2.x**.

## Usage

```bash
npx tsx src/index.ts
# or with a direct query
npx tsx src/index.ts "the matrix"
# check dependencies
npx tsx src/index.ts --deps
```

Or via npm scripts:

```bash
npm start                  # tsx src/index.ts
npm run deps               # check dependencies
```

## Install

```bash
npm install
```

### Dependencies

- **Node.js** >= 20 (runs via `tsx` for TypeScript)
- **mpv** — video player
- **fzf** — fuzzy finder

```bash
# Ubuntu/Debian
sudo apt install mpv fzf

# macOS
brew install mpv fzf

# Arch
sudo pacman -S mpv fzf
```

## Setup

Set your TMDB API key (free at [themoviedb.org](https://www.themoviedb.org/settings/api)):

```bash
export TMDB_API_KEY="your_key_here"
```

Or put it in a `.env` file in the project root:

```
TMDB_API_KEY=your_key_here
```

## Flow

1. **Search** — type a movie or TV show name
2. **Select** — pick from TMDB results via fzf
3. **For TV shows** — select season, then episode
4. **Pick torrent** — scored and sorted by quality, seeders, size
5. **Watch** — streams via WebTorrent into MPV

## How it works

- **TMDB** for metadata (search, seasons, episodes, ratings, imdb ids)
- **Torrentio** as primary source (best curated results, needs imdb id)
- **TPB, EZTV, YTS, Nyaa** as fallback providers
- **WebTorrent 2.x** for P2P streaming with adaptive piece prioritization
- **MPV** for playback (hardware-accelerated, all formats)
- **fzf** for fuzzy selection UI

Torrents are scored by title match, resolution, source quality, seeders,
and file size. Everything streams to a temp directory — nothing persists.

## Why Node.js + WebTorrent 2.x (not Bun + WebTorrent 3.x)?

The original rattin used Node.js + WebTorrent 3.x. This port initially tried
**Bun + WebTorrent 3.x**, but hit two show-stopping bugs:

1. **Bun crash** — WebTorrent 3.x's native module `node-datachannel` calls
   `uv_timer_init` (a libuv function). Bun doesn't support this yet
   ([oven-sh/bun#18546](https://github.com/oven-sh/bun/issues/18546)), causing
   a hard `SIGILL` crash during `client.add()`.

2. **WebTorrent 3.x null-piece crash** — even on Node.js, WebTorrent 3.x has a
   bug where `torrent.pieces[i]` entries become null during the piece
   reservation loop, crashing `_request` → `_updateWire` → `_update` and
   stalling all downloads.

**The fix:** Run on **Node.js via tsx** (full libuv support) and use
**WebTorrent 2.x** (pure JavaScript, no native modules, no null-piece bug).
Verified end-to-end: 129 MB Sintel torrent downloads in ~30s with 20+ peers,
HTTP range requests serve exact byte counts, MPV-compatible `video/mp4` stream.

## Project structure

```
src/
├── index.ts          # CLI entry point (commander + main flow)
├── deps.ts           # mpv/fzf dependency checker
├── tmdb.ts           # TMDB API client (+ imdb id fetch)
├── torrent.ts        # multi-provider search + scoring + magnet builder
├── fzf.ts            # fzf subprocess wrapper
├── ui.ts             # colored torrent line rendering
├── mpv.ts            # re-exports stream manager
└── stream/
    ├── index.ts      # StreamManager (orchestrates the pipeline)
    ├── safe-torrent.ts  # safe accessor helpers for WebTorrent 2.x
    ├── prioritizer.ts   # adaptive piece prioritization (seek-aware)
    ├── server.ts        # HTTP server with range request support
    ├── progress.ts      # live download progress display
    └── cleanup.ts       # temp dir + signal handlers
scripts/
├── test-stream.ts    # end-to-end streaming pipeline test (uses Sintel torrent)
└── diag-*.ts         # diagnostic scripts
```

## License

GPL-3.0
