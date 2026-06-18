# rattin

Stream torrents from the terminal. Search TMDB, pick a torrent, watch with MPV.

A TypeScript port of [np4abdou1/rattin](https://github.com/np4abdou1/rattin), running on **Node.js + tsx**.

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
- **mpv** — video player (must be configured to handle magnet links, see below)
- **fzf** — fuzzy finder

```bash
# Ubuntu/Debian
sudo apt install mpv fzf

# macOS
brew install mpv fzf

# Arch
sudo pacman -S mpv fzf
```

### MPV magnet link support

This CLI passes magnet links directly to `mpv`. MPV needs a plugin to handle
them — the recommended setup is the
[webtorrent-hook](https://github.com/noctuid/mpv-webtorrent-hook) plugin
+ `webtorrent-cli`:

```bash
# Install webtorrent-cli globally
npm install -g webtorrent-cli

# Install the mpv plugin
git clone https://github.com/noctuid/mpv-webtorrent-hook.git \
  ~/.config/mpv/scripts/webtorrent-hook
```

With that in place, `mpv "magnet:?xt=urn:btih:..."` just works — the plugin
spawns `webtorrent-cli` to stream the torrent and feeds the video into mpv.

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
5. **Watch** — `mpv "magnet:..."` — MPV's plugin handles the streaming

## How it works

- **TMDB** for metadata (search, seasons, episodes, ratings, imdb ids)
- **Torrentio** as primary source (best curated results, needs imdb id)
- **TPB, EZTV, YTS, Nyaa** as fallback providers
- **MPV** for playback (with webtorrent-hook plugin for magnet streaming)
- **fzf** for fuzzy selection UI

Torrents are scored by title match, resolution, source quality, seeders,
and file size. No WebTorrent library — mpv handles streaming via its plugin.

## Project structure

```
src/
├── index.ts     # CLI entry point (commander + main flow)
├── deps.ts      # mpv/fzf dependency checker
├── tmdb.ts      # TMDB API client (+ imdb id fetch)
├── torrent.ts   # multi-provider search + scoring + magnet builder
├── fzf.ts       # fzf subprocess wrapper
├── ui.ts        # colored torrent line rendering
└── mpv.ts       # launches mpv with magnet link (stdio inherited)
```

~300 lines total. No streaming infrastructure — just search, pick, and play.

## License

GPL-3.0
