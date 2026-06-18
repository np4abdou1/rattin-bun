/**
 * Stream HTTP Server
 *
 * Serves torrent file data to mpv via HTTP with range request support.
 */
import http from "node:http";
import type { Server } from "node:http";
import type { PiecePrioritizer } from "./prioritizer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTorrent = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFile = any;

const MIME_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".ogv": "video/ogg",
  ".ogg": "video/ogg",
};

interface ParsedRange {
  start: number;
  end: number;
}

export class StreamServer {
  videoFile: AnyFile;
  torrent: AnyTorrent;
  prioritizer: PiecePrioritizer;
  log: (msg: string) => void;

  server: Server | null = null;
  port = 0;
  requestCount = 0;
  totalBytesServed = 0;
  activeStreams = new Set<import("node:stream").Readable>();
  mimeType: string;

  constructor(
    videoFile: AnyFile,
    torrent: AnyTorrent,
    prioritizer: PiecePrioritizer,
    log: (msg: string) => void = () => {}
  ) {
    this.videoFile = videoFile;
    this.torrent = torrent;
    this.prioritizer = prioritizer;
    this.log = log;

    const name = videoFile.name as string;
    const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
    this.mimeType = MIME_TYPES[ext] || "video/mp4";
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this._handleRequest(req, res).catch((err) => {
          if (!res.headersSent) {
            res.writeHead(500);
            res.end("Internal Server Error");
          }
          this.log(`Request error: ${err.message}`);
        });
      });

      this.server.on("error", reject);

      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address();
        this.port = typeof addr === "object" && addr ? addr.port : 0;
        this.log(`StreamServer listening on port ${this.port}`);
        resolve(this.port);
      });
    });
  }

  async _handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const range = req.headers.range;
    const fileSize = this.videoFile.length as number;
    this.requestCount++;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Connection", "close");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === "HEAD") {
      if (range) {
        const parts = this._parseRange(range, fileSize);
        res.writeHead(206, {
          "Content-Range": `bytes ${parts.start}-${parts.end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": parts.end - parts.start + 1,
          "Content-Type": this.mimeType,
        });
      } else {
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": this.mimeType,
          "Accept-Ranges": "bytes",
        });
      }
      res.end();
      return;
    }

    if (range) {
      await this._serveRange(req, res, range, fileSize);
    } else {
      await this._serveFull(req, res, fileSize);
    }
  }

  async _serveRange(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    range: string,
    fileSize: number
  ) {
    const parts = this._parseRange(range, fileSize);
    const { start, end } = parts;
    const contentLength = end - start + 1;

    const isSeek = this.prioritizer.onRequest(start, end);
    if (isSeek) {
      this.log(
        `Seek detected: byte ${start} (was at ${this.prioritizer.currentOffset})`
      );
    }

    const ready = await this.prioritizer.waitForRange(start, end, 15000);
    if (!ready) {
      this.log(`Data not ready for range ${start}-${end}, serving anyway`);
    }

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": contentLength,
      "Content-Type": this.mimeType,
      "Cache-Control": "no-cache, no-store",
      "X-Accel-Buffering": "no",
    });

    const stream = this.videoFile.createReadStream({ start, end });
    this.activeStreams.add(stream);

    let bytesSent = 0;
    const timeout = setTimeout(() => {
      this.log(`Stream timeout for range ${start}-${end}`);
      stream.destroy();
    }, 30000);

    stream.on("data", (chunk: Buffer) => {
      bytesSent += chunk.length;
    });

    stream.on("end", () => {
      clearTimeout(timeout);
      this.activeStreams.delete(stream);
      this.totalBytesServed += bytesSent;
    });

    stream.on("error", () => {
      clearTimeout(timeout);
      this.activeStreams.delete(stream);
      if (!res.destroyed) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
    });

    res.on("close", () => {
      clearTimeout(timeout);
      this.activeStreams.delete(stream);
      stream.destroy();
    });

    stream.pipe(res);
  }

  async _serveFull(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    fileSize: number
  ) {
    this.prioritizer.onRequest(0, fileSize);

    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": this.mimeType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache, no-store",
    });

    const stream = this.videoFile.createReadStream();
    this.activeStreams.add(stream);

    let bytesSent = 0;
    stream.on("data", (chunk: Buffer) => {
      bytesSent += chunk.length;
    });
    stream.on("end", () => {
      this.activeStreams.delete(stream);
      this.totalBytesServed += bytesSent;
    });
    stream.on("error", () => {
      this.activeStreams.delete(stream);
      try {
        res.end();
      } catch {
        /* ignore */
      }
    });
    res.on("close", () => {
      this.activeStreams.delete(stream);
      stream.destroy();
    });

    stream.pipe(res);
  }

  _parseRange(range: string, fileSize: number): ParsedRange {
    const parts = range.replace(/bytes=/, "").split("-");
    let start = parseInt(parts[0], 10);
    let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    start = Math.max(0, Math.min(start, fileSize - 1));
    end = Math.max(start, Math.min(end, fileSize - 1));

    return { start, end };
  }

  getUrl(): string {
    return `http://127.0.0.1:${this.port}/`;
  }

  stop(): Promise<void> {
    for (const stream of this.activeStreams) {
      try {
        stream.destroy();
      } catch {
        /* ignore */
      }
    }
    this.activeStreams.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
