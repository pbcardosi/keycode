import { describe, expect, it } from "vitest";
import {
  buildPrComment,
  getPullRequestDiff,
  reviewDiff,
  securityReview,
} from "../../dist/integrations/pr.js";

const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,6 @@",
  " const a = 1;",
  '+console.log("debug");',
  "+eval(userInput);",
  "+catch {}",
  '+const apiKey = "supersecretvalue";',
].join("\n");

describe("T-I9: PR workflows", () => {
  it("reviews a diff, produces findings, and posts a comment payload", async () => {
    const findings = reviewDiff(DIFF);
    expect(findings.some((finding) => finding.message.includes("debug logging"))).toBe(true);
    expect(findings.some((finding) => finding.severity === "high" && finding.message.includes("eval"))).toBe(true);
    expect(findings.some((finding) => finding.severity === "high" && finding.message.includes("secrets"))).toBe(true);
    expect(findings.some((finding) => finding.message.includes("empty catch"))).toBe(true);

    const comment = buildPrComment(findings);
    expect(comment).toContain("high");
    expect(comment).toContain("src/a.ts");

    const clean = "diff --git a/x b/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n";
    expect(reviewDiff(clean)).toEqual([]);
    expect(buildPrComment([])).toContain("no findings");
    expect(securityReview(DIFF).every((finding) => finding.severity === "high")).toBe(true);

    const diff = await getPullRequestDiff({
      repo: "acme/demo",
      number: 3,
      gh: async (args) => {
        expect(args[0]).toBe("pr");
        return DIFF;
      },
    });
    expect(diff).toBe(DIFF);
  });
});
