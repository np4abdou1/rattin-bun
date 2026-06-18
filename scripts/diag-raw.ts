/**
 * Diagnostic: test RAW WebTorrent (no safe wrapper) to see if the null-piece
 * crash is inherent to WebTorrent 3.x or caused by our wrapper.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import WebTorrent from "webtorrent";

async function main() {
  const tempDir = "/tmp/rattin-raw";
  const buf = readFileSync("/tmp/sintel.torrent");

  console.log("=== RAW WebTorrent test (no safe wrapper) ===");
  const client = new WebTorrent({ dht: true });

  const torrent: any = await new Promise((resolve, reject) => {
    const t = client.add(buf, { path: tempDir });
    t.on("ready", () => resolve(t));
    t.on("error", reject);
    setTimeout(() => reject(new Error("ready timeout")), 30000);
  });

  console.log("ready. name:", torrent.name, "files:", torrent.files.length);
  const f = torrent.files.find((x: any) => x.name.endsWith(".mp4"));
  console.log("mp4:", f.name, "size:", f.length);

  // Log progress every 5s for 60s
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    let dl = "?", peers = "?", piecesLen = "?";
    try { dl = String(torrent.downloaded); } catch (e: any) { dl = "CRASH:" + e.message.slice(0, 50); }
    try { peers = String(torrent.numPeers); } catch (e: any) { peers = "ERR"; }
    try { piecesLen = String(torrent.pieces?.length ?? "null"); } catch (e: any) { piecesLen = "ERR"; }
    console.log(`  t+${(i + 1) * 5}s: downloaded=${dl}, peers=${peers}, pieces.length=${piecesLen}`);
  }

  // try direct read
  console.log("\ndirect read test (first 4KB):");
  let bytes = 0;
  await new Promise<void>((resolve) => {
    const stream = f.createReadStream({ start: 0, end: 4095 });
    stream.on("data", (c: Buffer) => { bytes += c.length; });
    stream.on("end", () => { console.log("  read", bytes, "bytes ✓"); resolve(); });
    stream.on("error", (e: Error) => { console.log("  ERROR:", e.message); resolve(); });
    setTimeout(() => { console.log("  timeout, got", bytes); stream.destroy(); resolve(); }, 10000);
  });

  // temp dir check
  console.log("\ntemp dir:");
  try {
    for (const name of readdirSync(tempDir)) {
      const st = statSync(join(tempDir, name));
      console.log(" ", name, st.size, "bytes", st.isDirectory() ? "(dir)" : "");
    }
  } catch (e: any) {
    console.log("  readdir error:", e.message);
  }

  client.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
