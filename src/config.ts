import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CliError, UsageError } from "./errors.js";

export const DEFAULT_API_URL = "https://app.searcherries.com/api/v1";

/** What `searcherries login` stores. The API URL is kept so a token is only sent where it was checked. */
export interface StoredConfig {
  token?: string;
  api_url?: string;
}

export type TokenSource = "env" | "config";

export interface Credentials {
  token: string | null;
  tokenSource: TokenSource | null;
  apiUrl: string;
  configPath: string;
}

/**
 * Where the token is saved:
 *   macOS    ~/Library/Application Support/searcherries
 *   Windows  %APPDATA%\searcherries
 *   Linux    $XDG_CONFIG_HOME/searcherries or ~/.config/searcherries
 * SEARCHERRIES_CONFIG_DIR overrides all three.
 */
export function configDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (env.SEARCHERRIES_CONFIG_DIR) {
    return env.SEARCHERRIES_CONFIG_DIR;
  }
  if (platform === "win32") {
    return join(env.APPDATA || join(home, "AppData", "Roaming"), "searcherries");
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "searcherries");
  }
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "searcherries");
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), "config.json");
}

export function readConfig(path: string): StoredConfig {
  if (!existsSync(path)) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new CliError(`The saved settings at ${path} are not valid JSON.`, undefined, [
      "Run: searcherries logout, then sign in again.",
    ]);
  }
  const config = parsed !== null && typeof parsed === "object" ? (parsed as StoredConfig) : {};
  return {
    token: typeof config.token === "string" ? config.token : undefined,
    api_url: typeof config.api_url === "string" ? config.api_url : undefined,
  };
}

/** Writes through a temporary file so a crash never leaves half a token behind; owner-only permissions. */
export function writeConfig(path: string, config: StoredConfig): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

export function deleteConfig(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  rmSync(path);
  return true;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A token travels only over HTTPS, except to this machine (local development). */
export function normalizeApiUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError(`SEARCHERRIES_API_URL is not a URL: ${raw}`);
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new UsageError(`The API URL must use https: ${raw}`);
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new UsageError(`The API URL must not carry credentials, a query or a fragment: ${raw}`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** The token comes from SEARCHERRIES_TOKEN first, then from the saved settings. */
export function resolveCredentials(env: NodeJS.ProcessEnv = process.env): Credentials {
  const path = configPath(env);
  const envToken = env.SEARCHERRIES_TOKEN?.trim();
  const envUrl = env.SEARCHERRIES_API_URL?.trim();

  if (envToken) {
    return {
      token: envToken,
      tokenSource: "env",
      apiUrl: normalizeApiUrl(envUrl || DEFAULT_API_URL),
      configPath: path,
    };
  }

  const stored = readConfig(path);
  const token = stored.token?.trim() || null;
  const savedUrl = normalizeApiUrl(stored.api_url || DEFAULT_API_URL);
  const apiUrl = envUrl ? normalizeApiUrl(envUrl) : savedUrl;

  if (token && apiUrl !== savedUrl) {
    throw new UsageError(`The saved token was checked against ${savedUrl}, not ${apiUrl}.`, [
      "Set SEARCHERRIES_TOKEN for this API, or run searcherries login again with SEARCHERRIES_API_URL set.",
    ]);
  }

  return { token, tokenSource: token ? "config" : null, apiUrl, configPath: path };
}

/** The page where tokens are created: /mcp on the app that serves the API. */
export function tokenPage(apiUrl: string): string {
  return `${new URL(apiUrl).origin}/mcp`;
}
