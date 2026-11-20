import { describe, expect, it } from "vitest";
import {
  GITHUB_WORKFLOW_TEMPLATE,
  buildGitHubPrompt,
  buildCommentPayload,
  mentionedClaude,
  parsePullRequestEvent,
  postIssueComment,
} from "../../dist/integrations/github.js";

const EVENT = {
  action: "opened",
  number: 7,
  repository: { full_name: "acme/demo" },
  pull_request: {
    title: "Fix auth",
    body: "Please review @claude",
    html_url: "https://github.com/acme/demo/pull/7",
    user: { login: "dev" },
    base: { ref: "main" },
    head: { ref: "fix-auth" },
  },
};

const DIFF = "diff --git a/a.ts b/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n";

describe("T-I2: GitHub Actions", () => {
  it("builds a PR prompt with the diff, detects mentions, and posts a comment", async () => {
    const event = parsePullRequestEvent(EVENT);
    expect(mentionedClaude(event)).toBe(true);
    const prompt = buildGitHubPrompt(event, DIFF);
    expect(prompt).toContain("#7 Fix auth");
    expect(prompt).toContain("acme/demo");
    expect(prompt).toContain("+new");
    expect(buildCommentPayload("review")).toEqual({ body: "review" });

    let captured: { url: string; init: RequestInit | undefined } | null = null;
    const fetchImpl: typeof fetch = async (input, init) => {
      captured = { url: String(input), init };
      return new Response("{}", { status: 201 });
    };
    const result = await postIssueComment({
      token: "ghp_test",
      repo: "acme/demo",
      issueNumber: 7,
      body: "keycode review",
      fetchImpl,
    });
    expect(result).toEqual({ ok: true, status: 201 });
    expect(captured?.url).toContain("/repos/acme/demo/issues/7/comments");
    const headers = (captured?.init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe("Bearer ghp_test");
    expect(captured?.init?.body).toContain("keycode review");
    expect(GITHUB_WORKFLOW_TEMPLATE).toContain("permissions:");
    expect(GITHUB_WORKFLOW_TEMPLATE).toContain("contents: read");
  });
});
