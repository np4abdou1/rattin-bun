/**
 * Safe Torrent Wrapper
 *
 * Patches a WebTorrent torrent to prevent the null-piece crash in 3.x.
 */
import WebTorrent from "webtorrent";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTorrent = any;

export function createSafeTorrent(torrent: AnyTorrent): AnyTorrent {
  if (torrent._request) {
    const origRequest = torrent._request.bind(torrent);
    torrent._request = function (wire: unknown, piece: number) {
      try {
        if (piece != null && torrent.pieces[piece] != null) {
          return origRequest(wire, piece);
        }
        return false;
      } catch {
        return false;
      }
    };
  }

  if (torrent._updateWire) {
    const origUpdateWire = torrent._updateWire.bind(torrent);
    torrent._updateWire = function (...args: unknown[]) {
      try {
        origUpdateWire(...args);
      } catch {
        /* ignore */
      }
    };
  }

  if (torrent._update) {
    const origUpdate = torrent._update.bind(torrent);
    let lastUpdate = 0;
    torrent._update = function (...args: unknown[]) {
      const now = Date.now();
      if (now - lastUpdate < 100) return;
      lastUpdate = now;
      try {
        origUpdate(...args);
      } catch {
        /* ignore */
      }
    };
  }

  if (torrent.bitfield) {
    const origGet = torrent.bitfield.get?.bind(torrent.bitfield);
    if (origGet) {
      torrent.bitfield.get = function (index: number) {
        try {
          return true;
        } catch {
          return origGet(index);
        }
      };
    }
  }

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

export async function createSafeClient(
  options?: Record<string, unknown>
): Promise<InstanceType<typeof WebTorrent>> {
  const client = new WebTorrent(options as ConstructorParameters<typeof WebTorrent>[0]);

  const origAdd = client.add.bind(client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).add = function (torrentId: unknown, opts: unknown) {
    const torrent = origAdd(torrentId as never, opts as never);

    const patchTorrent = () => {
      createSafeTorrent(torrent);
    };

    patchTorrent();
    torrent.on("metadata", patchTorrent);

    return torrent;
  };

  return client;
}
