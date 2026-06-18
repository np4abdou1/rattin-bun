/**
 * Dependency checker — verifies mpv and fzf are installed.
 */
import { execSync } from "node:child_process";
import chalk from "chalk";

interface Dep {
  cmd: string;
  name: string;
  min: string | null;
  found?: string;
}

const REQUIRED: Dep[] = [
  { cmd: "mpv", name: "MPV player", min: null },
  { cmd: "fzf", name: "fzf", min: null },
];

function getVersion(cmd: string): string | null {
  try {
    const out = execSync(`${cmd} --version 2>&1`, {
      encoding: "utf-8",
      timeout: 5000,
    });
    const m = out.match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : "unknown";
  } catch {
    return null;
  }
}

export function checkDeps(): void {
  const missing: Dep[] = [];

  for (const dep of REQUIRED) {
    const ver = getVersion(dep.cmd);
    if (!ver) {
      missing.push(dep);
    }
  }

  if (missing.length > 0) {
    console.error(chalk.red.bold("\n  ✗ Missing dependencies:\n"));
    for (const m of missing) {
      console.error(chalk.red(`    ${m.name}: not found`));
    }
    console.error(chalk.gray("\n  Install instructions:"));
    console.error(chalk.gray("    Ubuntu/Debian:"));
    console.error(chalk.cyan("      sudo apt install mpv fzf"));
    console.error(chalk.gray("    macOS:"));
    console.error(chalk.cyan("      brew install mpv fzf"));
    console.error(chalk.gray("    Arch:"));
    console.error(chalk.cyan("      sudo pacman -S mpv fzf\n"));
    process.exit(1);
  }
}

export function checkDepsOnly(): void {
  console.log(chalk.cyan.bold("\n  Checking dependencies...\n"));
  let allOk = true;
  for (const dep of REQUIRED) {
    const ver = getVersion(dep.cmd);
    if (ver) {
      console.log(chalk.green(`  ✓ ${dep.name}: v${ver}`));
    } else {
      console.log(chalk.red(`  ✗ ${dep.name}: not found`));
      allOk = false;
    }
  }

  // Also check TMDB key
  const tmdbKey = process.env.TMDB_API_KEY;
  if (tmdbKey) {
    console.log(chalk.green("  ✓ TMDB API key: set"));
  } else {
    console.log(chalk.red("  ✗ TMDB API key: not set (export TMDB_API_KEY=...)"));
    allOk = false;
  }

  // Check webtorrent-cli (needed by mpv's webtorrent-hook plugin for streaming)
  const wtVer = getVersion("webtorrent");
  if (wtVer) {
    console.log(chalk.green(`  ✓ webtorrent-cli: v${wtVer}`));
  } else {
    console.log(chalk.yellow("  ⚠ webtorrent-cli: not found (install with: npm i -g webtorrent-cli)"));
    console.log(chalk.gray("    (only needed if your mpv config uses the webtorrent-hook plugin)"));
  }

  if (allOk) {
    console.log(chalk.green.bold("\n  All good! Run `rattin` to start.\n"));
  } else {
    console.log(chalk.yellow("\n  Some dependencies missing. See above.\n"));
  }
}
