/**
 * Progress Reporter — displays download progress, speed, peers, buffering.
 */
import chalk from "chalk";
import type { Readable } from "node:stream";
import type { PiecePrioritizer } from "./prioritizer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTorrent = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFile = any;

function fmtBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

function fmtSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec === 0) return "0 B/s";
  return fmtBytes(bytesPerSec) + "/s";
}

export interface DownloadStats {
  downloaded: number;
  speed: number;
  peers: number;
}

export class ProgressReporter {
  videoFile: AnyFile;
  torrent: AnyTorrent;
  prioritizer: PiecePrioritizer | null;
  private _streamManager: { getDownloadStats(): DownloadStats } | null;

  interval: NodeJS.Timeout | null = null;
  lastDl = -1;
  startTime = Date.now();
  isBuffering = false;
  bufferingSince = 0;
  lastSpeedSamples: number[] = [];

  constructor(
    videoFile: AnyFile,
    torrent: AnyTorrent,
    prioritizer: PiecePrioritizer | null,
    streamManager: { getDownloadStats(): DownloadStats } | null = null
  ) {
    this.videoFile = videoFile;
    this.torrent = torrent;
    this.prioritizer = prioritizer;
    this._streamManager = streamManager;
  }

  start(intervalMs = 1000): void {
    this.startTime = Date.now();
    this.interval = setInterval(() => this._update(), intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write("\r" + " ".repeat(100) + "\r");
  }

  _update(): void {
    try {
      const stats = this._getStats();
      this._render(stats);
    } catch {
      /* ignore */
    }
  }

  _getStats() {
    let downloaded = 0;
    let speed = 0;
    let peers = 0;
    try {
      downloaded = this.torrent?.downloaded || 0;
      speed = this.torrent?.downloadSpeed || 0;
      peers = this.torrent?.numPeers || 0;
    } catch {
      /* ignore */
    }
    if (this._streamManager) {
      const stats = this._streamManager.getDownloadStats();
      if (stats.downloaded > downloaded) downloaded = stats.downloaded;
      if (stats.speed > 0) speed = stats.speed;
      if (stats.peers > 0) peers = stats.peers;
    }
    const total = (this.videoFile.length as number) || 1;
    const percent = Math.min(100, (downloaded / total) * 100);

    this.lastSpeedSamples.push(speed);
    if (this.lastSpeedSamples.length > 3) this.lastSpeedSamples.shift();
    const avgSpeed =
      this.lastSpeedSamples.reduce((a, b) => a + b, 0) /
      this.lastSpeedSamples.length;

    const isBuffering = avgSpeed < 1024 && percent < 100 && peers > 0;
    if (isBuffering && !this.isBuffering) {
      this.isBuffering = true;
      this.bufferingSince = Date.now();
    } else if (!isBuffering && this.isBuffering) {
      this.isBuffering = false;
    }

    const pieceStats = this.prioritizer ? this.prioritizer.getStats() : null;

    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const elapsedStr = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

    const remaining = total - downloaded;
    const eta = speed > 0 ? Math.ceil(remaining / speed) : Infinity;
    const etaStr =
      eta === Infinity
        ? "--:--"
        : `${Math.floor(eta / 60)}:${String(eta % 60).padStart(2, "0")}`;

    return {
      downloaded,
      total,
      percent,
      speed: avgSpeed,
      peers,
      isBuffering,
      pieceStats,
      elapsed: elapsedStr,
      eta: etaStr,
    };
  }

  _render(stats: ReturnType<ProgressReporter["_getStats"]>): void {
    const { downloaded, total, percent, speed, peers, isBuffering, elapsed, eta, pieceStats } = stats;

    const dl = Math.floor(downloaded / (1024 * 1024));
    if (dl === this.lastDl) return;
    this.lastDl = dl;

    const barWidth = 20;
    const filled = Math.floor((percent / 100) * barWidth);
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

    const pieceInfo = pieceStats
      ? `pieces: ${pieceStats.downloaded}/${pieceStats.totalPieces}`
      : "";

    let status: string;
    if (isBuffering) {
      status = chalk.yellow("⟳ buffering");
    } else if (percent >= 100) {
      status = chalk.green("✓ complete");
    } else {
      status = chalk.cyan("▶ streaming");
    }

    const line = [
      status,
      chalk.gray(`${elapsed} / ${eta}`),
      chalk.cyan(`${bar} ${percent.toFixed(1)}%`),
      chalk.green(fmtSpeed(speed)),
      chalk.yellow(`${peers} peers`),
      pieceInfo ? chalk.gray(pieceInfo) : "",
    ]
      .filter(Boolean)
      .join("  ");

    process.stdout.write(`\r${" ".repeat(100)}\r  ${line}`);
  }

  printSummary(): void {
    const stats = this._getStats();

    console.log();
    console.log(chalk.gray("  ─── Stream Summary ───"));
    console.log(chalk.gray(`  File:     ${this.videoFile.name}`));
    console.log(chalk.gray(`  Size:     ${fmtBytes(this.videoFile.length)}`));
    console.log(
      chalk.gray(`  Downloaded: ${fmtBytes(stats.downloaded)} (${stats.percent.toFixed(1)}%)`)
    );
    console.log(chalk.gray(`  Peers:    ${stats.peers}`));
    console.log(chalk.gray(`  Elapsed:  ${stats.elapsed}`));
    if (stats.pieceStats) {
      console.log(
        chalk.gray(`  Pieces:   ${stats.pieceStats.downloaded}/${stats.pieceStats.totalPieces}`)
      );
    }
    console.log();
  }
}

// Re-export for type compatibility
export type { Readable };
