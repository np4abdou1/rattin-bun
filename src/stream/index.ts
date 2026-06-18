/**
 * Stream Manager
 *
 * Orchestrates the entire streaming pipeline:
 *   Torrent → Temp Dir → Piece Prioritizer → HTTP Server → MPV
 */
import { spawn, type ChildProcess } from "node:child_process";
import chalk from "chalk";
import { createSafeClient, createSafeTorrent } from "./safe-torrent";
import { PiecePrioritizer } from "./prioritizer";
import { StreamServer } from "./server";
import { ProgressReporter, type DownloadStats } from "./progress";
import { CleanupManager } from "./cleanup";
import { buildMagnet, type TorrentResult } from "../torrent";

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

function findLargestVideo(files: AnyFile[]): AnyFile | null {
  const videoExts = [".mp4", ".mkv", ".avi", ".webm", ".mov", ".ogv", ".ogg"];
  let best: AnyFile | null = null;
  for (const f of files) {
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    if (videoExts.includes(ext)) {
      if (!best || f.length > best.length) best = f;
    }
  }
  return best;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class StreamManager {
  torrentInfo: TorrentResult;
  client: Awaited<ReturnType<typeof createSafeClient>> | null = null;
  wt: AnyTorrent | null = null;
  prioritizer: PiecePrioritizer | null = null;
  server: StreamServer | null = null;
  progress: ProgressReporter | null = null;
  cleanup: CleanupManager | null = null;
  mpv: ChildProcess | null = null;

  videoFile: AnyFile | null = null;
  startTime = Date.now();

  private _downloadedBytes = 0;
  private _downloadSpeed = 0;
  private _numPeers = 0;

  constructor(torrentInfo: TorrentResult) {
    this.torrentInfo = torrentInfo;
  }

  async start(): Promise<void> {
    const log = (msg: string) => console.log(chalk.gray(`  ${msg}`));

    try {
      this.cleanup = new CleanupManager(log);
      this.cleanup.installHandlers();

      const tempDir = this.cleanup.createTempDir();
      log(`Temp: ${tempDir}`);

      this.client = await createSafeClient({ tempDest: tempDir });
      this.cleanup.onCleanup(() => this._destroyClient());

      const magnet = buildMagnet(this.torrentInfo);
      log("Adding torrent...");

      this.wt = await this._addTorrent(magnet);

      log("Initializing...");
      await sleep(5000);

      const files = this.wt.files as AnyFile[];
      log(`${files.length} file(s) in torrent`);

      this.videoFile = this._selectFile(files);
      if (!this.videoFile) {
        throw new Error("No video files found in torrent");
      }

      this._safeSelectFile();

      log(`Playing: ${chalk.green(this.videoFile.name)}`);
      log(`Size: ${fmtBytes(this.videoFile.length)}`);

      this._setupDownloadTracking();

      log(`Peers: ${this._numPeers}`);

      this.prioritizer = new PiecePrioritizer(
        this.wt,
        this.wt.pieceLength,
        this.videoFile.length
      );

      this.server = new StreamServer(
        this.videoFile,
        this.wt,
        this.prioritizer,
        log
      );
      await this.server.start();
      this.cleanup.onCleanup(() => this.server!.stop());
      log(`Server: ${this.server.getUrl()}`);

      this.progress = new ProgressReporter(
        this.videoFile,
        this.wt,
        this.prioritizer,
        this
      );
      this.progress.start(1000);
      this.cleanup.onCleanup(() => this.progress!.stop());

      log("Launching MPV...");
      await this._launchMpv(this.server.getUrl());

      this.progress.printSummary();
      await this.cleanup.cleanup();
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${(err as Error).message}`));
      if (this.cleanup) {
        await this.cleanup.cleanup();
      }
      throw err;
    }
  }

  _setupDownloadTracking(): void {
    const updateStats = () => {
      this._downloadedBytes = this.wt!._safeDownloaded();
      this._downloadSpeed = this.wt!._safeSpeed();
      this._numPeers = this.wt!._safePeers();
    };

    this.wt!.on("download", updateStats);
    this.wt!.on("wire", updateStats);
    this.wt!.on("wireDisconnected", updateStats);

    setInterval(updateStats, 1000);

    this._numPeers = this.wt!._safePeers();
  }

  getDownloadStats(): DownloadStats {
    return {
      downloaded: this._downloadedBytes,
      speed: this._downloadSpeed,
      peers: this._numPeers,
    };
  }

  _addTorrent(magnet: string): Promise<AnyTorrent> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for torrent metadata (30s)"));
      }, 30000);

      let torrent: AnyTorrent;
      try {
        torrent = this.client!.add(magnet, { deselect: true });
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
        return;
      }

      torrent.on("ready", () => {
        clearTimeout(timeout);
        const safe = createSafeTorrent(torrent);
        resolve(safe);
      });

      torrent.on("error", (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });

      torrent.on("warning", () => {});
    });
  }

  _safeSelectFile(): void {
    try {
      try {
        this.videoFile!.select();
      } catch {
        /* ignore */
      }
      for (const f of this.wt!.files as AnyFile[]) {
        if (f !== this.videoFile) {
          try {
            f.deselect();
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  _selectFile(files: AnyFile[]): AnyFile | null {
    if (
      this.torrentInfo.fileIdx !== undefined &&
      this.torrentInfo.fileIdx >= 0 &&
      this.torrentInfo.fileIdx < files.length
    ) {
      return files[this.torrentInfo.fileIdx];
    }
    return findLargestVideo(files);
  }

  _launchMpv(streamUrl: string): Promise<number> {
    return new Promise((resolve, reject) => {
      this.mpv = spawn(
        "mpv",
        [
          "--no-terminal",
          "--force-seekable=yes",
          "--cache=yes",
          "--demuxer-max-bytes=75MiB",
          "--demuxer-readahead-secs=60",
          "--hr-seek=yes",
          "--cache-secs=60",
          "--keep-open=yes",
          "--keep-open-pause=no",
          streamUrl,
        ],
        {
          stdio: ["ignore", "inherit", "inherit"],
        }
      );

      this.cleanup!.onCleanup(() => {
        if (this.mpv && !this.mpv.killed) {
          this.mpv.kill("SIGTERM");
        }
      });

      this.mpv.on("close", (code) => resolve(code ?? 0));
      this.mpv.on("error", (err) => {
        console.error(chalk.red(`  MPV error: ${err.message}`));
        reject(err);
      });
    });
  }

  async _destroyClient(): Promise<void> {
    if (this.wt) {
      try {
        this.wt.destroy();
      } catch {
        /* ignore */
      }
      this.wt = null;
    }
    if (this.client) {
      try {
        this.client.destroy();
      } catch {
        /* ignore */
      }
      this.client = null;
    }
  }
}

export async function playWithMpv(torrentInfo: TorrentResult): Promise<void> {
  const manager = new StreamManager(torrentInfo);
  await manager.start();
}
