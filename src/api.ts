import { ApiError, type ApiErrorBody, CliError, UsageError } from "./errors.js";
import { NAME, VERSION } from "./version.js";

export type Query = Record<string, string>;

export interface RateLimit {
  limit: number | null;
  remaining: number | null;
}

export interface ApiResponse {
  data: unknown;
  rateLimit: RateLimit;
}

export interface ApiClientOptions {
  baseUrl: string;
  token: string;
  /** Where the hints in auth errors send the user to create a token. */
  tokenPage: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Called before waiting out a 429, with the number of seconds. */
  onRetry?: (seconds: number) => void;
  timeoutMs?: number;
  maxRetries?: number;
}

/** A 429 asking for longer than this is reported instead of waited out. */
const MAX_RETRY_WAIT_SECONDS = 60;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Read-only client for the Searcherries REST API v1. Every request is a GET. */
export class ApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  async get(path: string, query: Query = {}): Promise<ApiResponse> {
    const url = this.url(path, query);
    const maxRetries = this.options.maxRetries ?? 2;

    for (let attempt = 0; ; attempt++) {
      const response = await this.send(url);
      const data = await this.parse(response);

      if (response.ok) {
        return { data, rateLimit: rateLimitOf(response.headers) };
      }

      const body = errorBody(data, response);
      const wait = body.retry_after ?? Number(response.headers.get("retry-after"));
      if (
        response.status === 429 &&
        attempt < maxRetries &&
        Number.isFinite(wait) &&
        wait > 0 &&
        wait <= MAX_RETRY_WAIT_SECONDS
      ) {
        this.options.onRetry?.(wait);
        await this.sleep(wait * 1000);
        continue;
      }
      throw new ApiError(body, this.options.tokenPage);
    }
  }

  /**
   * Accepts a path relative to the API ("/projects/1/answers?limit=5"), the same
   * path with the /api/v1 prefix, or a full URL under the base URL (the
   * `next_request` links of the action plan). Any other host is refused so the
   * token never leaves for a URL the user did not configure.
   */
  url(path: string, query: Query = {}): URL {
    const base = this.options.baseUrl;
    let target: URL;

    if (/^https?:\/\//i.test(path)) {
      target = new URL(path);
    } else {
      const basePath = new URL(base).pathname;
      let relative = path.startsWith("/") ? path : `/${path}`;
      if (relative === basePath || relative.startsWith(`${basePath}/`)) {
        relative = relative.slice(basePath.length) || "/";
      }
      target = new URL(`${base}${relative}`);
    }

    // Also catches "../" segments, which URL parsing has already resolved.
    const inside = `${target.origin}${target.pathname}`;
    if (inside !== base && !inside.startsWith(`${base}/`)) {
      throw new UsageError(`Only URLs under ${base} can be requested.`);
    }

    for (const [key, value] of Object.entries(query)) {
      target.searchParams.set(key, value);
    }
    return target;
  }

  private async send(url: URL): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.options.token}`,
          "User-Agent": `${NAME}-cli/${VERSION} (node ${process.version}; ${process.platform})`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "TimeoutError"
          ? "the request timed out"
          : causeOf(error);
      throw new CliError(`Could not reach ${url.host}: ${reason}`);
    }
  }

  private async parse(response: Response): Promise<unknown> {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new CliError(`The API answered HTTP ${response.status} without JSON.`);
    }
  }
}

function errorBody(data: unknown, response: Response): ApiErrorBody {
  const error =
    data !== null && typeof data === "object" ? (data as { error?: unknown }).error : undefined;
  if (error !== null && typeof error === "object") {
    const body = error as Partial<ApiErrorBody>;
    if (typeof body.code === "string" && typeof body.message === "string") {
      return { ...body, status: body.status ?? response.status } as ApiErrorBody;
    }
  }
  return {
    code: "http_error",
    message: `The API answered HTTP ${response.status}.`,
    status: response.status,
  };
}

function rateLimitOf(headers: Headers): RateLimit {
  const read = (name: string) => {
    const value = headers.get(name);
    return value === null || value === "" ? null : Number(value);
  };
  return { limit: read("x-ratelimit-limit"), remaining: read("x-ratelimit-remaining") };
}

function causeOf(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) {
      return cause.message;
    }
    return error.message;
  }
  return String(error);
}
