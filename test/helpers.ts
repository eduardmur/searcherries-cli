import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { type Io, run } from "../src/cli.js";

export const API = "https://app.searcherries.com/api/v1";

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
}

export interface FakeResponse {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

export type Route = (url: URL) => FakeResponse | undefined;

export interface FakeApi {
  fetch: typeof fetch;
  calls: { url: URL; headers: Headers }[];
}

/** A fetch that answers from the given routes, keyed by path (without /api/v1). */
export function fakeApi(routes: Record<string, FakeResponse | Route>): FakeApi {
  const calls: FakeApi["calls"] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push({ url, headers: new Headers(init?.headers) });
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const route = routes[path];
    const response = typeof route === "function" ? route(url) : route;
    if (!response) {
      return jsonResponse(404, {
        error: { code: "not_found", message: "Not found.", status: 404 },
      });
    }
    return jsonResponse(response.status ?? 200, response.body, response.headers);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function tempConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "searcherries-cli-test-"));
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  stdin?: string;
  tty?: boolean;
  columns?: number;
}

export async function runCli(argv: string[], options: RunOptions = {}): Promise<RunResult> {
  let stdout = "";
  let stderr = "";
  const stdin = new PassThrough();
  if (options.stdin !== undefined) {
    stdin.end(options.stdin);
  }
  const io: Io = {
    argv,
    env: { SEARCHERRIES_CONFIG_DIR: tempConfigDir(), ...options.env },
    stdout: {
      write: (text: string) => {
        stdout += text;
      },
      isTTY: options.tty ?? false,
      columns: options.columns,
    },
    stderr: {
      write: (text: string) => {
        stderr += text;
      },
    },
    stdin,
    fetch: options.fetch,
    sleep: async () => {},
  };
  const code = await run(io);
  return { code, stdout, stderr };
}
