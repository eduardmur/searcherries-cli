import { arr, isObj, num, type Obj, obj, objs, str } from "../json.js";
import { domainOf } from "../project.js";
import {
  cell,
  DASH,
  day,
  decimal,
  genericTable,
  indent,
  int,
  keyValues,
  label,
  oneLine,
  percent,
  periodLabel,
  points,
  type RenderContext,
  ratio,
  table,
  truncate,
  words,
  yesNo,
} from "./format.js";

export type Renderer = (data: unknown, ctx: RenderContext) => string[];

const SOURCE_NAMES: Record<string, string> = {
  ga4: "GA4",
  google_search_console: "Search Console",
  bing_webmaster_tools: "Bing",
  google: "Google Search Console",
  bing: "Bing Webmaster Tools",
};

const UPGRADE = "upgrade_required";

function heading(text: string, ctx: RenderContext): string[] {
  return ["", ctx.style.bold(text)];
}

/** "Acme · example.com" from the `project` object most responses carry. */
function projectLine(data: Obj, ctx: RenderContext, what: string): string {
  const project = obj(data.project);
  const brand = str(project.brand_name) ?? `Project ${num(project.id) ?? "?"}`;
  const website = str(project.brand_website);
  return ctx.style.bold(`${brand}${website ? ` · ${domainOf(website)}` : ""} · ${what}`);
}

function freshness(data: Obj): string {
  const fetched = str(data.fetched_at);
  if (!fetched) {
    return "";
  }
  return `fetched ${day(fetched)}${data.is_stale === true ? ", stale" : ""}`;
}

function paginationFooter(data: Obj, ctx: RenderContext): string[] {
  const page = obj(data.pagination);
  const total = num(page.total);
  const offset = num(page.offset) ?? 0;
  const returned = num(page.returned) ?? 0;
  if (total === null || returned === 0 || (offset === 0 && returned >= total)) {
    return [];
  }
  const lines = [`Rows ${offset + 1}–${offset + returned} of ${int(total)}.`];
  if (page.has_more === true) {
    lines.push(`Next page: --offset ${offset + returned}, or --all for every row.`);
  }
  return ["", ...lines.map(ctx.style.dim)];
}

function upgradeLines(block: Obj, ctx: RenderContext): string[] {
  const message = str(block.message) ?? "Not included in the current plan.";
  const plans = str(block.plans_url);
  return [message, ...(plans ? [ctx.style.dim(`Plans: ${plans}`)] : [])];
}

/**
 * API messages are written for AI assistants and name link fields
 * ("connect them at connect_url"); a person gets the URL itself.
 */
export function withLinks(message: string, source: Obj): { text: string; linked: boolean } {
  let linked = false;
  const text = message.replace(/\b(connect_url|plans_url|report_url)\b/g, (field) => {
    const url = str(source[field]);
    if (!url) {
      return field;
    }
    linked = true;
    return url;
  });
  return { text, linked };
}

function unavailable(data: Obj, ctx: RenderContext, what: string): string[] {
  return [projectLine(data, ctx, what), str(data.reason) ?? "No stored data."];
}

// projects ------------------------------------------------------------------

export const renderProjects: Renderer = (data, ctx) => {
  const rows = objs(obj(data).projects);
  if (rows.length === 0) {
    return ["No projects yet."];
  }
  return table(
    rows,
    [
      { header: "ID", value: (row) => int(row.id), align: "right" },
      { header: "Project", value: (row) => str(row.brand_name) ?? DASH, flex: true },
      {
        header: "Website",
        value: (row) => {
          const website = str(row.brand_website);
          return website ? domainOf(website) : DASH;
        },
        flex: true,
      },
      { header: "Status", value: (row) => str(row.status) ?? DASH },
      { header: "Plan", value: (row) => str(row.plan) ?? DASH },
      { header: "AI tracking", value: (row) => yesNo(row.ai_tracking) },
      { header: "Last check", value: (row) => day(row.last_checked_at) },
      {
        header: "Connected",
        value: (row) => {
          const names = Object.entries(obj(row.connections))
            .filter(([, connected]) => connected === true)
            .map(([key]) => SOURCE_NAMES[key] ?? key);
          return names.length > 0 ? names.join(", ") : DASH;
        },
      },
    ],
    ctx,
  );
};

// summary -------------------------------------------------------------------

export const renderSummary: Renderer = (raw, ctx) => {
  const data = obj(raw);
  const profile = obj(data.profile);
  const brand = str(profile.brand_name) ?? `Project ${num(data.project_id) ?? "?"}`;
  const domain = str(profile.domain);
  const market = [str(profile.country_name) ?? "Global", str(profile.language_name)]
    .filter(Boolean)
    .join(", ");

  const lines = [ctx.style.bold(`${brand}${domain ? ` · ${domain}` : ""}`)];
  if (isObj(data.profile)) {
    lines.push(
      `${market} · ${str(profile.status) ?? DASH} · last check ${day(profile.last_checked_at)}`,
    );
  }
  lines.push(`AI period: ${periodLabel(data.period)}`);

  const account = obj(data.account);
  if (str(account.message)) {
    lines.push(...heading("Free plan", ctx), withLinks(str(account.message) ?? "", account).text);
  }

  lines.push(...summaryVisibility(data, ctx));
  lines.push(...summaryQuestions(obj(data.questions), ctx));
  lines.push(...summaryCompetitors(obj(data.competitors), ctx));
  lines.push(...summaryCitations(obj(data.citations), ctx));
  lines.push(...summarySearch(obj(data.search), ctx));
  lines.push(...summaryTraffic(obj(data.ai_traffic), ctx));
  lines.push(...summaryConnections(obj(data.connections), ctx));

  const latest = obj(obj(data.recommendations).latest);
  const recommendation = str(latest.summary) ?? str(latest.title);
  if (recommendation) {
    lines.push(...heading("Latest recommendation", ctx), truncate(oneLine(recommendation), 600));
  }

  const report = str(data.report_url);
  if (report) {
    lines.push("", ctx.style.dim(`Report: ${report}`));
  }
  return lines;
};

/** The AI blocks of a summary; on a plan without AI tracking they all carry the same notice. */
const AI_BLOCKS = ["ai_visibility", "answer_insights", "competitors", "citations"] as const;

function summaryVisibility(data: Obj, ctx: RenderContext): string[] {
  const locked = AI_BLOCKS.map((key) => obj(data[key])).find((block) => block.status === UPGRADE);
  if (locked) {
    return [...heading("AI visibility", ctx), ...upgradeLines(locked, ctx)];
  }
  if (!("ai_visibility" in data) && !("answer_insights" in data)) {
    return [];
  }
  const visibility = obj(data.ai_visibility);
  const insights = obj(data.answer_insights);
  const lines = heading("AI visibility", ctx);

  if (visibility.available === false) {
    return [
      ...lines,
      str(visibility.message) ?? str(visibility.reason) ?? "No completed checks yet.",
    ];
  }

  const previous = obj(visibility.previous_period);
  const pairs: [string, string][] = [
    ["Visibility score", decimal(visibility.visibility_score)],
    [
      "Brand named",
      `${percent(visibility.mentions_percentage)} of ${int(visibility.total_checks)} checks` +
        (num(previous.change) === null ? "" : ` (${points(previous.change)})`),
    ],
  ];
  if (str(insights.status) === "ready") {
    pairs.push(
      [
        "Named share",
        `${percent(insights.named_share)} of ${int(insights.usable)} usable answers` +
          (num(insights.named_share_delta) === null
            ? ""
            : ` (${points(insights.named_share_delta)})`),
      ],
      ["Top pick", percent(insights.top_pick_share)],
      [
        "Flagged",
        `${int(insights.negative)} negative, ${int(insights.drawback)} drawback, ${int(insights.off_topic)} off topic`,
      ],
    );
  }
  const byPlatform = Object.entries(obj(visibility.mentions_by_platform));
  if (byPlatform.length > 0) {
    pairs.push([
      "Mentions",
      byPlatform.map(([platform, count]) => `${platform} ${int(count)}`).join(" · "),
    ]);
  }
  return [...lines, ...keyValues(pairs, ctx)];
}

function summaryQuestions(questions: Obj, ctx: RenderContext): string[] {
  const primary = obj(questions.primary);
  const additional = objs(questions.additional);
  if (!str(primary.question) && additional.length === 0) {
    return [];
  }
  const rows = [...(str(primary.question) ? [{ ...primary, primary: true }] : []), ...additional];
  const hidden = num(questions.additional_not_shown) ?? 0;
  return [
    ...heading(`Questions (${int(questions.active_total ?? rows.length)})`, ctx),
    ...table(
      rows,
      [
        { header: "ID", value: (row) => int(row.id), align: "right" },
        { header: "Question", value: (row) => str(row.question) ?? DASH, flex: true },
        { header: "Checked", value: (row) => str(row.cadence) ?? DASH },
        { header: "Last", value: (row) => day(row.last_checked_at) },
      ],
      ctx,
    ),
    ...(hidden > 0 ? [ctx.style.dim(`and ${int(hidden)} more`)] : []),
  ];
}

function summaryCompetitors(competitors: Obj, ctx: RenderContext): string[] {
  if (competitors.status === UPGRADE) {
    return []; // summaryVisibility shows the plan notice once
  }
  const own = obj(competitors.own_brand);
  const rows = [...objs(competitors.top)];
  if (str(own.competitor_name) && !rows.some((row) => row.rank === own.rank)) {
    rows.push(own);
  }
  if (rows.length === 0) {
    return [];
  }
  rows.sort((a, b) => (num(a.rank) ?? 999) - (num(b.rank) ?? 999));
  return [...heading("Competitors", ctx), ...competitorTable(rows, own, ctx)];
}

function competitorTable(rows: Obj[], own: Obj, ctx: RenderContext): string[] {
  const ownName = str(own.competitor_name);
  return table(
    rows,
    [
      { header: "Rank", value: (row) => int(row.rank), align: "right" },
      {
        header: "Brand",
        value: (row) =>
          `${str(row.competitor_name) ?? DASH}${row.is_own_brand === true || (ownName && row.competitor_name === ownName && row.rank === own.rank) ? " (you)" : ""}`,
        flex: true,
      },
      {
        header: "Website",
        value: (row) => {
          const website = str(row.competitor_website);
          return website ? domainOf(website) : DASH;
        },
        flex: true,
      },
      { header: "Visibility", value: (row) => percent(row.visibility_percentage), align: "right" },
      { header: "Mentions", value: (row) => int(row.mention_count), align: "right" },
      { header: "Citations", value: (row) => int(row.citation_count), align: "right" },
      { header: "Avg position", value: (row) => decimal(row.average_position), align: "right" },
    ],
    ctx,
  );
}

function summaryCitations(citations: Obj, ctx: RenderContext): string[] {
  if (citations.status === UPGRADE) {
    return [];
  }
  const rows = objs(citations.top_domains);
  if (rows.length === 0) {
    return [];
  }
  return [...heading("Cited domains", ctx), ...domainTable(rows, ctx)];
}

function domainTable(rows: Obj[], ctx: RenderContext): string[] {
  return table(
    rows,
    [
      {
        header: "Domain",
        value: (row) =>
          `${str(row.website_domain) ?? DASH}${row.is_own_site === true ? " (you)" : ""}`,
        flex: true,
      },
      { header: "Answers citing", value: (row) => int(row.citation_count), align: "right" },
      { header: "Share", value: (row) => percent(row.citation_percentage), align: "right" },
    ],
    ctx,
  );
}

function summarySearch(search: Obj, ctx: RenderContext): string[] {
  const sources = (["google_search_console", "bing_webmaster_tools"] as const).filter(
    (key) => key in search,
  );
  if (sources.length === 0) {
    return [];
  }
  const lines = heading("Search, last 30 days", ctx);
  const pairs: [string, string][] = sources.map((key) => {
    const source = obj(search[key]);
    const status = str(source.status) ?? "missing";
    if (source.status === UPGRADE || num(source.clicks) === null) {
      return [
        SOURCE_NAMES[key] ?? key,
        status === UPGRADE ? "not on the current plan" : `no data (${status})`,
      ];
    }
    return [
      SOURCE_NAMES[key] ?? key,
      `${int(source.clicks)} clicks · ${int(source.impressions)} impressions · CTR ${ratio(source.ctr)}` +
        (status === "current" ? "" : ` (${status})`),
    ];
  });
  lines.push(...keyValues(pairs, ctx));

  const queries = objs(obj(search.google_search_console).top_queries);
  if (queries.length > 0) {
    lines.push("", ...searchRowsTable(queries, "query", ctx));
  }
  return lines;
}

function searchRowsTable(rows: Obj[], dimension: string, ctx: RenderContext): string[] {
  return table(
    rows,
    [
      { header: label(dimension), value: (row) => cell(dimension, row[dimension]), flex: true },
      { header: "Clicks", value: (row) => int(row.clicks), align: "right" },
      { header: "Impressions", value: (row) => int(row.impressions), align: "right" },
      { header: "CTR", value: (row) => ratio(row.ctr), align: "right" },
      { header: "Position", value: (row) => decimal(row.position), align: "right" },
    ],
    ctx,
  );
}

function summaryTraffic(traffic: Obj, ctx: RenderContext): string[] {
  if (Object.keys(traffic).length === 0) {
    return [];
  }
  const lines = heading("AI traffic (GA4)", ctx);
  if (traffic.status === UPGRADE) {
    return [...lines, ...upgradeLines(traffic, ctx)];
  }
  if (num(traffic.sessions) === null) {
    return [...lines, `no data (${str(traffic.status) ?? "missing"})`];
  }
  const range =
    str(traffic.period_start) && str(traffic.period_end)
      ? `${traffic.period_start} to ${traffic.period_end}`
      : DASH;
  const status = str(traffic.status);
  const sources = objs(traffic.sources).filter((row) => (num(row.sessions) ?? 0) > 0);
  return [
    ...lines,
    ...keyValues(
      [
        ["Period", `${range}${status && status !== "current" ? ` (${status})` : ""}`],
        [
          "Sessions",
          `${int(traffic.sessions)} from AI · ${int(traffic.engaged_sessions)} engaged · ${int(traffic.conversions)} conversions`,
        ],
        ["Share of site", ratio(traffic.share_of_all_site_sessions)],
        [
          "Sources",
          sources.length > 0
            ? sources.map((row) => `${str(row.source) ?? "?"} ${int(row.sessions)}`).join(" · ")
            : DASH,
        ],
      ],
      ctx,
    ),
  ];
}

function summaryConnections(connections: Obj, ctx: RenderContext): string[] {
  const keys = ["google_search_console", "ga4", "bing_webmaster_tools"].filter((key) =>
    isObj(connections[key]),
  );
  if (keys.length === 0) {
    return [];
  }
  return [
    ...heading("Connections", ctx),
    ...keyValues(
      keys.map((key) => {
        const source = obj(connections[key]);
        const state =
          source.needs_reauth === true
            ? "reconnect needed"
            : source.connected === true
              ? `connected${str(source.site_url) ? ` (${source.site_url})` : ""}`
              : "not connected";
        return [SOURCE_NAMES[key] ?? key, state];
      }),
      ctx,
    ),
  ];
}

// answers -------------------------------------------------------------------

export const renderAnswers: Renderer = (raw, ctx) => {
  const data = obj(raw);
  const rows = objs(data.rows);
  const lines = [projectLine(data, ctx, `AI answers, ${periodLabel(data.period)}`)];
  if (rows.length === 0) {
    return [...lines, "No stored answers match."];
  }

  if (data.answer_text_included === true) {
    for (const row of rows) {
      const insight = obj(row.insight);
      lines.push(
        "",
        ctx.style.bold(
          [
            `#${int(row.id)}`,
            day(row.check_date),
            str(row.platform) ?? DASH,
            str(insight.prominence) ?? "not judged yet",
            str(insight.brand_sentiment),
          ]
            .filter(Boolean)
            .join(" · "),
        ),
        `Q: ${str(row.question) ?? DASH}`,
        ...indent((str(row.response_text) ?? "").split("\n")),
      );
      if (row.response_truncated === true) {
        lines.push(
          ctx.style.dim(
            `[cut at ${int(data.max_answer_chars)} of ${int(row.response_chars)} characters]`,
          ),
        );
      }
      const quote = str(insight.evidence_quote);
      if (quote) {
        lines.push(`Evidence: "${quote}"`);
      }
      const urls = arr(row.citation_urls).filter((url) => typeof url === "string");
      if (urls.length > 0) {
        lines.push(ctx.style.dim(`Cited: ${urls.join(", ")}`));
      }
    }
    return [...lines, ...paginationFooter(data, ctx)];
  }

  return [
    ...lines,
    "",
    ...table(
      rows,
      [
        { header: "ID", value: (row) => int(row.id), align: "right" },
        { header: "Date", value: (row) => day(row.check_date) },
        { header: "Platform", value: (row) => str(row.platform) ?? DASH },
        { header: "Question", value: (row) => str(row.question) ?? DASH, flex: true },
        {
          header: "Brand",
          value: (row) =>
            str(obj(row.insight).prominence) ??
            (row.brand_mentioned === null ? "not judged yet" : DASH),
        },
        { header: "Sentiment", value: (row) => str(obj(row.insight).brand_sentiment) ?? DASH },
        { header: "Cites you", value: (row) => yesNo(row.cited_own_site) },
        { header: "Flag", value: (row) => cell("attention", obj(row.insight).attention) },
      ],
      ctx,
    ),
    ...paginationFooter(data, ctx),
  ];
};

// search --------------------------------------------------------------------

export const renderSearch: Renderer = (raw, ctx) => {
  const data = obj(raw);
  const source = SOURCE_NAMES[str(data.source) ?? ""] ?? str(data.source) ?? "Search";
  if (data.available === false) {
    return unavailable(data, ctx, source);
  }
  const header = [
    projectLine(data, ctx, `${source}, ${periodLabel(data.period)}`),
    ...(freshness(data) ? [ctx.style.dim(freshness(data))] : []),
  ];
  const dataset = str(data.dataset) ?? "summary";

  if (dataset === "summary") {
    const lines = [
      ...header,
      "",
      `${int(data.total_clicks)} clicks · ${int(data.total_impressions)} impressions`,
    ];
    for (const [key, dimension] of [
      ["top_queries", "query"],
      ["top_pages", "page"],
      ["top_countries", "country"],
    ] as const) {
      const rows = objs(data[key]).slice(0, 10);
      if (rows.length > 0) {
        lines.push(...heading(label(key), ctx), ...searchRowsTable(rows, dimension, ctx));
      }
    }
    return lines;
  }

  return [...header, ...datasetBody(data, dataset, ctx), ...paginationFooter(data, ctx)];
};

/**
 * Datasets either return `rows` or an object named after the dataset holding
 * several lists (opportunities, trends); each list becomes its own table.
 */
function datasetBody(data: Obj, dataset: string, ctx: RenderContext): string[] {
  const definition = str(data.definition);
  const lines = definition ? ["", ctx.style.dim(definition)] : [];

  if (Array.isArray(data.rows)) {
    const rows = objs(data.rows);
    return [...lines, "", ...(rows.length > 0 ? genericTable(rows, ctx) : ["No rows."])];
  }

  const nested = obj(data[dataset]);
  for (const [key, value] of Object.entries(nested)) {
    if (Array.isArray(value)) {
      const rows = objs(value);
      lines.push(
        ...heading(label(key), ctx),
        ...(rows.length > 0 ? genericTable(rows, ctx) : ["None."]),
      );
    } else if (isObj(value)) {
      lines.push(
        ...heading(label(key), ctx),
        ...keyValues(
          Object.entries(value).map(([inner, innerValue]) => [
            label(inner),
            cell(inner, innerValue),
          ]),
          ctx,
        ),
      );
    }
  }
  return lines;
}

// competitors ---------------------------------------------------------------

export const renderCompetitors: Renderer = (raw, ctx) => {
  const data = obj(raw);
  const dataset = str(data.dataset) ?? "ranking";

  if (dataset === "detail") {
    if (data.found !== true) {
      return [
        projectLine(data, ctx, "competitor"),
        str(data.message) ?? "No competitor matches that name.",
      ];
    }
    const row = obj(data.competitor);
    const lines = [
      projectLine(
        data,
        ctx,
        `${str(row.competitor_name) ?? "Competitor"}, ${periodLabel(data.period)}`,
      ),
      "",
      ...keyValues(
        [
          ["Website", str(row.competitor_website) ?? DASH],
          ["Rank", int(row.rank)],
          ["Visibility", percent(row.visibility_percentage)],
          ["Mentions", int(row.mention_count)],
          ["Citations", int(row.citation_count)],
          ["Average position", decimal(row.average_position)],
          ["By platform", cell("platform_mentions", row.platform_mentions)],
          ["Also written as", arr(row.name_variants).join(", ")],
        ],
        ctx,
      ),
    ];
    const highlights = Object.entries(obj(row.platform_highlights));
    if (highlights.length > 0) {
      lines.push(...heading("What the answers say", ctx));
      for (const [platform, items] of highlights) {
        lines.push(
          `${platform}: ${arr(items)
            .filter((item) => typeof item === "string")
            .join("; ")}`,
        );
      }
    }
    return lines;
  }

  if (dataset === "history") {
    const rows = objs(data.rows);
    const lines = [projectLine(data, ctx, "competitors by month"), ""];
    if (rows.length === 0) {
      return [...lines, "No monthly snapshots yet."];
    }
    return [
      ...lines,
      ...table(
        rows,
        [
          { header: "Month", value: (row) => (str(row.period_start) ?? DASH).slice(0, 7) },
          {
            header: "You",
            value: (row) => {
              const own = obj(row.own_brand);
              return num(own.visibility_percentage) === null
                ? DASH
                : percent(own.visibility_percentage);
            },
            align: "right",
          },
          {
            header: "Top competitors (visibility)",
            value: (row) =>
              objs(row.top_competitors)
                .map(
                  (item) =>
                    `${str(item.competitor_name) ?? "?"} ${percent(item.visibility_percentage)}`,
                )
                .join(" · ") || DASH,
            flex: true,
          },
        ],
        ctx,
      ),
    ];
  }

  const rows = objs(data.rows);
  const lines = [projectLine(data, ctx, `competitors, ${periodLabel(data.period)}`), ""];
  if (rows.length === 0) {
    return [...lines, "No competitors in this period."];
  }
  return [...lines, ...competitorTable(rows, {}, ctx), ...paginationFooter(data, ctx)];
};

// citations -----------------------------------------------------------------

export const renderCitations: Renderer = (raw, ctx) => {
  const data = obj(raw);
  const rows = objs(data.rows);
  const byDomain = data.group_by === "domain";
  const lines = [
    projectLine(data, ctx, `cited ${byDomain ? "domains" : "URLs"}, ${periodLabel(data.period)}`),
  ];
  if (str(data.definition)) {
    lines.push(ctx.style.dim(str(data.definition) ?? ""));
  }
  lines.push("");
  if (rows.length === 0) {
    return [...lines, "No citations match."];
  }
  if (byDomain) {
    return [...lines, ...domainTable(rows, ctx), ...paginationFooter(data, ctx)];
  }
  return [
    ...lines,
    ...table(
      rows,
      [
        {
          header: "URL",
          value: (row) => `${str(row.url) ?? DASH}${row.is_own_site === true ? " (you)" : ""}`,
          flex: true,
        },
        { header: "Mentions", value: (row) => int(row.mention_count), align: "right" },
        { header: "Platforms", value: (row) => cell("platforms", row.platforms) },
        { header: "Questions", value: (row) => cell("prompt_ids", row.prompt_ids) },
      ],
      ctx,
    ),
    ...paginationFooter(data, ctx),
  ];
};

// traffic -------------------------------------------------------------------

export const renderTraffic: Renderer = (raw, ctx) => {
  const data = obj(raw);
  if (data.available === false) {
    return unavailable(data, ctx, "AI traffic");
  }
  const header = [
    projectLine(data, ctx, `AI traffic (GA4), ${periodLabel(data.period)}`),
    ...(freshness(data) ? [ctx.style.dim(freshness(data))] : []),
  ];
  const dataset = str(data.dataset) ?? "summary";

  if (dataset === "summary") {
    const ai = obj(data.ai_traffic);
    const site = obj(data.all_site);
    const lines = [
      ...header,
      "",
      ...keyValues(
        [
          ["AI sessions", int(ai.sessions)],
          ["Engaged", int(ai.engaged_sessions)],
          ["Conversions", int(ai.conversions)],
          ["Share of site", ratio(ai.share_of_all_site_sessions)],
          ["Site sessions", int(site.sessions)],
        ],
        ctx,
      ),
    ];
    const sources = objs(data.sources);
    if (sources.length > 0) {
      lines.push(...heading("Sources", ctx), ...genericTable(sources, ctx));
    }
    const note = str(data.interpretation);
    if (note) {
      lines.push("", ctx.style.dim(note));
    }
    return lines;
  }

  return [...header, ...datasetBody(data, dataset, ctx), ...paginationFooter(data, ctx)];
};

// plan ----------------------------------------------------------------------

/** Turns an API URL into the equivalent `searcherries api` call, so a human can follow it. */
export function cliCallFor(url: string, baseUrl: string): string {
  const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) || "/" : url;
  return `searcherries api '${path}'`;
}

export function planRenderer(baseUrl: string): Renderer {
  return (raw, ctx) => {
    const data = obj(raw);
    const snapshot = obj(data.snapshot);
    const profile = obj(snapshot.profile);
    const brand = str(profile.brand_name) ?? "Project";
    const lines = [
      ctx.style.bold(`${brand} · action plan for ${str(data.audience) ?? "business"}`),
      `AI period: ${periodLabel(snapshot.period)}`,
    ];

    const account = obj(data.account);
    if (str(account.message)) {
      const { text, linked } = withLinks(str(account.message) ?? "", account);
      lines.push("", text);
      if (!linked && str(account.connect_url)) {
        lines.push(ctx.style.dim(`Connect: ${account.connect_url}`));
      }
    }

    const actions = objs(data.actions);
    if (actions.length === 0) {
      lines.push(
        "",
        data.status === "no_priority_signals"
          ? "No priority signals in the stored data right now."
          : "Not enough data for a plan yet. See the notes below.",
      );
    }
    actions.forEach((action, index) => {
      const owner = str(action.suggested_owner);
      lines.push(
        "",
        ctx.style.bold(
          `${index + 1}. ${str(action.title) ?? "Action"}${owner ? ` (${owner})` : ""}`,
        ),
        ...indent(
          [
            str(action.next_step) ?? "",
            ...keyValues(
              [
                ["Evidence", evidenceLine(obj(action.evidence))],
                ["Measure", str(action.success_measure) ?? ""],
                ["Report", str(action.report_url) ?? ""],
                [
                  "Details",
                  str(obj(action.next_request).url)
                    ? cliCallFor(str(obj(action.next_request).url) ?? "", baseUrl)
                    : "",
                ],
              ],
              ctx,
            ),
          ].filter((line) => line !== ""),
        ),
      );
    });

    const notes = objs(data.data_notes);
    if (notes.length > 0) {
      lines.push(...heading("Data notes", ctx));
      for (const note of notes) {
        const link = str(note.connect_url) ?? str(note.plans_url) ?? str(note.report_url);
        const { text, linked } = withLinks(str(note.message) ?? str(note.status) ?? "", note);
        const source = SOURCE_NAMES[str(note.source) ?? ""] ?? label(str(note.source) ?? "note");
        lines.push(
          `- ${source}: ${text}`,
          ...(link && !linked ? [ctx.style.dim(`  ${link}`)] : []),
        );
      }
    }
    return lines;
  };
}

function evidenceLine(evidence: Obj): string {
  const parts: string[] = [];
  const period = obj(evidence.period);
  if (str(period.start) && str(period.end)) {
    parts.push(`${period.start} to ${period.end}`);
  }
  for (const [key, value] of Object.entries(evidence)) {
    if (
      key === "source" ||
      key === "period" ||
      isObj(value) ||
      (Array.isArray(value) && value.some(isObj))
    ) {
      continue;
    }
    parts.push(`${words(key.replace(/_percent$/, ""))} ${cell(key, value)}`);
  }
  return parts.join(", ");
}
