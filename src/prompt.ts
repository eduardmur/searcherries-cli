import { CliError, EXIT } from "./errors.js";

export interface InputStream extends NodeJS.EventEmitter {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  setEncoding(encoding: BufferEncoding): unknown;
  resume(): unknown;
  pause(): unknown;
}

/** Reads a line from a terminal without echoing it, for pasting a token. */
export function readHidden(
  input: InputStream,
  output: { write(text: string): unknown },
  prompt: string,
): Promise<string> {
  output.write(prompt);
  input.setRawMode?.(true);
  input.setEncoding("utf8");
  input.resume();

  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (done: () => void) => {
      input.setRawMode?.(false);
      input.pause();
      input.off("data", onData);
      output.write("\n");
      done();
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          finish(() => resolve(value));
          return;
        }
        if (char === "\u0003") {
          finish(() => reject(new CliError("Cancelled.", EXIT.interrupted)));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    input.on("data", onData);
  });
}

/** Reads everything piped in, for `echo $TOKEN | searcherries login`. */
export function readAll(input: InputStream): Promise<string> {
  input.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    input.on("data", (chunk: string) => {
      value += chunk;
    });
    input.on("end", () => resolve(value));
    input.on("error", reject);
    input.resume();
  });
}
