#!/usr/bin/env tsx
/**
 * rattin — Stream torrents from the terminal.
 *
 * Flow: search TMDB → fzf pick → (TV: pick season/episode) → fzf torrent → mpv magnet
 * MPV's own config (e.g. webtorrent-hook plugin) handles the torrent streaming.
 */
import "dotenv/config";

import { Command } from "commander";
import chalk from "chalk";
import {
  searchTMDB,
  fetchTVDetails,
  fetchImdbId,
  hasApiKey,
  type TMDBItem,
  type SeasonData,
  type TmdbEpisode,
} from "./tmdb";
import { searchTorrents, type TorrentResult, type SearchTarget } from "./torrent";
import { fzfSelect } from "./fzf";
import { playWithMpv } from "./mpv";
import {
  formatTMDBLine,
  formatEpisodeLine,
  formatTorrentLine,
  fmtYear,
  section,
  status,
  error,
} from "./ui";
import { checkDeps, checkDepsOnly } from "./deps";

const VERSION = "1.0.0";

// ── Banner ────────────────────────────────────────────────────────

function printBanner(): void {
  const bar = chalk.yellow("  ══════════════════════════════════");
  console.log(bar + chalk.yellow(` rattin v${VERSION} `) + chalk.green("● ready"));
  console.log();
}

// ── Step 1: Search TMDB ───────────────────────────────────────────

async function promptQuery(): Promise<string> {
  const inquirer = (await import("inquirer")).default;
  const { query } = await inquirer.prompt([
    {
      type: "input",
      name: "query",
      message: chalk.cyan("Search"),
      prefix: chalk.yellow("│\n│ ===>"),
    },
  ]);
  return (query as string).trim();
}

async function selectTMDBItem(query: string): Promise<TMDBItem | null> {
  section(`Searching TMDB for "${query}"...`);
  const results = await searchTMDB(query);
  if (!results.length) {
    error("No results found on TMDB.");
    return null;
  }

  const choices = results.map((item) => ({
    name: formatTMDBLine(item),
    value: item,
  }));

  return fzfSelect(choices, "Select content");
}

// ── Step 2: Build search target (movie or TV episode) ─────────────

async function buildMovieTarget(item: TMDBItem): Promise<SearchTarget> {
  const title = item.title || item.name || "";
  const year = fmtYear(item.release_date);
  status("Fetching IMDB id...");
  const imdbId = await fetchImdbId(item.id, "movie");
  return { type: "movie", title, year, imdbId, tmdbId: item.id };
}

async function buildTVTarget(item: TMDBItem): Promise<SearchTarget | null> {
  const seasons = item.number_of_seasons ?? 1;

  // Pick season
  let seasonNum: number;
  if (seasons > 1) {
    const seasonChoices = Array.from({ length: seasons }, (_, i) => ({
      name: chalk.white(`Season ${i + 1}`),
      value: i + 1,
    }));
    seasonNum = Number(await fzfSelect(seasonChoices, "Select season"));
  } else {
    seasonNum = 1;
  }

  // Fetch season episodes
  const seasonData: SeasonData | null = await fetchTVDetails(item.id, seasonNum);
  if (!seasonData?.episodes?.length) {
    error("No episodes found for this season.");
    return null;
  }

  // Pick episode
  const epChoices = seasonData.episodes.map((ep: TmdbEpisode) => ({
    name: formatEpisodeLine(ep),
    value: ep,
  }));
  const ep: TmdbEpisode = await fzfSelect(epChoices, "Select episode");

  // Fetch imdb id for Torrentio
  const title = item.title || item.name || "";
  const year = fmtYear(item.first_air_date);
  status("Fetching IMDB id...");
  const imdbId = await fetchImdbId(item.id, "tv");

  return {
    type: "tv",
    title,
    year,
    season: seasonNum,
    episode: ep.episode_number,
    imdbId,
    tmdbId: item.id,
  };
}

function printTargetSummary(target: SearchTarget): void {
  if (target.type === "tv") {
    const s = String(target.season).padStart(2, "0");
    const e = String(target.episode).padStart(2, "0");
    section(`Target: ${target.title} S${s}E${e}`);
  } else {
    section(`Target: ${target.title} (${target.year})`);
  }
  if (target.imdbId) {
    status(`IMDB: ${target.imdbId}`);
  } else {
    status("IMDB: not found (Torrentio unavailable, using fallback providers)");
  }
}

// ── Step 3: Search torrents ───────────────────────────────────────

async function selectTorrent(target: SearchTarget): Promise<TorrentResult | null> {
  section("Searching torrent sources...");
  const torrents = await searchTorrents(target);
  if (!torrents.length) {
    error("No torrents found for this target.");
    return null;
  }

  status(`Found ${torrents.length} torrent(s), scored & sorted.`);

  const choices = torrents.map((t, i) => ({
    name: formatTorrentLine(t, i),
    value: t,
  }));

  return fzfSelect(choices, "Select torrent");
}

// ── Main ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("rattin")
    .description("Stream torrents from the terminal")
    .version(VERSION)
    .argument("[query]", "optional search query")
    .option("--deps", "check dependencies and exit")
    .parse(process.argv);

  const opts = program.opts();
  const positional = program.args.filter((a) => !a.startsWith("-"));

  if (opts.deps) {
    checkDepsOnly();
    process.exit(0);
  }

  // Verify deps + API key
  checkDeps();
  if (!hasApiKey()) {
    error("TMDB API key not set. Get a free key at https://www.themoviedb.org/settings/api");
    status('Then: export TMDB_API_KEY="your_key_here"');
    process.exit(1);
  }

  printBanner();

  // Step 1: Search TMDB
  let query = positional.join(" ").trim();
  if (!query) {
    query = await promptQuery();
  }
  if (!query) {
    status("No query entered. Exiting.");
    process.exit(0);
  }

  const selectedItem = await selectTMDBItem(query);
  if (!selectedItem) process.exit(0);

  // Step 2: Build target (movie or TV episode)
  const target =
    selectedItem.media_type === "tv"
      ? await buildTVTarget(selectedItem)
      : await buildMovieTarget(selectedItem);
  if (!target) process.exit(0);

  printTargetSummary(target);

  // Step 3: Pick torrent
  const torrent = await selectTorrent(target);
  if (!torrent) process.exit(0);

  // Step 4: Launch MPV with the magnet
  section("Launching MPV...");
  await playWithMpv(torrent);
}

main().catch((err: Error & { name?: string }) => {
  if (err.name === "ExitPromptError") {
    process.exit(0);
  }
  error(err.message);
  process.exit(1);
});
