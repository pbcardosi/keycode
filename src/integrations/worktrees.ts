import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

function git(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true });
}

export interface WorktreeInfo {
  path: string;
  branch: string;
}

export interface CreateWorktreeOptions {
  baseDir?: string | undefined;
}

export function hasUncommittedChanges(repo: string): boolean {
  return git(repo, ["status", "--porcelain"]).trim().length > 0;
}

export function worktreeGuard(repo: string): { clean: boolean; changes: string } {
  const changes = git(repo, ["status", "--porcelain"]).trim();
  return { clean: changes.length === 0, changes };
}

export function createWorktree(
  repo: string,
  name: string,
  options: CreateWorktreeOptions = {},
): WorktreeInfo {
  if (!existsSync(join(repo, ".git"))) {
    throw new Error(`${repo} is not a git repository`);
  }
  const baseDir = options.baseDir ?? resolve(repo, "..", `${repo.replaceAll("\\", "/").split("/").pop()}-worktrees`);
  const path = join(baseDir, name);
  const branch = `keycode/${name}`;
  git(repo, ["worktree", "add", "-b", branch, path]);
  return { path, branch };
}

export function removeWorktree(repo: string, path: string, options: { force?: boolean } = {}): void {
  git(repo, ["worktree", "remove", ...(options.force === true ? ["--force"] : []), path]);
}

export function listWorktrees(repo: string): WorktreeInfo[] {
  const output = git(repo, ["worktree", "list", "--porcelain"]);
  const result: WorktreeInfo[] = [];
  let currentPath = "";
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) currentPath = line.slice("worktree ".length);
    else if (line.startsWith("branch ")) {
      result.push({ path: currentPath, branch: line.slice("branch ".length).replace("refs/heads/", "") });
    }
  }
  return result;
}
