import { describe, expect, it } from "vitest";
import { createTaskTool } from "../../dist/tools/tasks.js";
import { makeToolCtx, makeWorkspace, textOf } from "../helpers.js";

const sleep = (ms: number): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

describe("T-T15: background tasks", () => {
  it("creates, lists, reads output, stops, and persists a task", async () => {
    const ctx = makeToolCtx({ cwd: makeWorkspace() });
    const tool = createTaskTool();
    const created = await tool.execute(
      { action: "create", command: 'node -e "console.log(\'started\');setTimeout(()=>{},5000)"' },
      ctx,
    );
    expect(created.ok).toBe(true);
    const task = (created.metadata as { task: { id: string } }).task;

    const listed = await tool.execute({ action: "list" }, ctx);
    expect(textOf(listed)).toContain(task.id);

    await sleep(500);
    const output = await tool.execute({ action: "output", task_id: task.id }, ctx);
    expect(textOf(output)).toContain("started");

    const stopped = await tool.execute({ action: "stop", task_id: task.id }, ctx);
    expect(stopped.ok).toBe(true);

    const record = await tool.execute({ action: "get", task_id: task.id }, ctx);
    expect((record.metadata as { task: { status: string } }).task.status).toBe("stopped");
  });
});
