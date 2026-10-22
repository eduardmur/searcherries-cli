# Searcherries CLI

Your [Searcherries](https://searcherries.com) data in the terminal: how ChatGPT, Perplexity, Google AI Overviews, Gemini, Claude and Grok answer the customer questions you track, which competitors and sources they name, and the Google Search Console, Bing Webmaster Tools and GA4 AI-traffic data of your projects. Tables for people, JSON for scripts and AI coding agents.

The CLI is read-only. It reads the [Searcherries REST API](https://searcherries.com/docs/api/overview) and cannot change projects, questions or billing.

```text
$ searcherries competitors acme
Acme · acme.com · competitors, 2026-09-23 to 2026-10-22 (last_30_days)

Rank  Brand       Website          Visibility  Mentions  Citations  Avg position
   1  Rival       rival.example           99%        80          8           1.5
   2  Otterly     otterly.example       65.6%        25          4           1.5
   3  Acme (you)  acme.com                 0%         0          0             0
```

## Install

You need [Node.js](https://nodejs.org) 20 or newer and a Searcherries account.

```bash
npm install -g searcherries
```

Or run it without installing: `npx searcherries <command>`.

## Sign in

1. Open [MCP](https://app.searcherries.com/mcp) in Searcherries, go to the **Other clients** tab and create an access token. It is shown once.
2. Run `searcherries login` and paste it. The token is checked against the API, then saved in a file only your user can read.

In CI and scripts, set `SEARCHERRIES_TOKEN` instead of logging in. The same token works for the CLI, the REST API and MCP clients; revoke it on the MCP page to stop all of them at once.

## Commands

| Command                     | Returns                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`                  | Your projects, with status, plan, last check and connected sources.                                                                           |
| `summary [project]`         | One compact snapshot: AI visibility, questions, competitors, cited domains, search, AI traffic, connections.                                  |
| `answers [project]`         | Stored AI answers with their judgments: how prominently the brand is named, sentiment, cited URLs.                                            |
| `search [project]`          | Google Search Console or Bing Webmaster Tools: totals, top queries and pages, opportunities, trends, question-shaped queries, daily, monthly. |
| `competitors [project]`     | Brands the AI platforms name: ranking, one brand in detail, or month by month.                                                                |
| `citations [project]`       | URLs or domains the AI answers cite.                                                                                                          |
| `traffic [project]`         | GA4 traffic from AI assistants and AI Overviews: sources, landing pages, daily, monthly.                                                      |
| `plan [project]`            | Prioritized next steps with dated evidence, for a business owner, marketer or SEO.                                                            |
| `api <path>`                | Any REST API path, printed as JSON.                                                                                                           |
| `login`, `logout`, `status` | Save, remove or check the token.                                                                                                              |

`searcherries <command> --help` lists every option of a command with its allowed values.

The free plan covers projects, the summary, search, traffic and the action plan. `answers`, `competitors` and `citations` need Starter or Pro.

### Projects

`[project]` is a project id, a brand name or a domain, or a fragment of one: `acme`, `acme.com` and `123` all work. Leave it out when the account has one project, or set `SEARCHERRIES_PROJECT`. Quote names with spaces.

## Examples

```bash
# Where the brand is missing from AI answers
searcherries answers acme --prominence-max 1

# Negative answers and drawbacks, with the answer text and the quote behind each flag
searcherries answers acme --only-flagged --include-answer-text

# One competitor in detail, and the monthly ranking
searcherries competitors acme --competitor rival
searcherries competitors acme --dataset history

# Queries with many impressions and few clicks, over 90 days
searcherries search acme --dataset opportunities --period 90d

# Your own pages that AI answers cite
searcherries citations acme --own-site-only

# Landing pages of AI visitors
searcherries traffic acme --dataset landing_pages

# The action plan for an SEO, as JSON
searcherries plan acme --audience seo --json
```

## Scripts and AI agents

- `--json` prints the API response unchanged. Errors never go to stdout: they are written to stderr, as the API's `{"error": {...}}` envelope when `--json` is set.
- `--all` follows the pages of `answers`, `search`, `competitors`, `citations` and `traffic` and prints them as one document.
- `searcherries api '/projects/123/answers?prominence_max=1'` calls any endpoint of the [REST API reference](https://searcherries.com/docs/api/endpoints). Full URLs under the API work too, such as the `next_request` links of an action plan.
- The rate limit is 30 requests a minute on Free, 60 on Starter and 120 on Pro. On a `429` the CLI waits as long as the API asks (up to a minute) and retries.

Exit codes:

| Code | Meaning                                                                                |
| ---- | -------------------------------------------------------------------------------------- |
| 0    | Success.                                                                               |
| 1    | The API or the network failed, the project was not found, or a parameter was rejected. |
| 2    | Usage error: unknown command or option, or a value of the wrong type.                  |
| 3    | Not signed in, or the token was rejected.                                              |
| 4    | The endpoint needs a Starter or Pro plan.                                              |

AI coding agents such as Claude Code and Codex can run the CLI directly. Tell the agent to use `searcherries <command> --json`, or connect the [Searcherries MCP server](https://searcherries.com/docs/mcp/overview) instead if your client supports MCP.

## Environment

| Variable                  | Meaning                                                      |
| ------------------------- | ------------------------------------------------------------ |
| `SEARCHERRIES_TOKEN`      | Access token. Takes precedence over the saved one.           |
| `SEARCHERRIES_PROJECT`    | Default project.                                             |
| `SEARCHERRIES_API_URL`    | API base URL, default `https://app.searcherries.com/api/v1`. |
| `SEARCHERRIES_CONFIG_DIR` | Where the token is saved.                                    |
| `NO_COLOR`                | Plain output on a terminal.                                  |

The token is saved in `~/Library/Application Support/searcherries` on macOS, `%APPDATA%\searcherries` on Windows and `~/.config/searcherries` on Linux. It is only ever sent to the API URL it was checked against, and only over HTTPS (plain HTTP is accepted for `localhost`).

## Links

- [CLI documentation](https://searcherries.com/docs/api/cli)
- [REST API overview](https://searcherries.com/docs/api/overview) and [endpoint reference](https://searcherries.com/docs/api/endpoints)
- [MCP server for Claude, ChatGPT, Codex and Cursor](https://searcherries.com/docs/mcp/overview)
- [Issues](https://github.com/eduardmur/searcherries-cli/issues)

## License

MIT
