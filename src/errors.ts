/**
 * Exit codes are part of the public contract (README, docs page): scripts and
 * agents branch on them, so a code never changes meaning.
 */
export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  auth: 3,
  plan: 4,
  interrupted: 130,
} as const;

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = EXIT.error,
    readonly hints: string[] = [],
  ) {
    super(message);
    this.name = "CliError";
  }
}

export class UsageError extends CliError {
  constructor(message: string, hints: string[] = []) {
    super(message, EXIT.usage, hints);
    this.name = "UsageError";
  }
}

/** The `error` object of the REST API envelope. */
export interface ApiErrorBody {
  code: string;
  message: string;
  status: number;
  errors?: Record<string, string[]>;
  retry_after?: number;
  plans_url?: string;
  required_scopes?: string[];
}

const AUTH_CODES = new Set(["unauthenticated", "insufficient_scope"]);

export class ApiError extends CliError {
  constructor(
    readonly body: ApiErrorBody,
    tokenPage: string,
  ) {
    super(body.message, ApiError.exitCodeFor(body.code), ApiError.hintsFor(body, tokenPage));
    this.name = "ApiError";
  }

  static exitCodeFor(code: string): number {
    if (AUTH_CODES.has(code)) {
      return EXIT.auth;
    }
    return code === "paid_plan_required" ? EXIT.plan : EXIT.error;
  }

  private static hintsFor(body: ApiErrorBody, tokenPage: string): string[] {
    switch (body.code) {
      case "unauthenticated":
        return [
          `The token is missing, expired or revoked. Create one at ${tokenPage} and run: searcherries login`,
        ];
      case "insufficient_scope":
        return [`This token cannot read the API. Create a new one at ${tokenPage}`];
      case "paid_plan_required":
        return [
          "AI answers, competitors and citations need a Starter or Pro plan.",
          ...(body.plans_url ? [`Plans: ${body.plans_url}`] : []),
        ];
      case "validation_failed":
        return Object.entries(body.errors ?? {}).flatMap(([field, messages]) =>
          messages.map((message) => `--${field.replaceAll("_", "-")}: ${message}`),
        );
      case "rate_limited":
        return body.retry_after ? [`Try again in ${body.retry_after} seconds.`] : [];
      default:
        return [];
    }
  }
}
