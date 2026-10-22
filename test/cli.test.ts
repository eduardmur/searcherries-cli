import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_COMMANDS } from "../src/commands.js";
import { EXIT } from "../src/errors.js";
import { fakeApi, fixture, runCli, tempConfigDir } from "./helpers.js";

const TOKEN_ENV = { SEARCHERRIES_TOKEN: "test-token" };

function paidApi() {
  return fakeApi({
    "/projects": { body: fixture("projects") },
    "/projects/1": { body: fixture("summary") },
    "/projects/1/answers": { body: fixture("answers") },
    "/projects/1/competitors": { body: fixture("competitors") },
    "/projects/1/action-plan": { body: fixture("plan") },
  });
}

describe("help and version", () => {
  it("prints the main help without arguments and with --help", async () => {
    for (const argv of [[], ["--help"], ["help"]]) {
      const result = await runCli(argv);
      expect(result.code).toBe(EXIT.ok);
      expect(result.stdout).toContain("searcherries <command> [project] [options]");
      for (const command of DATA_COMMANDS) {
        expect(result.stdout).toContain(`  ${command.name} `);
      }
    }
  });

  it("prints command help, which lists every option", async () => {
    const result = await runCli(["answers", "--help"]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toContain("--prominence-max <integer>");
    expect(result.stdout).toContain("--all");
    expect((await runCli(["help", "competitors"])).stdout).toContain("--no-highlights");
  });

  it("prints the version", async () => {
    expect((await runCli(["--version"])).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("rejects unknown commands and options with exit code 2", async () => {
    const command = await runCli(["frobnicate"]);
    expect(command.code).toBe(EXIT.usage);
    expect(command.stderr).toContain('Unknown command "frobnicate"');

    const option = await runCli(["answers", "--bogus"], { env: TOKEN_ENV });
    expect(option.code).toBe(EXIT.usage);
    expect(option.stderr).toContain("Unknown option --bogus.");
    expect(option.stderr).toContain("searcherries answers --help");
  });
});

describe("login, status and logout", () => {
  it("checks a piped token, saves it for the owner only and uses it afterwards", async () => {
    const dir = tempConfigDir();
    const api = paidApi();
    const login = await runCli(["login"], {
      env: { SEARCHERRIES_CONFIG_DIR: dir },
      stdin: "  piped-token \n",
      fetch: api.fetch,
    });
    expect(login.code).toBe(EXIT.ok);
    expect(login.stdout).toContain("Signed in. 2 projects.");
    expect(login.stdout).not.toContain("piped-token");
    expect(api.calls[0]?.headers.get("authorization")).toBe("Bearer piped-token");

    const path = join(dir, "config.json");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ token: "piped-token" });
    if (process.platform !== "win32") {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }

    const status = await runCli(["status"], {
      env: { SEARCHERRIES_CONFIG_DIR: dir },
      fetch: paidApi().fetch,
    });
    expect(status.code).toBe(EXIT.ok);
    expect(status.stdout).toContain(`Token: saved in ${path}`);

    const logout = await runCli(["logout"], { env: { SEARCHERRIES_CONFIG_DIR: dir } });
    expect(logout.stdout).toContain(
      "keeps working until you revoke it at https://app.searcherries.com/mcp",
    );
    expect(existsSync(path)).toBe(false);
  });

  it("saves nothing when the token is rejected", async () => {
    const dir = tempConfigDir();
    const api = fakeApi({
      "/projects": {
        status: 401,
        body: {
          error: {
            code: "unauthenticated",
            message: "A valid bearer token is required.",
            status: 401,
          },
        },
      },
    });
    const login = await runCli(["login"], {
      env: { SEARCHERRIES_CONFIG_DIR: dir },
      stdin: "bad",
      fetch: api.fetch,
    });
    expect(login.code).toBe(EXIT.auth);
    expect(login.stderr).toContain("Searcherries did not accept this token.");
    expect(existsSync(join(dir, "config.json"))).toBe(false);
  });

  it("refuses an empty token or one with spaces", async () => {
    expect((await runCli(["login"], { stdin: "\n" })).code).toBe(EXIT.usage);
    expect((await runCli(["login"], { stdin: "two words" })).code).toBe(EXIT.usage);
  });

  it("exits 3 with instructions when nobody is signed in", async () => {
    const result = await runCli(["projects"]);
    expect(result.code).toBe(EXIT.auth);
    expect(result.stderr).toContain("Not signed in.");
    expect(result.stderr).toContain("https://app.searcherries.com/mcp");
  });
});

describe("data commands", () => {
  it("lists projects as a table", async () => {
    const result = await runCli(["projects"], { env: TOKEN_ENV, fetch: paidApi().fetch });
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toMatch(/ID\s+Project\s+Website/);
    expect(result.stdout).toContain("Second Brand");
  });

  it("prints the API response unchanged with --json", async () => {
    const result = await runCli(["summary", "1", "--json"], {
      env: TOKEN_ENV,
      fetch: paidApi().fetch,
    });
    expect(JSON.parse(result.stdout)).toEqual(fixture("summary"));
  });

  it("resolves a project name through the project list", async () => {
    const api = paidApi();
    const result = await runCli(["summary", "acme"], { env: TOKEN_ENV, fetch: api.fetch });
    expect(result.code).toBe(EXIT.ok);
    expect(api.calls.map((call) => call.url.pathname)).toEqual([
      "/api/v1/projects",
      "/api/v1/projects/1",
    ]);
    expect(result.stdout).toContain("Acme · example.com");
    expect(result.stdout).toContain("Named share       50% of 42 usable answers (−7.1 pts)");
    expect(result.stdout).toContain("Report: https://app.searcherries.com/projects/1");
  });

  it("uses SEARCHERRIES_PROJECT when no project is given", async () => {
    const api = paidApi();
    await runCli(["answers"], {
      env: { ...TOKEN_ENV, SEARCHERRIES_PROJECT: "1" },
      fetch: api.fetch,
    });
    expect(api.calls.map((call) => call.url.pathname)).toEqual(["/api/v1/projects/1/answers"]);
  });

  it("maps flags to query parameters", async () => {
    const api = paidApi();
    await runCli(
      [
        "answers",
        "1",
        "--platform",
        "chatgpt",
        "--prominence-max",
        "1",
        "--only-flagged",
        "--since",
        "2026-10-01",
        "--limit",
        "5",
      ],
      { env: TOKEN_ENV, fetch: api.fetch },
    );
    expect(Object.fromEntries(api.calls[0]?.url.searchParams ?? [])).toEqual({
      platform: "chatgpt",
      prominence_max: "1",
      only_flagged: "1",
      since: "2026-10-01",
      limit: "5",
    });
  });

  it("turns --competitor into the detail dataset and --no-highlights into include_highlights=0", async () => {
    const api = paidApi();
    await runCli(["competitors", "1", "--competitor", "rival"], {
      env: TOKEN_ENV,
      fetch: api.fetch,
    });
    await runCli(["competitors", "1", "--no-highlights"], { env: TOKEN_ENV, fetch: api.fetch });
    expect(Object.fromEntries(api.calls[0]?.url.searchParams ?? [])).toEqual({
      competitor: "rival",
      dataset: "detail",
    });
    expect(Object.fromEntries(api.calls[1]?.url.searchParams ?? [])).toEqual({
      include_highlights: "0",
    });
  });

  it("checks value types before calling the API", async () => {
    const api = paidApi();
    const result = await runCli(["answers", "1", "--since", "yesterday"], {
      env: TOKEN_ENV,
      fetch: api.fetch,
    });
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toContain("--since needs a date as YYYY-MM-DD");
    expect(api.calls).toHaveLength(0);
  });

  it("renders answers, competitors and the action plan", async () => {
    const api = paidApi();
    const answers = await runCli(["answers", "1"], { env: TOKEN_ENV, fetch: api.fetch });
    expect(answers.stdout).toContain("top recommendation");
    expect(answers.stdout).toContain("Next page: --offset 3, or --all for every row.");

    const competitors = await runCli(["competitors", "1"], { env: TOKEN_ENV, fetch: api.fetch });
    expect(competitors.stdout).toMatch(/1\s+Rival\s+rival\.example\s+99%/);
    expect(competitors.stdout).toContain("Acme (you)");

    const plan = await runCli(["plan", "1"], { env: TOKEN_ENV, fetch: api.fetch });
    expect(plan.stdout).toContain("1. Review what AI says about your brand (marketing)");
    expect(plan.stdout).toContain(
      "searcherries api '/projects/1/answers?period=last_30_days&only_flagged=1&include_answer_text=1&limit=5'",
    );
    expect(plan.stdout).toContain(
      "at https://app.searcherries.com/projects/1/connect to include it",
    );
  });

  it("fetches every page with --all and returns one document", async () => {
    const all = Array.from({ length: 7 }, (_, index) => ({
      id: index + 1,
      question: `Q${index + 1}`,
    }));
    const api = fakeApi({
      "/projects/1/answers": (url) => {
        const offset = Number(url.searchParams.get("offset"));
        const limit = Number(url.searchParams.get("limit"));
        const rows = all.slice(offset, offset + limit);
        return {
          body: {
            project: { id: 1 },
            rows,
            pagination: {
              offset,
              limit,
              returned: rows.length,
              total: all.length,
              has_more: offset + rows.length < all.length,
            },
          },
        };
      },
    });
    const result = await runCli(["answers", "1", "--all", "--limit", "3", "--json"], {
      env: TOKEN_ENV,
      fetch: api.fetch,
    });
    const data = JSON.parse(result.stdout);
    expect(data.rows.map((row: { id: number }) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(data.pagination).toEqual({
      offset: 0,
      limit: 3,
      returned: 7,
      total: 7,
      has_more: false,
    });
    expect(api.calls.map((call) => call.url.searchParams.get("offset"))).toEqual(["0", "3", "6"]);
  });

  it("exits 4 with the plans link when the plan does not include the endpoint", async () => {
    const api = fakeApi({
      "/projects/3/answers": {
        status: 403,
        body: {
          error: {
            code: "paid_plan_required",
            message: "Please choose a paid plan to continue.",
            status: 403,
            plans_url: "https://app.searcherries.com/plans",
          },
        },
      },
    });
    const human = await runCli(["answers", "3"], { env: TOKEN_ENV, fetch: api.fetch });
    expect(human.code).toBe(EXIT.plan);
    expect(human.stdout).toBe("");
    expect(human.stderr).toContain("Plans: https://app.searcherries.com/plans");

    const json = await runCli(["answers", "3", "--json"], { env: TOKEN_ENV, fetch: api.fetch });
    expect(json.code).toBe(EXIT.plan);
    expect(json.stdout).toBe("");
    expect(JSON.parse(json.stderr).error.code).toBe("paid_plan_required");
  });
});

describe("api", () => {
  it("prints any API path as JSON, and follows full URLs under the API", async () => {
    const api = paidApi();
    const relative = await runCli(["api", "/projects/1/answers?limit=1"], {
      env: TOKEN_ENV,
      fetch: api.fetch,
    });
    expect(JSON.parse(relative.stdout)).toEqual(fixture("answers"));
    const full = await runCli(["api", "https://app.searcherries.com/api/v1/projects"], {
      env: TOKEN_ENV,
      fetch: api.fetch,
    });
    expect(JSON.parse(full.stdout)).toEqual(fixture("projects"));
    expect(api.calls[0]?.url.search).toBe("?limit=1");
  });

  it("refuses URLs outside the API without sending the token", async () => {
    const api = paidApi();
    const result = await runCli(["api", "https://evil.example/api/v1/projects"], {
      env: TOKEN_ENV,
      fetch: api.fetch,
    });
    expect(result.code).toBe(EXIT.usage);
    expect(api.calls).toHaveLength(0);
  });
});

describe("terminal output", () => {
  it("fits tables to the terminal width and keeps piped output whole", async () => {
    const api = paidApi();
    const narrow = await runCli(["answers", "1"], {
      env: TOKEN_ENV,
      fetch: api.fetch,
      tty: true,
      columns: 80,
    });
    const visible = narrow.stdout.replace(
      new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
      "",
    );
    expect(Math.max(...visible.split("\n").map((line) => line.length))).toBeLessThanOrEqual(80);

    const piped = await runCli(["answers", "1"], { env: TOKEN_ENV, fetch: api.fetch });
    expect(piped.stdout).toContain("Which analytics platform should I use?");
    expect(piped.stdout).not.toContain(String.fromCharCode(27));
  });

  it("honours NO_COLOR on a terminal", async () => {
    const result = await runCli(["projects"], {
      env: { ...TOKEN_ENV, NO_COLOR: "1" },
      fetch: paidApi().fetch,
      tty: true,
      columns: 120,
    });
    expect(result.stdout).not.toContain(String.fromCharCode(27));
  });
});
