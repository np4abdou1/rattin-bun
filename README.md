# rattin

Stream torrents from the terminal. Search TMDB, pick a torrent, watch with MPV.

A faithful Bun + TypeScript port of [np4abdou1/rattin](https://github.com/np4abdou1/rattin).

## Usage

```bash
bun src/index.ts
# or with a direct query
bun src/index.ts "the matrix"
# check dependencies
bun src/index.ts --deps
```

## Install

```bash
bun install
```

### Dependencies

- **Bun** runtime
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
- **WebTorrent** for P2P streaming with adaptive piece prioritization
- **MPV** for playback (hardware-accelerated, all formats)
- **fzf** for fuzzy selection UI

Torrents are scored by title match, resolution, source quality, seeders,
and file size. Everything streams to a temp directory — nothing persists.

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
    ├── safe-torrent.ts  # patches WebTorrent 3.x null-piece crash
    ├── prioritizer.ts   # adaptive piece prioritization (seek-aware)
    ├── server.ts        # HTTP server with range request support
    ├── progress.ts      # live download progress display
    └── cleanup.ts       # temp dir + signal handlers
```

## License

GPL-3.0
