import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  configDir,
  DEFAULT_API_URL,
  deleteConfig,
  normalizeApiUrl,
  readConfig,
  resolveCredentials,
  tokenPage,
  writeConfig,
} from "../src/config.js";
import { CliError, EXIT, UsageError } from "../src/errors.js";
import { tempConfigDir } from "./helpers.js";

describe("configDir", () => {
  it("follows each platform's convention", () => {
    expect(configDir({}, "darwin", "/Users/a")).toBe(
      "/Users/a/Library/Application Support/searcherries",
    );
    expect(configDir({}, "linux", "/home/a")).toBe("/home/a/.config/searcherries");
    expect(configDir({ XDG_CONFIG_HOME: "/xdg" }, "linux", "/home/a")).toBe("/xdg/searcherries");
    expect(configDir({ APPDATA: "C:\\Roaming" }, "win32", "C:\\Users\\a")).toContain(
      "searcherries",
    );
  });

  it("lets SEARCHERRIES_CONFIG_DIR override everything", () => {
    expect(configDir({ SEARCHERRIES_CONFIG_DIR: "/custom" }, "darwin", "/Users/a")).toBe("/custom");
  });
});

describe("saved settings", () => {
  it("are written for the owner only and read back", () => {
    const path = join(tempConfigDir(), "nested", "config.json");
    writeConfig(path, { token: "abc" });
    expect(readConfig(path)).toEqual({ token: "abc", api_url: undefined });
    if (process.platform !== "win32") {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
    expect(deleteConfig(path)).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(deleteConfig(path)).toBe(false);
  });

  it("report a broken file instead of ignoring it", () => {
    const path = join(tempConfigDir(), "config.json");
    writeFileSync(path, "{not json");
    expect(() => readConfig(path)).toThrow(CliError);
  });
});

describe("normalizeApiUrl", () => {
  it("accepts https and loopback http, and drops a trailing slash", () => {
    expect(normalizeApiUrl("https://app.searcherries.com/api/v1/")).toBe(DEFAULT_API_URL);
    expect(normalizeApiUrl("http://127.0.0.1:8765/api/v1")).toBe("http://127.0.0.1:8765/api/v1");
    expect(normalizeApiUrl("http://localhost:8000/api/v1")).toBe("http://localhost:8000/api/v1");
  });

  it("refuses plain http to another host, credentials and queries", () => {
    expect(() => normalizeApiUrl("http://example.com/api/v1")).toThrow(UsageError);
    expect(() => normalizeApiUrl("https://user:pw@example.com/api/v1")).toThrow(UsageError);
    expect(() => normalizeApiUrl("https://example.com/api/v1?x=1")).toThrow(UsageError);
    expect(() => normalizeApiUrl("not a url")).toThrow(UsageError);
  });
});

describe("resolveCredentials", () => {
  it("prefers SEARCHERRIES_TOKEN over the saved token", () => {
    const dir = tempConfigDir();
    writeConfig(join(dir, "config.json"), { token: "saved" });
    const credentials = resolveCredentials({
      SEARCHERRIES_CONFIG_DIR: dir,
      SEARCHERRIES_TOKEN: " env ",
    });
    expect(credentials).toMatchObject({
      token: "env",
      tokenSource: "env",
      apiUrl: DEFAULT_API_URL,
    });
  });

  it("uses the saved token with the API it was checked against", () => {
    const dir = tempConfigDir();
    writeConfig(join(dir, "config.json"), {
      token: "saved",
      api_url: "http://127.0.0.1:8765/api/v1",
    });
    expect(resolveCredentials({ SEARCHERRIES_CONFIG_DIR: dir })).toMatchObject({
      token: "saved",
      tokenSource: "config",
      apiUrl: "http://127.0.0.1:8765/api/v1",
    });
  });

  it("never sends a saved token to a different API", () => {
    const dir = tempConfigDir();
    writeConfig(join(dir, "config.json"), { token: "saved" });
    expect(() =>
      resolveCredentials({
        SEARCHERRIES_CONFIG_DIR: dir,
        SEARCHERRIES_API_URL: "https://staging.example/api/v1",
      }),
    ).toThrow(UsageError);
  });

  it("reports no token when nothing is saved", () => {
    expect(resolveCredentials({ SEARCHERRIES_CONFIG_DIR: tempConfigDir() })).toMatchObject({
      token: null,
      tokenSource: null,
    });
  });
});

it("points to the token page of the app behind the API", () => {
  expect(tokenPage(DEFAULT_API_URL)).toBe("https://app.searcherries.com/mcp");
  expect(EXIT.auth).toBe(3);
});
