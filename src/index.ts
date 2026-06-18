#!/usr/bin/env tsx
/**
 * rattin — Stream torrents from the terminal.
 *
 * Search TMDB → pick with fzf → pick torrent → launch MPV with magnet link.
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
} from "./tmdb";
import { searchTorrents, type TorrentResult, type SearchTarget } from "./torrent";
import { fzfSelect } from "./fzf";
import { playWithMpv } from "./mpv";
import { formatTorrentLine } from "./ui";
import { checkDeps, checkDepsOnly } from "./deps";

const VERSION = "1.0.0";

function printBanner(): void {
  console.log(
    chalk.yellow.bold("  ╔══════════════════════════════════╗") +
      chalk.yellow(" v" + VERSION) +
      chalk.gray("  streaming") +
      chalk.green(" ●") +
      chalk.gray(" ready")
  );
  console.log(chalk.yellow("  ╚══════════════════════════════════╝"));
  console.log();
}

async function promptSearch(): Promise<string> {
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

async function handleTVSelection(item: TMDBItem): Promise<SearchTarget | null> {
  const seasons = item.number_of_seasons ?? 1;

  let seasonNum: number;
  if (seasons > 1) {
    const seasonChoices = Array.from({ length: seasons }, (_, i) => ({
      name: chalk.white(`Season ${i + 1}`),
      value: i + 1,
    }));

    const seasonInput = await fzfSelect(seasonChoices, "Select season");
    seasonNum = Number(seasonInput);
  } else {
    seasonNum = 1;
  }

  const seasonData: SeasonData | null = await fetchTVDetails(item.id, seasonNum);
  if (!seasonData?.episodes?.length) {
    console.log(chalk.red("  No episodes found for this season."));
    return null;
  }

  const epChoices = seasonData.episodes.map((ep) => ({
    name: `${chalk.cyan(String(ep.episode_number).padStart(2, " "))} - ${chalk.white(
      ep.name.toUpperCase()
    )} ${chalk.yellow("★" + (ep.vote_average / 2).toFixed(1))}`,
    value: ep,
  }));

  const epInput = await fzfSelect(epChoices, "Select episode");

  // Fetch imdb id for Torrentio (TV)
  const title = item.title || item.name || "";
  const year = (item.first_air_date || "").slice(0, 4);
  console.log(chalk.gray("  Fetching IMDB id..."));
  const imdbId = await fetchImdbId(item.id, "tv");

  return {
    type: "tv",
    title,
    year,
    season: seasonNum,
    episode: epInput.episode_number,
    imdbId,
    tmdbId: item.id,
  };
}

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

  // Verify system deps + API key
  checkDeps();
  if (!hasApiKey()) {
    console.error(
      chalk.red(
        "\n  TMDB API key not set. Get a free key at https://www.themoviedb.org/settings/api"
      )
    );
    console.error(chalk.gray('  Then: export TMDB_API_KEY="your_key_here"\n'));
    process.exit(1);
  }

  printBanner();

  // Step 1: Search TMDB
  let query = positional.join(" ").trim();
  if (!query) {
    query = await promptSearch();
  }
  if (!query) {
    console.log(chalk.gray("  No query entered. Exiting."));
    process.exit(0);
  }

  console.log(chalk.gray("  Searching TMDB..."));
  const results: TMDBItem[] = await searchTMDB(query);

  if (!results.length) {
    console.log(chalk.red("  No results found."));
    process.exit(0);
  }

  // Format results for fzf
  const tmdbChoices = results.map((item) => {
    const title = item.title || item.name || "";
    const year = (item.release_date || item.first_air_date || "").slice(0, 4);
    const rating = item.vote_average ? (item.vote_average / 2).toFixed(1) : "?";
    const type = item.media_type === "tv" ? "TV" : "MOVIE";
    return {
      name: `${chalk.yellow(title)} ${chalk.blue("(" + year + ")")} ${chalk.gray(
        "[" + type + "]"
      )} ${chalk.yellowBright("★" + rating)}`,
      value: item,
    };
  });

  const selectedItem: TMDBItem = await fzfSelect(tmdbChoices, "Select content");

  // Step 2: Handle TV vs Movie
  let target: SearchTarget;
  if (selectedItem.media_type === "tv") {
    target = (await handleTVSelection(selectedItem)) as SearchTarget;
    if (!target) process.exit(0);
  } else {
    const title = selectedItem.title || selectedItem.name || "";
    const year = (selectedItem.release_date || "").slice(0, 4);
    console.log(chalk.gray("  Fetching IMDB id..."));
    const imdbId = await fetchImdbId(selectedItem.id, "movie");
    target = {
      type: "movie",
      title,
      year,
      imdbId,
      tmdbId: selectedItem.id,
    };
  }

  // Step 3: Search torrents
  console.log(chalk.gray("\n  Searching torrent sources..."));
  const torrents: TorrentResult[] = await searchTorrents(target);

  if (!torrents.length) {
    console.log(chalk.red("  No torrents found."));
    process.exit(0);
  }

  // Format torrents for fzf
  const torrentChoices = torrents.map((t, i) => ({
    name: formatTorrentLine(t, i),
    value: t,
  }));

  const selectedTorrent: TorrentResult = await fzfSelect(
    torrentChoices,
    "Select torrent"
  );

  // Step 4: Launch with MPV
  console.log(chalk.gray("\n  Launching MPV..."));
  await playWithMpv(selectedTorrent);
}

main().catch((err: Error & { name?: string }) => {
  if (err.name === "ExitPromptError") {
    process.exit(0);
  }
  console.error(chalk.red("\n  Error: " + err.message));
  process.exit(1);
});
