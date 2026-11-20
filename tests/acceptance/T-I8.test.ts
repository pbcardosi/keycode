import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createWorktree,
  hasUncommittedChanges,
  listWorktrees,
  removeWorktree,
  worktreeGuard,
} from "../../dist/integrations/worktrees.js";
import { makeWorkspace } from "../helpers.js";

function git(repo: string, args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "ignore", windowsHide: true });
}

describe("T-I8: worktrees", () => {
  it("creates and removes a worktree and guards uncommitted changes", () => {
    const repo = makeWorkspace();
    git(repo, ["init"]);
    writeFileSync(join(repo, "a.txt"), "a\n");
    git(repo, ["add", "."]);
    git(repo, ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "init"]);

    expect(worktreeGuard(repo).clean).toBe(true);
    const info = createWorktree(repo, "topic", { baseDir: join(repo, "..", "wt") });
    expect(existsSync(info.path)).toBe(true);
    expect(info.branch).toBe("keycode/topic");
    expect(listWorktrees(repo).some((worktree) => worktree.path.endsWith("topic"))).toBe(true);

    writeFileSync(join(repo, "a.txt"), "changed\n");
    expect(hasUncommittedChanges(repo)).toBe(true);
    expect(worktreeGuard(repo).clean).toBe(false);

    removeWorktree(repo, info.path, { force: true });
    expect(existsSync(info.path)).toBe(false);
  });
});
