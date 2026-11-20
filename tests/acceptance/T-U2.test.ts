import { describe, expect, it } from "vitest";
import {
  appendHistory,
  completeFile,
  loadHistory,
  readDrafts,
  saveDraft,
  searchHistory,
  slashCompletions,
} from "../../dist/tui/input.js";
import { makeHome } from "../helpers.js";

describe("T-U2: input and completion", () => {
  it("searches history by substring", () => {
    const history = ["ls", "npm run build", "ls -la"];
    expect(searchHistory(history, "ls").sort()).toEqual(["ls", "ls -la"]);
    expect(searchHistory(history, "").length).toBe(3);
  });

  it("completes @file paths", () => {
    expect(completeFile("@a", ["a.ts", "ab.md", "b.ts"]).sort()).toEqual(["a.ts", "ab.md"]);
    expect(completeFile("plain text", ["a.ts"])).toEqual([]);
  });

  it("completes slash commands", () => {
    expect(slashCompletions("/m", ["/model", "/mode", "/copy"]).sort()).toEqual(["/mode", "/model"]);
    expect(slashCompletions("/co", ["/model", "/mode", "/copy"])).toEqual(["/copy"]);
  });

  it("persists drafts and history", () => {
    const home = makeHome();
    saveDraft(home, "sess-1", "draft text");
    expect(readDrafts(home, "sess-1")).toContain("draft text");
    appendHistory(home, "cmd-one");
    expect(loadHistory(home)).toContain("cmd-one");
  });
});
