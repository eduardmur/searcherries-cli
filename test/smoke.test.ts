import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tempConfigDir } from "./helpers.js";

const BIN = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function bin(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, SEARCHERRIES_CONFIG_DIR: tempConfigDir(), ...env },
  });
}

describe("built binary", () => {
  it("prints the version and help", () => {
    const version = bin(["--version"]);
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(bin(["--help"]).stdout).toContain("SEARCHERRIES_TOKEN");
  });

  it("exits 3 when nobody is signed in, without touching the network", () => {
    const result = bin(["projects"]);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("Not signed in.");
  });

  it("exits 2 on a usage error", () => {
    expect(bin(["projects", "--nope"]).status).toBe(2);
  });
});
