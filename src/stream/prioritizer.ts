/**
 * Adaptive Piece Prioritizer
 *
 * Smart piece prioritization engine that makes torrent streaming feel
 * like YouTube. Detects seeks, reprioritizes pieces on-the-fly.
 *
 * Priority levels (WebTorrent):
 *   0 = dont-download, 1 = normal, 2 = high, 3 = highest
 */

const PIECE_PRIORITY = {
  DONT_DOWNLOAD: 0,
  NORMAL: 1,
  HIGH: 2,
  HIGHEST: 3,
} as const;

const PREFETCH_AHEAD_SEC = 30;
const STALL_TIMEOUT_MS = 3000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTorrent = any;

function isPieceReady(pieces: unknown[] | undefined, index: number): boolean {
  if (!pieces || index < 0 || index >= pieces.length) return false;
  const piece = pieces[index] as { missing?: number } | null;
  return piece != null && piece.missing === 0;
}

export class PiecePrioritizer {
  torrent: AnyTorrent;
  pieceLength: number;
  fileSize: number;

  currentOffset = 0;
  lastPrioritizationTime = 0;
  isSeeking = false;
  seekTarget: number | null = null;

  fileStartPiece = 0;
  fileEndPiece: number;

  playbackSpeed = 0;
  private _lastPriorityMap: string | null = null;

  constructor(torrent: AnyTorrent, pieceLength: number, fileSize: number) {
    this.torrent = torrent;
    this.pieceLength = pieceLength;
    this.fileSize = fileSize;
    this.fileEndPiece = Math.floor((fileSize - 1) / pieceLength);
  }

  get pieces(): unknown[] {
    return this.torrent?.pieces || [];
  }

  get maxPieceIndex(): number {
    return this.pieces.length - 1;
  }

  isDataAvailable(startByte: number, endByte: number): boolean {
    try {
      const downloaded =
        this.torrent?._safeDownloaded?.() ?? this.torrent?.downloaded ?? 0;
      return downloaded >= endByte;
    } catch {
      return false;
    }
  }

  getFileProgress() {
    try {
      const downloaded = this.torrent?.downloaded || 0;
      return {
        downloaded,
        total: this.fileSize,
        percent:
          this.fileSize > 0
            ? ((downloaded / this.fileSize) * 100).toFixed(1)
            : "0.0",
      };
    } catch {
      return { downloaded: 0, total: this.fileSize, percent: "0.0" };
    }
  }

  getPieceRange(startByte: number, endByte: number) {
    const startPiece = Math.max(
      this.fileStartPiece,
      Math.floor(startByte / this.pieceLength)
    );
    const endPiece = Math.min(
      this.fileEndPiece,
      Math.floor(endByte / this.pieceLength),
      this.maxPieceIndex
    );
    return { startPiece, endPiece: Math.max(startPiece, endPiece) };
  }

  getNeededPieces(startByte: number, endByte: number, lookaheadBytes = 0) {
    const { startPiece, endPiece } = this.getPieceRange(startByte, endByte);
    const lookaheadPieces = Math.ceil(lookaheadBytes / this.pieceLength);
    return {
      startPiece,
      endPiece: Math.min(
        endPiece + lookaheadPieces,
        this.fileEndPiece,
        this.maxPieceIndex
      ),
      criticalStart: startPiece,
      criticalEnd: endPiece,
    };
  }

  onRequest(startByte: number, endByte: number): boolean {
    const now = Date.now();
    const byteGap = Math.abs(startByte - this.currentOffset);
    const isSeek = byteGap > this.pieceLength * 10 && this.currentOffset > 0;

    if (isSeek) {
      this.isSeeking = true;
      this.seekTarget = startByte;
      this._onSeek(startByte, endByte);
    } else if (now - this.lastPrioritizationTime > 500) {
      this.currentOffset = startByte;
      this._onPlayback(startByte, endByte);
    }

    this.currentOffset = endByte;
    this.lastPrioritizationTime = now;

    return isSeek;
  }

  _onSeek(startByte: number, endByte: number) {
    const pieces = this.getNeededPieces(
      startByte,
      endByte,
      PREFETCH_AHEAD_SEC * this._getBytesPerSec()
    );
    const { startPiece, endPiece, criticalStart, criticalEnd } = pieces;

    const priorities = new Map<number, number>();

    for (let i = criticalStart; i <= criticalEnd; i++) {
      priorities.set(i, PIECE_PRIORITY.HIGHEST);
    }
    for (let i = criticalEnd + 1; i <= endPiece; i++) {
      priorities.set(i, PIECE_PRIORITY.HIGH);
    }

    const deadZone = 50;
    for (
      let i = this.fileStartPiece;
      i <= this.fileEndPiece && i <= this.maxPieceIndex;
      i++
    ) {
      if (!priorities.has(i)) {
        if (Math.abs(i - startPiece) > deadZone + (endPiece - startPiece)) {
          priorities.set(i, PIECE_PRIORITY.DONT_DOWNLOAD);
        } else {
          priorities.set(i, PIECE_PRIORITY.NORMAL);
        }
      }
    }

    this._applyPriorities(priorities);
    this.isSeeking = false;
  }

  _onPlayback(startByte: number, endByte: number) {
    const pieces = this.getNeededPieces(
      startByte,
      endByte,
      PREFETCH_AHEAD_SEC * this._getBytesPerSec()
    );
    const { startPiece, criticalEnd } = pieces;

    const priorities = new Map<number, number>();

    const nearAhead = Math.ceil((10 * this._getBytesPerSec()) / this.pieceLength);
    for (
      let i = startPiece;
      i <= Math.min(criticalEnd + nearAhead, this.fileEndPiece, this.maxPieceIndex);
      i++
    ) {
      priorities.set(i, PIECE_PRIORITY.HIGH);
    }

    const midAhead = Math.ceil(
      (PREFETCH_AHEAD_SEC * this._getBytesPerSec()) / this.pieceLength
    );
    for (
      let i = criticalEnd + nearAhead + 1;
      i <= Math.min(criticalEnd + midAhead, this.fileEndPiece, this.maxPieceIndex);
      i++
    ) {
      priorities.set(i, PIECE_PRIORITY.NORMAL);
    }

    for (
      let i = this.fileStartPiece;
      i < startPiece - 5 && i <= this.maxPieceIndex;
      i++
    ) {
      if (!priorities.has(i)) {
        priorities.set(i, PIECE_PRIORITY.DONT_DOWNLOAD);
      }
    }

    this._applyPriorities(priorities);
  }

  _applyPriorities(priorities: Map<number, number>) {
    const pieces = this.pieces;
    if (pieces.length === 0) return;

    const maxPiece = this.maxPieceIndex;
    const key = this._priorityMapKey(priorities);
    if (key === this._lastPriorityMap) return;
    this._lastPriorityMap = key;

    const batches = new Map<number, number[]>();
    for (const [piece, priority] of priorities) {
      if (piece < 0 || piece > maxPiece) continue;
      if (!batches.has(priority)) batches.set(priority, []);
      batches.get(priority)!.push(piece);
    }

    for (const [priority, pieceList] of batches) {
      for (let i = 0; i < pieceList.length; i++) {
        const start = pieceList[i];
        let end = start;
        while (i + 1 < pieceList.length && pieceList[i + 1] === end + 1) {
          end = pieceList[i + 1];
          i++;
        }
        end = Math.min(end, maxPiece);
        try {
          this.torrent.select(start, end, priority);
        } catch {
          /* ignore */
        }
      }
    }
  }

  async waitForRange(
    startByte: number,
    endByte: number,
    timeoutMs = STALL_TIMEOUT_MS
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    try {
      const { startPiece, endPiece } = this.getPieceRange(startByte, endByte);
      const maxPiece = this.maxPieceIndex;
      const clampedEnd = Math.min(endPiece, maxPiece);
      for (let i = startPiece; i <= clampedEnd; i++) {
        try {
          this.torrent.select(i, i, PIECE_PRIORITY.HIGHEST);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }

    return new Promise((resolve) => {
      const check = () => {
        if (Date.now() > deadline) {
          resolve(false);
          return;
        }
        if (this.isDataAvailable(startByte, endByte)) {
          resolve(true);
          return;
        }
        setTimeout(check, 200);
      };
      check();
    });
  }

  countReadyPieces() {
    const pieces = this.pieces;
    if (pieces.length === 0) return { ready: 0, total: 0 };

    let ready = 0;
    const total = this.fileEndPiece - this.fileStartPiece + 1;
    for (
      let i = this.fileStartPiece;
      i <= this.fileEndPiece && i <= this.maxPieceIndex;
      i++
    ) {
      if (isPieceReady(pieces, i)) ready++;
    }
    return { ready, total };
  }

  _getBytesPerSec(): number {
    try {
      const speed = this.torrent.downloadSpeed;
      if (speed > 0) {
        this.playbackSpeed = speed;
        return speed;
      }
    } catch {
      /* ignore */
    }
    return this.playbackSpeed || 1024 * 1024;
  }

  _priorityMapKey(priorities: Map<number, number>): string {
    let critical = 0;
    let blocked = 0;
    for (const [, priority] of priorities) {
      if (priority === PIECE_PRIORITY.HIGHEST) critical++;
      if (priority === PIECE_PRIORITY.DONT_DOWNLOAD) blocked++;
    }
    return `${critical}:${blocked}`;
  }

  getStats() {
    const { ready, total } = this.countReadyPieces();
    return {
      totalPieces: total,
      downloaded: ready,
      missing: total - ready,
      percent: total > 0 ? ((ready / total) * 100).toFixed(1) : "0.0",
      currentOffset: this.currentOffset,
      isSeeking: this.isSeeking,
    };
  }
}

export { isPieceReady };
