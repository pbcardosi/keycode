export interface PrFinding {
  severity: "high" | "medium" | "low";
  file?: string | undefined;
  line?: number | undefined;
  message: string;
}

interface DiffHunk {
  file: string;
  added: Array<{ line: number; text: string }>;
}

export function parseUnifiedDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let lineNumber = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      current = { file: line.slice(6), added: [] };
      hunks.push(current);
      continue;
    }
    if (line.startsWith("@@")) {
      const match = /\+(\d+)/.exec(line);
      lineNumber = match?.[1] === undefined ? 0 : Number(match[1]);
      continue;
    }
    if (current && line.startsWith("+") && !line.startsWith("+++")) {
      current.added.push({ line: lineNumber, text: line.slice(1) });
      lineNumber += 1;
    } else if (!line.startsWith("-")) {
      lineNumber += 1;
    }
  }
  return hunks;
}

export function reviewDiff(diff: string): PrFinding[] {
  const findings: PrFinding[] = [];
  for (const hunk of parseUnifiedDiff(diff)) {
    for (const added of hunk.added) {
      const text = added.text;
      if (/console\.log\(/.test(text)) {
        findings.push({ severity: "low", file: hunk.file, line: added.line, message: "Remove debug logging." });
      }
      if (/\b(TODO|FIXME)\b/.test(text)) {
        findings.push({ severity: "low", file: hunk.file, line: added.line, message: "Resolve or track the TODO/FIXME." });
      }
      if (/\beval\s*\(/.test(text)) {
        findings.push({ severity: "high", file: hunk.file, line: added.line, message: "Avoid eval on untrusted input." });
      }
      if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(text)) {
        findings.push({ severity: "medium", file: hunk.file, line: added.line, message: "Do not swallow errors with an empty catch." });
      }
      if (/(api[_-]?key|secret|token)\s*[:=]\s*["'][^"']{8,}["']/i.test(text)) {
        findings.push({ severity: "high", file: hunk.file, line: added.line, message: "Do not hard-code secrets." });
      }
      if (/innerHTML\s*=/.test(text)) {
        findings.push({ severity: "medium", file: hunk.file, line: added.line, message: "Sanitize before assigning innerHTML." });
      }
    }
  }
  return findings;
}

export function securityReview(diff: string): PrFinding[] {
  return reviewDiff(diff).filter((finding) => finding.severity === "high");
}

export function buildPrComment(findings: PrFinding[]): string {
  if (findings.length === 0) return "KeyCode review: no findings. ✅";
  const lines = ["KeyCode review findings:", ""];
  for (const finding of findings) {
    const location = finding.file ? ` (${finding.file}${finding.line === undefined ? "" : `:${finding.line}`})` : "";
    lines.push(`- **${finding.severity}**${location}: ${finding.message}`);
  }
  return lines.join("\n");
}

export async function getPullRequestDiff(options: {
  repo: string;
  number: number;
  gh?: ((args: string[], input?: string) => Promise<string>) | undefined;
}): Promise<string> {
  const gh =
    options.gh ??
    (async (args: string[]) => {
      const { execFile } = await import("node:child_process");
      return await new Promise<string>((resolvePromise, rejectPromise) => {
        execFile("gh", args, { encoding: "utf8", windowsHide: true }, (error, stdout) => {
          if (error) rejectPromise(error);
          else resolvePromise(stdout);
        });
      });
    });
  return await gh(["pr", "diff", String(options.number), "--repo", options.repo]);
}
