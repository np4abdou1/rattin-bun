#!/usr/bin/env bun
/**
 * mycli - A Linux CLI tool powered by z-ai-web-dev-sdk
 *
 * Entry point. Subcommands will be added here once the CLI purpose is defined.
 */

const args = process.argv.slice(2);
const VERSION = "0.1.0";

function printHelp(): void {
  console.log(`
mycli v${VERSION} — A Linux CLI tool powered by z-ai-web-dev-sdk

USAGE
  mycli <command> [options]

COMMANDS
  help, --help, -h    Show this help message
  version, --version  Show version number

  (more commands coming soon — tell me what this CLI should do!)

EXAMPLES
  mycli help
  mycli version
`);
}

function printVersion(): void {
  console.log(`mycli v${VERSION}`);
}

// --- Main ---
const command = args[0];

switch (command) {
  case undefined:
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  case "version":
  case "--version":
  case "-v":
    printVersion();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error("Run 'mycli help' to see available commands.");
    process.exit(1);
}
