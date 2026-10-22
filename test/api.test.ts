import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../src/api.js";
import { ApiError, CliError, EXIT, UsageError } from "../src/errors.js";
import { API, fakeApi, jsonResponse } from "./helpers.js";

const tokenPage = "https://app.searcherries.com/mcp";

function client(
  fetchImpl: typeof fetch,
  extra: Partial<ConstructorParameters<typeof ApiClient>[0]> = {},
) {
  return new ApiClient({
    baseUrl: API,
    token: "secret",
    tokenPage,
    fetch: fetchImpl,
    sleep: async () => {},
    ...extra,
  });
}

describe("ApiClient.url", () => {
  const api = client(fakeApi({}).fetch);

  it("joins relative paths, with or without the /api/v1 prefix, and adds the query", () => {
    expect(api.url("/projects/1/answers", { limit: "5" }).toString()).toBe(
      `${API}/projects/1/answers?limit=5`,
    );
    expect(api.url("projects").toString()).toBe(`${API}/projects`);
    expect(api.url("/api/v1/projects?x=1").toString()).toBe(`${API}/projects?x=1`);
  });

  it("accepts a full URL under the API, such as an action plan's next_request", () => {
    expect(api.url(`${API}/projects/1/answers?only_flagged=1`).toString()).toBe(
      `${API}/projects/1/answers?only_flagged=1`,
    );
  });

  it("refuses any other host or a path that climbs out of the API", () => {
    expect(() => api.url("https://evil.example/api/v1/projects")).toThrow(UsageError);
    expect(() => api.url("https://app.searcherries.com/mcp")).toThrow(UsageError);
    expect(() => api.url("/../../mcp")).toThrow(UsageError);
    expect(() => api.url("https://app.searcherries.com/api/v1evil")).toThrow(UsageError);
  });
});

describe("ApiClient.get", () => {
  it("sends the token, JSON accept header and a CLI user agent", async () => {
    const fake = fakeApi({
      "/projects": {
        body: { projects: [] },
        headers: { "x-ratelimit-limit": "60", "x-ratelimit-remaining": "59" },
      },
    });
    const response = await client(fake.fetch).get("/projects");
    expect(response.rateLimit).toEqual({ limit: 60, remaining: 59 });
    const headers = fake.calls[0]?.headers;
    expect(headers?.get("authorization")).toBe("Bearer secret");
    expect(headers?.get("accept")).toBe("application/json");
    expect(headers?.get("user-agent")).toMatch(/^searcherries-cli\/\d+\.\d+\.\d+/);
  });

  it("waits out a 429 and retries", async () => {
    let attempts = 0;
    const fake = fakeApi({
      "/projects": () => {
        attempts++;
        return attempts === 1
          ? {
              status: 429,
              body: {
                error: {
                  code: "rate_limited",
                  message: "Too many requests.",
                  status: 429,
                  retry_after: 7,
                },
              },
            }
          : { body: { projects: [] } };
      },
    });
    const sleep = vi.fn(async () => {});
    const onRetry = vi.fn();
    await client(fake.fetch, { sleep, onRetry }).get("/projects");
    expect(attempts).toBe(2);
    expect(sleep).toHaveBeenCalledWith(7000);
    expect(onRetry).toHaveBeenCalledWith(7);
  });

  it("gives up after the retries, and never waits for more than a minute", async () => {
    const limited = {
      status: 429,
      body: {
        error: { code: "rate_limited", message: "Too many requests.", status: 429, retry_after: 5 },
      },
    };
    await expect(
      client(fakeApi({ "/projects": limited }).fetch, { maxRetries: 1 }).get("/projects"),
    ).rejects.toThrow(ApiError);

    const sleep = vi.fn(async () => {});
    const long = {
      status: 429,
      body: {
        error: { code: "rate_limited", message: "Slow down.", status: 429, retry_after: 600 },
      },
    };
    await expect(
      client(fakeApi({ "/projects": long }).fetch, { sleep }).get("/projects"),
    ).rejects.toMatchObject({
      hints: ["Try again in 600 seconds."],
    });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("maps the error envelope to exit codes and hints", async () => {
    const error = (code: string, status: number, extra: object = {}) => ({
      status,
      body: { error: { code, message: `${code} message`, status, ...extra } },
    });
    const fake = fakeApi({
      "/unauth": error("unauthenticated", 401),
      "/plan": error("paid_plan_required", 403, {
        plans_url: "https://app.searcherries.com/plans",
      }),
      "/invalid": error("validation_failed", 422, { errors: { prompt_id: ["Unknown question."] } }),
    });
    const api = client(fake.fetch);

    await expect(api.get("/unauth")).rejects.toMatchObject({ exitCode: EXIT.auth });
    await expect(api.get("/plan")).rejects.toMatchObject({
      exitCode: EXIT.plan,
      hints: expect.arrayContaining(["Plans: https://app.searcherries.com/plans"]),
    });
    await expect(api.get("/invalid")).rejects.toMatchObject({
      exitCode: EXIT.error,
      hints: ["--prompt-id: Unknown question."],
    });
  });

  it("reports answers that are not JSON and unreachable hosts", async () => {
    const html = (async () =>
      new Response("<html>Bad gateway</html>", { status: 502 })) as typeof fetch;
    await expect(client(html).get("/projects")).rejects.toThrow("HTTP 502 without JSON");

    const down = (async () => {
      throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND") });
    }) as typeof fetch;
    await expect(client(down).get("/projects")).rejects.toThrow(
      new CliError("Could not reach app.searcherries.com: getaddrinfo ENOTFOUND"),
    );
  });

  it("builds an envelope for errors without one", async () => {
    const plain = (async () =>
      jsonResponse(503, { message: "Service Unavailable" })) as typeof fetch;
    await expect(client(plain).get("/projects")).rejects.toMatchObject({
      body: { code: "http_error", status: 503 },
    });
  });
});
