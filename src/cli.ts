import { type ParseArgsConfig, parseArgs } from "node:util";
import { ApiClient, type Query } from "./api.js";
import { DATA_COMMANDS, type DataCommand, type OptionSpec, PAGE_MAX } from "./commands.js";
import {
  type Credentials,
  configPath,
  DEFAULT_API_URL,
  deleteConfig,
  normalizeApiUrl,
  readConfig,
  resolveCredentials,
  tokenPage,
  writeConfig,
} from "./config.js";
import { ApiError, CliError, EXIT, UsageError } from "./errors.js";
import { arr, isObj, num, obj } from "./json.js";
import { projectRows, resolveProjectId } from "./project.js";
import { type InputStream, readAll, readHidden } from "./prompt.js";
import { createStyle, type RenderContext } from "./render/format.js";
import { NAME, VERSION } from "./version.js";

export const DOCS_URL = "https://searcherries.com/docs/api/cli";

/** A cap on --all so a mistaken filter cannot walk the API for minutes. */
const MAX_PAGES = 100;

export interface Output {
  write(text: string): unknown;
  isTTY?: boolean;
  columns?: number;
}

export interface Io {
  argv: string[];
  env: NodeJS.ProcessEnv;
  stdout: Output;
  stderr: Output;
  stdin: InputStream;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Every command accepts these. */
const COMMON_OPTIONS = {
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const satisfies ParseArgsConfig["options"];

/** `searcherries` without a command. */
const TOP_OPTIONS = {
  ...COMMON_OPTIONS,
  version: { type: "boolean", short: "v" },
} as const satisfies ParseArgsConfig["options"];

export async function run(io: Io): Promise<number> {
  const wantsJson = io.argv.includes("--json");
  try {
    return await dispatch(io);
  } catch (error) {
    reportError(io, error, wantsJson);
    return error instanceof CliError ? error.exitCode : EXIT.error;
  }
}

async function dispatch(io: Io): Promise<number> {
  const commandIndex = io.argv.findIndex((arg) => !arg.startsWith("-"));
  const command = commandIndex === -1 ? undefined : io.argv[commandIndex];
  const rest = commandIndex === -1 ? io.argv : io.argv.filter((_, index) => index !== commandIndex);

  if (command === undefined) {
    const { values } = parse(rest, TOP_OPTIONS, 0);
    print(io, values.version ? VERSION : mainHelp());
    return EXIT.ok;
  }
  if (command === "help") {
    const { positionals } = parse(rest, COMMON_OPTIONS, 1);
    const [topic] = positionals;
    print(io, topic ? commandHelp(topic) : mainHelp());
    return EXIT.ok;
  }

  switch (command) {
    case "login":
      return login(io, rest);
    case "logout":
      return logout(io, rest);
    case "status":
      return status(io, rest);
    case "api":
      return rawApi(io, rest);
  }

  const spec = DATA_COMMANDS.find((candidate) => candidate.name === command);
  if (!spec) {
    throw new UsageError(`Unknown command "${command}".`, [`Run: ${NAME} --help`]);
  }
  return runDataCommand(io, spec, rest);
}

// data commands ---------------------------------------------------------------

async function runDataCommand(io: Io, spec: DataCommand, args: string[]): Promise<number> {
  const options: ParseArgsConfig["options"] = { ...COMMON_OPTIONS };
  for (const option of spec.options) {
    options[option.name] = { type: option.type === "boolean" ? "boolean" : "string" };
  }
  if (spec.paginated) {
    options.all = { type: "boolean" };
  }

  const takesProject = spec.path.includes("{project}");
  const { values, positionals } = parse(args, options, takesProject ? 1 : 0, spec.name);
  if (values.help) {
    print(io, commandHelp(spec.name));
    return EXIT.ok;
  }

  const query = buildQuery(spec.options, values);
  spec.adjust?.(query);

  const { client } = clientFor(io);
  let path = spec.path;
  if (takesProject) {
    const id = await resolveProjectId(client, positionals[0] ?? io.env.SEARCHERRIES_PROJECT);
    path = path.replace("{project}", String(id));
  }

  const data =
    values.all === true
      ? await fetchAllPages(io, client, path, query, pageSize(spec, query))
      : (await client.get(path, query)).data;

  if (values.json) {
    printJson(io, data);
  } else {
    print(io, spec.renderer(client.baseUrl)(data, renderContext(io)).join("\n"));
  }
  return EXIT.ok;
}

export function buildQuery(specs: OptionSpec[], values: Record<string, unknown>): Query {
  const query: Query = {};
  for (const spec of specs) {
    const value = values[spec.name];
    if (value === undefined || value === false) {
      continue;
    }
    const param = spec.param ?? spec.name.replaceAll("-", "_");
    query[param] = spec.type === "boolean" ? (spec.sends ?? "1") : checkValue(spec, String(value));
  }
  return query;
}

function checkValue(spec: OptionSpec, value: string): string {
  const trimmed = value.trim();
  const fail = (what: string) => {
    throw new UsageError(`--${spec.name} needs ${what}, got "${value}".`);
  };
  if (trimmed === "") {
    fail("a value");
  }
  if (spec.type === "integer" && !/^-?\d+$/.test(trimmed)) {
    fail("a whole number");
  }
  if (spec.type === "number" && !Number.isFinite(Number(trimmed))) {
    fail("a number");
  }
  if (spec.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    fail("a date as YYYY-MM-DD");
  }
  return trimmed;
}

function pageSize(spec: DataCommand, query: Query): number {
  if (query.limit) {
    return Number(query.limit);
  }
  if (query.include_answer_text === "1") {
    return 20;
  }
  return PAGE_MAX[spec.name] ?? 100;
}

/**
 * Follows `pagination.has_more` and returns one document: the first page with
 * every row and a pagination block describing the whole set. Responses
 * without rows or pagination are returned as they are.
 */
export async function fetchAllPages(
  io: Pick<Io, "stderr">,
  client: ApiClient,
  path: string,
  query: Query,
  size: number,
): Promise<unknown> {
  const start = Number(query.offset ?? 0);
  const request = (offset: number) =>
    client.get(path, { ...query, limit: String(size), offset: String(offset) });

  const first = obj((await request(start)).data);
  if (!Array.isArray(first.rows) || !isObj(first.pagination)) {
    return first;
  }

  const rows = [...first.rows];
  let page = first.pagination;
  let offset = start;
  let pages = 1;
  while (page.has_more === true && pages < MAX_PAGES) {
    const returned = num(page.returned) ?? 0;
    if (returned === 0) {
      break;
    }
    offset += returned;
    const next = obj((await request(offset)).data);
    rows.push(...arr(next.rows));
    page = obj(next.pagination);
    pages++;
  }
  if (page.has_more === true) {
    io.stderr.write(`Stopped after ${MAX_PAGES} pages; narrow the filters or use --offset.\n`);
  }

  return {
    ...first,
    rows,
    pagination: {
      offset: start,
      limit: size,
      returned: rows.length,
      total: num(page.total) ?? num(first.pagination.total),
      has_more: page.has_more === true,
    },
  };
}

// api ---------------------------------------------------------------------------

async function rawApi(io: Io, args: string[]): Promise<number> {
  const { values, positionals } = parse(args, COMMON_OPTIONS, 1);
  const [path] = positionals;
  if (values.help || !path) {
    print(io, commandHelp("api"));
    return values.help ? EXIT.ok : EXIT.usage;
  }
  const { client } = clientFor(io);
  printJson(io, (await client.get(path)).data);
  return EXIT.ok;
}

// login, logout, status -------------------------------------------------------

async function login(io: Io, args: string[]): Promise<number> {
  const { values } = parse(args, COMMON_OPTIONS, 0);
  if (values.help) {
    print(io, commandHelp("login"));
    return EXIT.ok;
  }

  const apiUrl = normalizeApiUrl(io.env.SEARCHERRIES_API_URL?.trim() || DEFAULT_API_URL);
  const page = tokenPage(apiUrl);
  let token: string;
  if (io.stdin.isTTY) {
    io.stderr.write(
      `Create a token on the Other clients tab of ${page}\n(tokens work for the CLI, the REST API and MCP).\n`,
    );
    token = await readHidden(io.stdin, io.stderr, "Paste the token: ");
  } else {
    token = await readAll(io.stdin);
  }
  token = token.trim();
  if (token === "") {
    throw new UsageError("No token was given.", [`Create one at ${page}`]);
  }
  if (/\s/.test(token)) {
    throw new UsageError("The token contains spaces or line breaks; paste it as one line.");
  }

  const client = new ApiClient({ ...clientOptions(io), baseUrl: apiUrl, token, tokenPage: page });
  let projects: number;
  try {
    projects = projectRows((await client.get("/projects")).data).length;
  } catch (error) {
    if (error instanceof ApiError && error.exitCode === EXIT.auth) {
      throw new CliError("Searcherries did not accept this token.", EXIT.auth, error.hints);
    }
    throw error;
  }

  const path = configPath(io.env);
  writeConfig(path, apiUrl === DEFAULT_API_URL ? { token } : { token, api_url: apiUrl });
  print(
    io,
    `Signed in. ${projects} ${projects === 1 ? "project" : "projects"}. Token saved to ${path}`,
  );
  if (io.env.SEARCHERRIES_TOKEN?.trim()) {
    io.stderr.write("Note: SEARCHERRIES_TOKEN is set and is used instead of the saved token.\n");
  }
  return EXIT.ok;
}

function logout(io: Io, args: string[]): number {
  const { values } = parse(args, COMMON_OPTIONS, 0);
  if (values.help) {
    print(io, commandHelp("logout"));
    return EXIT.ok;
  }
  const path = configPath(io.env);
  let savedUrl = DEFAULT_API_URL;
  try {
    savedUrl = normalizeApiUrl(readConfig(path).api_url || DEFAULT_API_URL);
  } catch {
    // A corrupt or odd settings file is still removed below.
  }
  if (deleteConfig(path)) {
    print(
      io,
      `Signed out. The token was removed from ${path}; it keeps working until you revoke it at ${tokenPage(savedUrl)}`,
    );
  } else {
    print(io, "No saved token.");
  }
  if (io.env.SEARCHERRIES_TOKEN?.trim()) {
    io.stderr.write("Note: SEARCHERRIES_TOKEN is still set in this environment.\n");
  }
  return EXIT.ok;
}

async function status(io: Io, args: string[]): Promise<number> {
  const { values } = parse(args, COMMON_OPTIONS, 0);
  if (values.help) {
    print(io, commandHelp("status"));
    return EXIT.ok;
  }
  const { client, credentials } = clientFor(io);
  const response = await client.get("/projects");
  const projects = projectRows(response.data);
  const { limit, remaining } = response.rateLimit;

  if (values.json) {
    printJson(io, {
      api_url: credentials.apiUrl,
      token_source: credentials.tokenSource,
      config_path: credentials.configPath,
      projects: projects.length,
      rate_limit: { limit, remaining },
    });
    return EXIT.ok;
  }
  const source =
    credentials.tokenSource === "env" ? "SEARCHERRIES_TOKEN" : `saved in ${credentials.configPath}`;
  print(
    io,
    [
      `Signed in. ${projects.length} ${projects.length === 1 ? "project" : "projects"}.`,
      `Token: ${source}`,
      `API: ${credentials.apiUrl}`,
      ...(limit !== null
        ? [`Rate limit: ${remaining ?? "?"} of ${limit} requests left this minute`]
        : []),
    ].join("\n"),
  );
  return EXIT.ok;
}

// plumbing --------------------------------------------------------------------

function clientOptions(io: Io) {
  return {
    fetch: io.fetch,
    sleep: io.sleep,
    onRetry: (seconds: number) => io.stderr.write(`Rate limit reached; waiting ${seconds} s.\n`),
  };
}

function clientFor(io: Io): { client: ApiClient; credentials: Credentials } {
  const credentials = resolveCredentials(io.env);
  const page = tokenPage(credentials.apiUrl);
  if (!credentials.token) {
    throw new CliError("Not signed in.", EXIT.auth, [
      `Create a token at ${page}, then run: ${NAME} login`,
      "Or set SEARCHERRIES_TOKEN.",
    ]);
  }
  const client = new ApiClient({
    ...clientOptions(io),
    baseUrl: credentials.apiUrl,
    token: credentials.token,
    tokenPage: page,
  });
  return { client, credentials };
}

function parse(
  args: string[],
  options: ParseArgsConfig["options"],
  maxPositionals: number,
  command?: string,
) {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(parseErrorMessage(error), [
      `Run: ${NAME}${command ? ` ${command}` : ""} --help`,
    ]);
  }
  if (parsed.positionals.length > maxPositionals) {
    const extra = parsed.positionals.slice(maxPositionals).join(" ");
    throw new UsageError(`Unexpected argument: ${extra}`, [
      "Quote a project name that contains spaces.",
    ]);
  }
  return { values: parsed.values as Record<string, unknown>, positionals: parsed.positionals };
}

/** Node's parseArgs messages explain "--" escaping at length; the option name is what matters. */
function parseErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string }).code;
  const option = message.match(/'(-[^']+)'/)?.[1];
  if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" && option) {
    return `Unknown option ${option}.`;
  }
  if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" && option) {
    return `Option ${option.split(" ")[0]} needs a value.`;
  }
  return message;
}

function renderContext(io: Io): RenderContext {
  const terminal = io.stdout.isTTY === true;
  const color = terminal && !io.env.NO_COLOR && io.env.TERM !== "dumb";
  return {
    style: createStyle(color),
    width: terminal ? Math.max(40, io.stdout.columns ?? 100) : Number.POSITIVE_INFINITY,
  };
}

function print(io: Io, text: string): void {
  io.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

function printJson(io: Io, data: unknown): void {
  io.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

/** Errors go to stderr; with --json as the same envelope the API uses. */
function reportError(io: Io, error: unknown, json: boolean): void {
  if (!(error instanceof CliError)) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    io.stderr.write(`Unexpected error: ${message}\n`);
    return;
  }
  if (json) {
    const body =
      error instanceof ApiError
        ? error.body
        : {
            code: error instanceof UsageError ? "usage_error" : "cli_error",
            message: error.message,
            hints: error.hints,
          };
    io.stderr.write(`${JSON.stringify({ error: body })}\n`);
    return;
  }
  io.stderr.write(`Error: ${error.message}\n`);
  for (const hint of error.hints) {
    io.stderr.write(`  ${hint}\n`);
  }
}

// help ------------------------------------------------------------------------

const ACCOUNT_COMMANDS: [string, string][] = [
  ["login", "Save an access token (paste it, or pipe it in)"],
  ["logout", "Remove the saved token"],
  ["status", "Check the token, the API and the rate limit"],
];

export function mainHelp(): string {
  const rows: [string, string][] = [
    ...ACCOUNT_COMMANDS,
    ...DATA_COMMANDS.map((spec): [string, string] => [spec.name, spec.summary]),
    ["api", "GET any API path and print the JSON"],
  ];
  const width = Math.max(...rows.map(([name]) => name.length)) + 2;
  return `${NAME} v${VERSION}: your Searcherries data in the terminal, read-only

Usage:
  ${NAME} <command> [project] [options]

Commands:
${rows.map(([name, summary]) => `  ${name.padEnd(width)}${summary}`).join("\n")}

The project is an id, a brand name or a domain. Leave it out when the account
has one project, or set SEARCHERRIES_PROJECT.

Options:
  --json         Print the API response as JSON (errors go to stderr)
  -h, --help     Help for a command, for example: ${NAME} answers --help
  -v, --version  Print the version

Environment:
  SEARCHERRIES_TOKEN    Access token; takes precedence over the saved one
  SEARCHERRIES_PROJECT  Default project
  SEARCHERRIES_API_URL  API base URL (default ${DEFAULT_API_URL})
  NO_COLOR              Plain output

Exit codes: 0 ok, 1 error, 2 usage, 3 not signed in or token rejected,
4 needs a Starter or Pro plan.

Docs: ${DOCS_URL}`;
}

export function commandHelp(name: string): string {
  const account = ACCOUNT_COMMANDS.find(([candidate]) => candidate === name);
  if (name === "login") {
    return `${NAME} login

Saves an access token. Create one on the Other clients tab of
${tokenPage(DEFAULT_API_URL)}, then paste it when asked, or pipe it in:

  echo "$TOKEN" | ${NAME} login

The token is checked against the API before it is saved, in a file only your
user can read. In CI, set SEARCHERRIES_TOKEN instead of logging in.`;
  }
  if (account) {
    return `${NAME} ${account[0]}\n\n${account[1]}.`;
  }
  if (name === "api") {
    return `${NAME} api <path>

Sends a GET request to any REST API v1 path and prints the JSON. The path is
relative to ${DEFAULT_API_URL}; a full URL under it works too,
such as the next_request links of an action plan.

Examples:
  ${NAME} api /projects
  ${NAME} api '/projects/123/answers?prominence_max=1&limit=5'

Endpoint reference: https://searcherries.com/docs/api/endpoints`;
  }

  const spec = DATA_COMMANDS.find((candidate) => candidate.name === name);
  if (!spec) {
    throw new UsageError(`Unknown command "${name}".`, [`Run: ${NAME} --help`]);
  }
  const takesProject = spec.path.includes("{project}");
  const options: [string, string, string?][] = spec.options.map((option) => [
    `--${option.name}${option.type === "boolean" ? "" : ` <${option.type === "string" ? "value" : option.type}>`}`,
    option.description,
    option.values?.join(", "),
  ]);
  if (spec.paginated) {
    options.push(["--all", "Fetch every page and print them as one"]);
  }
  options.push(["--json", "Print the API response as JSON"]);
  const width = Math.max(...options.map(([flag]) => flag.length)) + 2;
  const optionLines = options.flatMap(([flag, description, values]) => [
    `  ${flag.padEnd(width)}${description}`,
    ...(values ? [`  ${"".padEnd(width)}${values}`] : []),
  ]);

  return [
    `${NAME} ${spec.name}${takesProject ? " [project]" : ""} [options]`,
    "",
    `${spec.summary}.`,
    "",
    "Options:",
    ...optionLines,
    ...(spec.notes ? ["", ...spec.notes] : []),
    "",
    "Examples:",
    ...spec.examples.map((example) => `  ${example}`),
  ].join("\n");
}
