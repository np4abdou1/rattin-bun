/**
 * MPV Player Interface
 *
 * Simply launches mpv with the magnet link. The user's mpv config handles
 * torrent streaming (e.g. via the webtorrent-hook plugin + webtorrent-cli).
 *
 * No WebTorrent library needed — mpv does the streaming itself.
 */
import { spawn } from "node:child_process";
import chalk from "chalk";
import { buildMagnet, type TorrentResult } from "./torrent";

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
    const mpv = spawn("mpv", [magnet], {
      stdio: "inherit",
    });

    mpv.on("close", (code) => resolve(code ?? 0));
    mpv.on("error", (err) => {
      console.error(chalk.red(`  MPV error: ${err.message}`));
      reject(err);
    });
  });
}
