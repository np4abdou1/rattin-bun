/**
 * MPV Player Interface
 *
 * Launches mpv with the torrent's magnet link. The user's mpv config handles
 * torrent streaming (e.g. via the webtorrent-hook plugin + webtorrent-cli).
 *
 * No WebTorrent library needed — mpv does the streaming itself.
 */
import { spawn } from "node:child_process";
import chalk from "chalk";
import { buildMagnet, type TorrentResult } from "./torrent";

/**
 * mpv flags for smooth torrent streaming.
 *
 * --hwdec=auto          : hardware decoding (fixes A/V desync, dropped frames)
 * --profile=fast        : fast decoding profile (mpv's own recommendation for desync)
 * --cache=yes           : enable demuxer cache for streaming
 * --demuxer-max-bytes=150MiB : large cache to absorb torrent speed fluctuations
 * --demuxer-readahead-secs=120 : read 2 minutes ahead to prevent buffering stalls
 * --force-seekable=yes  : allow seeking even on non-seekable streams
 * --keep-open=yes       : don't close when playback ends (let user quit manually)
 */
const MPV_FLAGS = [
  "--hwdec=auto",
  "--profile=fast",
  "--cache=yes",
  "--demuxer-max-bytes=150MiB",
  "--demuxer-readahead-secs=120",
  "--force-seekable=yes",
  "--keep-open=yes",
];

/**
 * Launch mpv with the torrent's magnet link.
 * stdio is inherited so the user sees mpv's full output (including any
 * webtorrent-hook messages from their mpv config).
 *
 * @returns mpv's exit code
 */
export async function playWithMpv(torrent: TorrentResult): Promise<number> {
  const magnet = buildMagnet(torrent);
  console.log(chalk.gray(`  magnet: ${magnet.slice(0, 80)}...`));

  return new Promise((resolve, reject) => {
    const mpv = spawn("mpv", [...MPV_FLAGS, magnet], {
      stdio: "inherit",
    });

    mpv.on("close", (code) => resolve(code ?? 0));
    mpv.on("error", (err) => {
      console.error(chalk.red(`  MPV error: ${err.message}`));
      reject(err);
    });
  });
}
