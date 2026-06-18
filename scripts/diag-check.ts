/**
 * Diagnostic: check if data is actually written to disk vs the bitfield patch
 * making WebTorrent think pieces are downloaded when they aren't.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createSafeClient, createSafeTorrent } from "../src/stream/safe-torrent";

async function main() {
  const tempDir = "/tmp/rattin-check";
  const buf = readFileSync("/tmp/sintel.torrent");
  const client = await createSafeClient({ tempDest: tempDir, path: tempDir });
  const torrent: any = await new Promise((resolve, reject) => {
    const t = client.add(buf, { deselect: true, path: tempDir });
    t.on("ready", () => resolve(createSafeTorrent(t)));
    t.on("error", reject);
    setTimeout(() => reject(new Error("timeout")), 30000);
  });

  console.log("ready. files:", torrent.files.length);
  const f = torrent.files.find((x: any) => x.name.endsWith(".mp4"));
  console.log("mp4 file:", f.name, "size:", f.length);
  f.select();

  console.log("waiting 30s for download...");
  await new Promise((r) => setTimeout(r, 30000));

  console.log("downloaded (safe):", torrent._safeDownloaded(), "bytes");
  try {
    console.log("downloaded (raw):", torrent.downloaded, "bytes");
  } catch (e: any) {
    console.log("downloaded (raw): ERR", e.message);
  }
  console.log("numPeers:", torrent._safePeers());

  // check temp dir
  console.log("\ntemp dir contents:");
  try {
    const files = readdirSync(tempDir);
    for (const name of files) {
      const st = statSync(join(tempDir, name));
      console.log(" ", name, st.size, "bytes");
    }
  } catch (e: any) {
    console.log("  readdir error:", e.message);
  }

  // try direct read
  console.log("\ndirect read test:");
  const stream = f.createReadStream({ start: 0, end: 1023 });
  let bytes = 0;
  await new Promise<void>((resolve) => {
    stream.on("data", (c: Buffer) => {
      bytes += c.length;
    });
    stream.on("end", () => {
      console.log("  read", bytes, "bytes");
      resolve();
    });
    stream.on("error", (e: Error) => {
      console.log("  ERROR:", e.message);
      resolve();
    });
    setTimeout(() => {
      console.log("  timeout, got", bytes);
      stream.destroy();
      resolve();
    }, 10000);
  });

  client.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
