import { describe, expect, it } from "vitest";
import { ApiClient } from "../src/api.js";
import { CliError, UsageError } from "../src/errors.js";
import { domainOf, matchProjects, projectRows, resolveProjectId } from "../src/project.js";
import { API, fakeApi } from "./helpers.js";

const projects = {
  projects: [
    { id: 1, brand_name: "Acme", brand_website: "https://www.acme.com", status: "ready" },
    { id: 2, brand_name: "Acme Labs", brand_website: "acmelabs.io", status: "ready" },
    { id: 3, brand_name: "Bolt", brand_website: "https://bolt.example/shop", status: "paused" },
  ],
};

function client(body: unknown) {
  const fake = fakeApi({ "/projects": { body } });
  return {
    fake,
    api: new ApiClient({
      baseUrl: API,
      token: "t",
      tokenPage: "https://app.searcherries.com/mcp",
      fetch: fake.fetch,
    }),
  };
}

describe("matchProjects", () => {
  const rows = projectRows(projects);

  it("prefers an exact brand name or domain over fragments", () => {
    expect(matchProjects(rows, "acme").map((row) => row.id)).toEqual([1]);
    expect(matchProjects(rows, "ACMELABS.IO").map((row) => row.id)).toEqual([2]);
    expect(matchProjects(rows, "www.acme.com").map((row) => row.id)).toEqual([1]);
    expect(matchProjects(rows, "https://bolt.example").map((row) => row.id)).toEqual([3]);
  });

  it("falls back to fragments of either", () => {
    expect(matchProjects(rows, "lab").map((row) => row.id)).toEqual([2]);
    expect(matchProjects(rows, "acm").map((row) => row.id)).toEqual([1, 2]);
    expect(matchProjects(rows, "zzz")).toEqual([]);
  });

  it("normalizes websites to bare domains", () => {
    expect(domainOf("https://www.Example.com/path")).toBe("example.com");
    expect(domainOf("example.org")).toBe("example.org");
  });
});

describe("resolveProjectId", () => {
  it("uses a numeric id without a request", async () => {
    const { api, fake } = client(projects);
    expect(await resolveProjectId(api, "42")).toBe(42);
    expect(fake.calls).toHaveLength(0);
  });

  it("finds a project by name", async () => {
    const { api } = client(projects);
    expect(await resolveProjectId(api, "bolt")).toBe(3);
  });

  it("picks the only project when none is named", async () => {
    const { api } = client({ projects: [projects.projects[0]] });
    expect(await resolveProjectId(api, undefined)).toBe(1);
  });

  it("asks for a name when there are several, listing them", async () => {
    const { api } = client(projects);
    await expect(resolveProjectId(api, undefined)).rejects.toMatchObject({
      constructor: UsageError,
      hints: expect.arrayContaining(["1  Acme (acme.com)", "3  Bolt (bolt.example)"]),
    });
  });

  it("explains ambiguous and unknown names", async () => {
    const { api } = client(projects);
    await expect(resolveProjectId(api, "acm")).rejects.toThrow(
      '"acm" matches 2 projects; use the id.',
    );
    await expect(resolveProjectId(api, "nope")).rejects.toThrow('No project matches "nope".');
  });

  it("says so when the account has no projects", async () => {
    const { api } = client({ projects: [] });
    await expect(resolveProjectId(api, "x")).rejects.toThrow(CliError);
  });
});
