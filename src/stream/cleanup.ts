/**
 * Cleanup Manager — temp directories + signal handlers.
 * Everything streams to temp; nothing persists on disk.
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

type LogFn = (msg: string) => void;

export class CleanupManager {
  log: LogFn;
  tempDir: string | null = null;
  cleanupCallbacks: Array<() => Promise<void> | void> = [];
  isCleaningUp = false;

  _onSignal: (signal: NodeJS.Signals) => void;
  _onExit: (code: number) => void;
  _onUncaught: (err: Error) => void;

  constructor(log: LogFn = () => {}) {
    this.log = log;
    this._onSignal = this.__onSignal.bind(this);
    this._onExit = this.__onExit.bind(this);
    this._onUncaught = this.__onUncaught.bind(this);
  }

  createTempDir(prefix = "rattin-"): string {
    const base = os.tmpdir();
    const name = `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.tempDir = path.join(base, name);

    fs.mkdirSync(this.tempDir, { recursive: true });
    this.log(`Temp dir: ${this.tempDir}`);

    return this.tempDir;
  }

  getTempDir(): string {
    if (!this.tempDir) this.createTempDir();
    return this.tempDir!;
  }

  onCleanup(callback: () => Promise<void> | void): void {
    this.cleanupCallbacks.push(callback);
  }

  installHandlers(): void {
    process.on("SIGINT", this._onSignal);
    process.on("SIGTERM", this._onSignal);
    process.on("exit", this._onExit);
    process.on("uncaughtException", this._onUncaught);
  }

  removeHandlers(): void {
    process.removeListener("SIGINT", this._onSignal);
    process.removeListener("SIGTERM", this._onSignal);
    process.removeListener("exit", this._onExit);
    process.removeListener("uncaughtException", this._onUncaught);
  }

  async cleanup(): Promise<void> {
    if (this.isCleaningUp) return;
    this.isCleaningUp = true;

    this.log("Cleaning up...");

    for (const cb of this.cleanupCallbacks.reverse()) {
      try {
        await cb();
      } catch (err) {
        this.log(`Cleanup error: ${(err as Error).message}`);
      }
    }

    if (this.tempDir && fs.existsSync(this.tempDir)) {
      try {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
        this.log(`Removed temp dir: ${this.tempDir}`);
      } catch (err) {
        this.log(`Failed to remove temp dir: ${(err as Error).message}`);
      }
    }

    this.log("Cleanup complete");
  }

  async __onSignal(signal: NodeJS.Signals): Promise<void> {
    console.log(`\n  Received ${signal}, cleaning up...`);
    await this.cleanup();
    process.exit(0);
  }

  __onExit(_code: number): void {
    if (this.tempDir && fs.existsSync(this.tempDir)) {
      try {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  async __onUncaught(err: Error): Promise<void> {
    if (
      err &&
      err.message &&
      err.message.includes("Cannot read properties of null")
    ) {
      return; // WebTorrent recovers on next tick
    }
    console.error(`\n  Uncaught error: ${err.message}`);
    await this.cleanup();
    process.exit(1);
  }
}
