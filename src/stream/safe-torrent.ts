/**
 * Safe Torrent Wrapper (simplified for WebTorrent 2.x)
 *
 * WebTorrent 3.x had a null-piece crash that required extensive monkey-patching.
 * We downgraded to WebTorrent 2.x which is stable and doesn't have this bug.
 * This wrapper now only adds safe accessor helpers for robust progress tracking.
 */
import WebTorrent from "webtorrent";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTorrent = any;

/**
 * Add safe accessor helpers to a torrent. These cache values so that if
 * WebTorrent's getters ever throw (rare in 2.x, but defensive), we still
 * have a last-known-good value for progress display.
 */
export function createSafeTorrent(torrent: AnyTorrent): AnyTorrent {
  let manualDownloaded = 0;
  let lastSpeed = 0;

  torrent.on("download", () => {
    try {
      const dl = torrent.downloaded;
      if (dl > manualDownloaded) manualDownloaded = dl;
    } catch {
      /* ignore */
    }
    try {
      lastSpeed = torrent.downloadSpeed;
    } catch {
      /* ignore */
    }
  });

  torrent._safeDownloaded = () => {
    try {
      const dl = torrent.downloaded;
      if (dl > manualDownloaded) manualDownloaded = dl;
    } catch {
      /* ignore */
    }
    return manualDownloaded;
  };

  torrent._safeSpeed = () => {
    try {
      return torrent.downloadSpeed;
    } catch {
      return lastSpeed;
    }
  };

  torrent._safePeers = () => {
    try {
      return torrent.numPeers;
    } catch {
      return 0;
    }
  };

  return torrent;
}

/**
 * Create a WebTorrent client. In 2.x this is just `new WebTorrent()`.
 * Kept as a function for API compatibility with stream/index.ts.
 */
export async function createSafeClient(
  options?: Record<string, unknown>
): Promise<InstanceType<typeof WebTorrent>> {
  return new WebTorrent(options as ConstructorParameters<typeof WebTorrent>[0]);
}
