import {
  planRenderer,
  type Renderer,
  renderAnswers,
  renderCitations,
  renderCompetitors,
  renderProjects,
  renderSearch,
  renderSummary,
  renderTraffic,
} from "./render/renderers.js";

export type OptionType = "string" | "integer" | "number" | "date" | "boolean";

export interface OptionSpec {
  /** The flag without dashes. Its query parameter is the same name in snake_case unless `param` says otherwise. */
  name: string;
  type: OptionType;
  description: string;
  param?: string;
  /** What a boolean flag sends; "1" unless the flag switches a default off. */
  sends?: "1" | "0";
  /** Documented values, shown in help. The API validates them, so they are never checked here. */
  values?: readonly string[];
}

export interface DataCommand {
  name: string;
  summary: string;
  /** The API path; `{project}` is replaced by the resolved project id. */
  path: string;
  options: OptionSpec[];
  paginated: boolean;
  notes?: string[];
  examples: string[];
  renderer: (baseUrl: string) => Renderer;
  /** Adjusts the query after parsing, for shortcuts such as --competitor implying the detail dataset. */
  adjust?: (query: Record<string, string>) => void;
}

export const AI_PERIODS = [
  "last_30_days",
  "last_60_days",
  "last_90_days",
  "this_year",
  "last_year",
] as const;
export const WINDOWS = ["30d", "90d", "365d"] as const;
export const PLATFORMS = [
  "chatgpt",
  "perplexity",
  "ai_overviews",
  "gemini",
  "claude",
  "grok",
] as const;

const aiPeriod: OptionSpec = {
  name: "period",
  type: "string",
  description: "AI visibility period, anchored to the latest check",
  values: AI_PERIODS,
};
const window: OptionSpec = {
  name: "period",
  type: "string",
  description: "Rolling window ending on the collection day",
  values: WINDOWS,
};
const limit = (max: number, fallback: number): OptionSpec => ({
  name: "limit",
  type: "integer",
  description: `Rows per page, 1 to ${max} (default ${fallback})`,
});
const offset: OptionSpec = { name: "offset", type: "integer", description: "Rows to skip" };
const platform: OptionSpec = {
  name: "platform",
  type: "string",
  description: "One AI platform",
  values: PLATFORMS,
};
const promptId: OptionSpec = {
  name: "prompt-id",
  type: "integer",
  description: "One customer question (its id in `searcherries summary`)",
};

const fixed = (renderer: Renderer) => () => renderer;

export const DATA_COMMANDS: DataCommand[] = [
  {
    name: "projects",
    summary: "List your projects",
    path: "/projects",
    options: [],
    paginated: false,
    examples: ["searcherries projects", "searcherries projects --json"],
    renderer: fixed(renderProjects),
  },
  {
    name: "summary",
    summary: "One compact snapshot of a project",
    path: "/projects/{project}",
    options: [
      aiPeriod,
      {
        name: "include",
        type: "string",
        description: "Blocks to include, comma-separated",
        values: [
          "profile",
          "questions",
          "ai_visibility",
          "answer_insights",
          "competitors",
          "citations",
          "search",
          "ai_traffic",
          "connections",
          "recommendations",
        ],
      },
    ],
    paginated: false,
    examples: ["searcherries summary acme", "searcherries summary 123 --period last_90_days"],
    renderer: fixed(renderSummary),
  },
  {
    name: "answers",
    summary: "Stored AI answers with their judgments",
    path: "/projects/{project}/answers",
    options: [
      { ...aiPeriod, description: "Report period; ignored when --since or --until is given" },
      { name: "since", type: "date", description: "First check date, YYYY-MM-DD" },
      { name: "until", type: "date", description: "Last check date, YYYY-MM-DD" },
      promptId,
      platform,
      {
        name: "prominence-max",
        type: "integer",
        description: "Answers with prominence at most this level; 1 lists the gaps",
        values: ["0", "1", "2", "3"],
      },
      {
        name: "only-flagged",
        type: "boolean",
        description: "Only off-topic answers and negative or drawback answers backed by a quote",
      },
      {
        name: "include-answer-text",
        type: "boolean",
        description: "Include the answer text (20 rows per page)",
      },
      {
        name: "max-answer-chars",
        type: "integer",
        description:
          "Characters per answer with --include-answer-text, 200 to 20000 (default 1200)",
      },
      limit(100, 25),
      offset,
    ],
    paginated: true,
    notes: [
      "Needs a Starter or Pro plan.",
      "Prominence levels: 0 not named, 1 named in passing, 2 one of the options, 3 top recommendation.",
    ],
    examples: [
      "searcherries answers acme --prominence-max 1",
      "searcherries answers acme --only-flagged --include-answer-text",
      "searcherries answers acme --platform chatgpt --since 2026-10-01 --all --json",
    ],
    renderer: fixed(renderAnswers),
  },
  {
    name: "search",
    summary: "Google Search Console or Bing Webmaster Tools data",
    path: "/projects/{project}/search-performance",
    options: [
      {
        name: "source",
        type: "string",
        description: "Search engine (default google)",
        values: ["google", "bing"],
      },
      window,
      {
        name: "dataset",
        type: "string",
        description: "What to return (default summary)",
        values: [
          "summary",
          "top_queries",
          "top_pages",
          "top_countries",
          "queries_by_country",
          "opportunities",
          "trends",
          "ai_question_queries",
          "daily",
          "history",
        ],
      },
      { name: "query-contains", type: "string", description: "Text filter on queries" },
      { name: "page-contains", type: "string", description: "Text filter on pages" },
      { name: "country", type: "string", description: "Country code filter, for example usa" },
      { name: "min-impressions", type: "integer", description: "Minimum impressions" },
      { name: "min-clicks", type: "integer", description: "Minimum clicks" },
      { name: "min-position", type: "number", description: "Minimum average position" },
      { name: "max-position", type: "number", description: "Maximum average position" },
      {
        name: "sort",
        type: "string",
        description: "Sort order of list datasets (default clicks)",
        values: ["clicks", "impressions", "ctr", "position"],
      },
      limit(100, 25),
      offset,
    ],
    paginated: true,
    notes: [
      "Lists are the stored top sample, not an exhaustive export. ai_question_queries is Google only.",
    ],
    examples: [
      "searcherries search acme",
      "searcherries search acme --dataset top_queries --min-impressions 100 --sort impressions",
      "searcherries search acme --source bing --period 90d --dataset opportunities",
    ],
    renderer: fixed(renderSearch),
  },
  {
    name: "competitors",
    summary: "Brands the AI platforms name: ranking, one brand in detail, or by month",
    path: "/projects/{project}/competitors",
    options: [
      aiPeriod,
      {
        name: "dataset",
        type: "string",
        description: "What to return (default ranking; detail when --competitor is given)",
        values: ["ranking", "detail", "history"],
      },
      {
        name: "competitor",
        type: "string",
        description: "Brand name or a fragment of it, for detail",
      },
      {
        name: "no-highlights",
        param: "include_highlights",
        sends: "0",
        type: "boolean",
        description: "Leave the highlight sentences out of the ranking",
      },
      {
        name: "highlights-per-platform",
        type: "integer",
        description: "Highlight sentences per platform, 0 to 5 (default 3)",
      },
      limit(50, 15),
      offset,
    ],
    paginated: true,
    notes: ["Needs a Starter or Pro plan. For history, --limit counts months (default 12)."],
    examples: [
      "searcherries competitors acme",
      "searcherries competitors acme --competitor rival",
      "searcherries competitors acme --dataset history",
    ],
    renderer: fixed(renderCompetitors),
    adjust: (query) => {
      if (query.competitor && !query.dataset) {
        query.dataset = "detail";
      }
    },
  },
  {
    name: "citations",
    summary: "URLs or domains the AI answers cite",
    path: "/projects/{project}/citations",
    options: [
      aiPeriod,
      {
        name: "group-by",
        type: "string",
        description: "Grouping (default url)",
        values: ["url", "domain"],
      },
      platform,
      promptId,
      { name: "url-contains", type: "string", description: "Text filter on URLs" },
      { name: "own-site-only", type: "boolean", description: "Only URLs on the project website" },
      limit(100, 25),
      offset,
    ],
    paginated: true,
    notes: ["Needs a Starter or Pro plan. The filters apply to the URL grouping."],
    examples: [
      "searcherries citations acme",
      "searcherries citations acme --group-by domain",
      "searcherries citations acme --own-site-only",
    ],
    renderer: fixed(renderCitations),
  },
  {
    name: "traffic",
    summary: "GA4 traffic from AI assistants and AI Overviews",
    path: "/projects/{project}/ai-traffic",
    options: [
      window,
      {
        name: "dataset",
        type: "string",
        description: "What to return (default summary)",
        values: ["summary", "sources", "landing_pages", "daily", "history"],
      },
      {
        name: "source",
        type: "string",
        description: "One AI source",
        values: [
          "chatgpt",
          "gemini",
          "perplexity",
          "claude",
          "copilot",
          "meta_ai",
          "other_ai_assistants",
          "ai_overviews",
        ],
      },
      { name: "path-contains", type: "string", description: "Text filter on landing page paths" },
      limit(100, 25),
      offset,
    ],
    paginated: true,
    examples: [
      "searcherries traffic acme",
      "searcherries traffic acme --dataset landing_pages --period 90d",
    ],
    renderer: fixed(renderTraffic),
  },
  {
    name: "plan",
    summary: "Prioritized next steps with dated evidence",
    path: "/projects/{project}/action-plan",
    options: [
      {
        name: "audience",
        type: "string",
        description: "Who the plan is for (default business)",
        values: ["business", "marketing", "seo"],
      },
      aiPeriod,
      {
        name: "limit",
        type: "integer",
        description: "Maximum number of actions, 1 to 10 (default 5)",
      },
    ],
    paginated: false,
    examples: ["searcherries plan acme", "searcherries plan acme --audience seo --json"],
    renderer: planRenderer,
  },
];

export const PAGE_MAX: Record<string, number> = { competitors: 50 };
