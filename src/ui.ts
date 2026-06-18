/**
 * UI helpers — formatting for TMDB results, torrents, and bytes.
 */
import chalk from "chalk";
import type { TorrentResult } from "./torrent";

// ── Byte formatting ───────────────────────────────────────────────

export function fmtBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

// ── TMDB formatting ───────────────────────────────────────────────

/**
 * Format a TMDB rating (0-10 scale) with a star.
 * TMDB's vote_average is already 0-10, so we show it directly.
 * Returns "?" if no rating.
 */
export function fmtRating(voteAverage?: number): string {
  if (!voteAverage || voteAverage <= 0) return chalk.gray("★?");
  return chalk.yellowBright(`★${voteAverage.toFixed(1)}`);
}

/**
 * Extract the year from a TMDB date string.
 */
export function fmtYear(dateStr?: string): string {
  if (!dateStr) return "????";
  return dateStr.slice(0, 4);
}

/**
 * Format a TMDB item (movie or TV) as a single fzf line.
 */
export function formatTMDBLine(item: {
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  media_type: string;
}): string {
  const title = item.title || item.name || "Unknown";
  const year = fmtYear(item.release_date || item.first_air_date);
  const rating = fmtRating(item.vote_average);
  const type = item.media_type === "tv" ? "TV" : "MOVIE";
  const typeStr = item.media_type === "tv" ? chalk.magenta("[TV]") : chalk.blue("[MOVIE]");

  return `${chalk.yellow(title)} ${chalk.gray("(" + year + ")")} ${typeStr} ${rating}`;
}

/**
 * Format a TV episode as a single fzf line.
 */
export function formatEpisodeLine(ep: {
  episode_number: number;
  name: string;
  vote_average: number;
}): string {
  const num = String(ep.episode_number).padStart(2, "0");
  const rating = fmtRating(ep.vote_average);
  return `${chalk.cyan(num)} ${chalk.gray("·")} ${chalk.white(ep.name)} ${rating}`;
}

// ── Torrent formatting ────────────────────────────────────────────

const TAG_COLORS: Record<string, (s: string) => string> = {
  "4K": chalk.magenta,
  "1080p": chalk.cyan,
  "720p": chalk.blue,
  "480p": chalk.gray,
  BluRay: chalk.green,
  "WEB-DL": chalk.green,
  WEBRip: chalk.green,
  BDRip: chalk.green,
  HDTV: chalk.cyan,
  HEVC: chalk.magenta,
  x264: chalk.blue,
  AV1: chalk.magenta,
  DTS: chalk.yellow,
  "5.1": chalk.yellow,
  Atmos: chalk.yellow,
  HDR: chalk.magenta,
  "HDR10+": chalk.magenta,
  Remux: chalk.green,
  MKV: chalk.gray,
  MP4: chalk.gray,
  CAM: chalk.red,
};

/**
 * Format a torrent as a single fzf line.
 */
export function formatTorrentLine(t: TorrentResult, _index: number): string {
  const tags = (t.tags || []).map((tag) => {
    const color = TAG_COLORS[tag] || chalk.gray;
    return color(tag);
  });

  const tagStr = tags.length > 0 ? " " + tags.join(chalk.gray(" · ")) : "";
  const sizeStr = t.sizeStr || fmtBytes(t.size);
  const seedersStr = chalk.yellow(`▲${t.seeders}`);
  const sourceStr = chalk.gray(`[${t.source}]`);

  // Truncate name to keep lines readable in fzf
  const maxNameLen = 55;
  let name = t.name;
  if (name.length > maxNameLen) {
    name = name.slice(0, maxNameLen - 1) + "…";
  }

  return `${chalk.white(name)}${tagStr} ${chalk.gray(sizeStr)} ${seedersStr} ${sourceStr}`;
}

// ── Section / status helpers ──────────────────────────────────────

/**
 * Print a section header, e.g. "▸ Searching TMDB..."
 */
export function section(msg: string): void {
  console.log(chalk.cyan(`\n  ▸ ${msg}`));
}

/**
 * Print a dim status line.
 */
export function status(msg: string): void {
  console.log(chalk.gray(`  ${msg}`));
}

/**
 * Print an error message.
 */
export function error(msg: string): void {
  console.log(chalk.red(`  ✗ ${msg}`));
}
