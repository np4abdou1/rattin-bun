/**
 * fzf wrapper — launches fzf with choices and returns the selected value.
 * Colors render in fzf; matching uses ANSI-stripped text.
 */
import { spawn } from "node:child_process";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "");
}

export interface FzfChoice<T> {
  name: string;
  value: T;
}

/**
 * Launch fzf with choices and return the selected value.
 */
export function fzfSelect<T>(choices: FzfChoice<T>[], prompt = "Select"): Promise<T> {
  return new Promise((resolve, reject) => {
    const strippedMap = new Map<string, FzfChoice<T>>();
    for (const c of choices) {
      strippedMap.set(stripAnsi(c.name).trim(), c);
    }

    const fzf = spawn(
      "fzf",
      [
        "--prompt",
        `${prompt} > `,
        "--ansi",
        "--height",
        "40",
        "--reverse",
        "--border",
        "--info",
        "inline",
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    fzf.stdin.write(choices.map((c) => c.name).join("\n"));
    fzf.stdin.end();

    let stdout = "";
    fzf.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    fzf.on("close", (code) => {
      if (code !== 0 || !stdout.trim()) {
        reject(new Error("ExitPromptError"));
        return;
      }

      const selected = stripAnsi(stdout.trim());
      const choice = strippedMap.get(selected);
      if (choice) {
        resolve(choice.value);
      } else {
        reject(new Error("No matching choice found"));
      }
    });

    fzf.on("error", (err) => reject(err));
  });
}
