export interface PullRequestEvent {
  action?: string | undefined;
  number?: number | undefined;
  repository?: { full_name?: string | undefined } | undefined;
  pull_request?:
    | {
        title?: string | undefined;
        body?: string | null | undefined;
        html_url?: string | undefined;
        user?: { login?: string | undefined } | undefined;
        base?: { ref?: string | undefined } | undefined;
        head?: { ref?: string | undefined } | undefined;
      }
    | undefined;
  comment?: { body?: string | undefined; user?: { login?: string | undefined } | undefined } | undefined;
}

export function parsePullRequestEvent(raw: unknown): PullRequestEvent {
  if (raw === null || typeof raw !== "object") return {};
  return raw as PullRequestEvent;
}

export function mentionedClaude(event: PullRequestEvent, trigger = "@claude"): boolean {
  const body = event.comment?.body ?? event.pull_request?.body ?? "";
  return body.toLowerCase().includes(trigger.toLowerCase());
}

export function buildGitHubPrompt(event: PullRequestEvent, diff: string): string {
  const pr = event.pull_request ?? {};
  return [
    "GitHub pull request context:",
    `repository: ${event.repository?.full_name ?? "unknown"}`,
    `pull request: #${event.number ?? "?"} ${pr.title ?? ""}`,
    `author: ${pr.user?.login ?? "unknown"}`,
    `branches: ${pr.base?.ref ?? "base"} <- ${pr.head?.ref ?? "head"}`,
    `url: ${pr.html_url ?? ""}`,
    "",
    "Description:",
    (pr.body ?? "").trim() || "(none)",
    "",
    "Diff:",
    "```diff",
    diff.trim(),
    "```",
    "",
    "Review the diff, explain risks, and suggest a minimal fix. Use a least-privilege token and never print secrets.",
  ].join("\n");
}

export function buildCommentPayload(body: string): { body: string } {
  return { body };
}

export async function postIssueComment(options: {
  token: string;
  repo: string;
  issueNumber: number;
  body: string;
  fetchImpl?: typeof fetch | undefined;
}): Promise<{ ok: boolean; status: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `https://api.github.com/repos/${options.repo}/issues/${options.issueNumber}/comments`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "KeyCode",
      },
      body: JSON.stringify(buildCommentPayload(options.body)),
    },
  );
  return { ok: response.ok, status: response.status };
}

export const GITHUB_WORKFLOW_TEMPLATE = [
  "name: KeyCode",
  "on:",
  "  issue_comment:",
  "    types: [created]",
  "  pull_request:",
  "    types: [opened, synchronize]",
  "permissions:",
  "  contents: read",
  "  pull-requests: write",
  "  issues: write",
  "jobs:",
  "  review:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "      - uses: actions/setup-node@v4",
  "        with: { node-version: 22 }",
  "      - run: npm install -g keycode-cli",
  "      - run: keycode -p \"Review this pull request\" --output-format json",
  "        env:",
  "          KEYCODE_PROVIDER: ${{ vars.KEYCODE_PROVIDER }}",
  "          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}",
].join("\n");
