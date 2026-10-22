import type { ApiClient } from "./api.js";
import { CliError, UsageError } from "./errors.js";
import { arr, num, obj, str } from "./json.js";

export interface ProjectRow {
  id: number;
  brandName: string;
  website: string | null;
  domain: string | null;
  status: string | null;
}

export function projectRows(data: unknown): ProjectRow[] {
  return arr(obj(data).projects).flatMap((value) => {
    const row = obj(value);
    const id = num(row.id);
    if (id === null) {
      return [];
    }
    const website = str(row.brand_website);
    return [
      {
        id,
        brandName: str(row.brand_name) ?? `Project ${id}`,
        website,
        domain: website ? domainOf(website) : null,
        status: str(row.status),
      },
    ];
  });
}

export function domainOf(website: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(website) ? website : `https://${website}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return website.toLowerCase();
  }
}

/**
 * Exact brand name or domain first, then a fragment of either. Case and a
 * leading "www." are ignored, so "acme", "Acme" and "www.acme.com" all work.
 */
export function matchProjects(rows: ProjectRow[], query: string): ProjectRow[] {
  const needle = query.trim().toLowerCase();
  const asDomain = /[./]/.test(needle) ? domainOf(needle) : needle;
  const exact = rows.filter(
    (row) => row.brandName.toLowerCase() === needle || row.domain === asDomain,
  );
  if (exact.length > 0) {
    return exact;
  }
  return rows.filter(
    (row) => row.brandName.toLowerCase().includes(needle) || row.domain?.includes(asDomain),
  );
}

export function describeProject(row: ProjectRow): string {
  return `${row.id}  ${row.brandName}${row.domain ? ` (${row.domain})` : ""}`;
}

/**
 * Turns the project argument into a numeric id. A number is used as is (the
 * API answers 404 for a project of another account); a name or domain is
 * looked up in the account's projects; no argument works when the account has
 * exactly one project.
 */
export async function resolveProjectId(
  client: ApiClient,
  argument: string | undefined,
): Promise<number> {
  const query = argument?.trim();
  if (query && /^\d+$/.test(query)) {
    return Number(query);
  }

  const rows = projectRows((await client.get("/projects")).data);
  if (rows.length === 0) {
    throw new CliError("This account has no projects yet.", undefined, [
      `Create one at ${new URL(client.baseUrl).origin}/projects`,
    ]);
  }

  if (!query) {
    const [only] = rows;
    if (rows.length === 1 && only) {
      return only.id;
    }
    throw new UsageError("Name the project: an id, a brand name or a domain.", [
      ...rows.map(describeProject),
    ]);
  }

  const matches = matchProjects(rows, query);
  const [match] = matches;
  if (matches.length === 1 && match) {
    return match.id;
  }
  if (matches.length === 0) {
    throw new UsageError(`No project matches "${query}".`, rows.map(describeProject));
  }
  throw new UsageError(`"${query}" matches ${matches.length} projects; use the id.`, [
    ...matches.map(describeProject),
  ]);
}
