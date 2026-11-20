import { describe, expect, it } from "vitest";
import { createTodoTool, renderTodos } from "../../dist/tools/todo.js";
import { SessionStore } from "../../dist/storage/session.js";
import { makeHome, makeWorkspace, makeToolCtx, textOf } from "../helpers.js";

describe("T-T10: TodoWrite", () => {
  it("replaces todos, persists session state, and renders rows", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const store = new SessionStore(home, ws);
    const header = store.create({ provider: "fake", model: "fake-model" });
    const ctx = makeToolCtx({ cwd: ws, home });
    ctx.sessionId = header.id;

    const tool = createTodoTool();
    const written = await tool.execute(
      {
        todos: [
          { content: "one", status: "pending" },
          { content: "two", status: "in_progress" },
          { content: "three", status: "completed" },
        ],
      },
      ctx,
    );
    expect(written.ok).toBe(true);
    expect(textOf(written)).toContain("3");
    expect(ctx.state.todos).toHaveLength(3);

    const updated = await tool.execute(
      {
        todos: [
          { id: ctx.state.todos[0]?.id, content: "one", status: "completed" },
          { id: ctx.state.todos[1]?.id, content: "two", status: "completed" },
        ],
      },
      ctx,
    );
    expect(updated.ok).toBe(true);
    expect(ctx.state.todos.filter((todo) => todo.status === "completed")).toHaveLength(2);

    store.appendTodos(header.id, ctx.state.todos);
    const reloaded = new SessionStore(home, ws).load(header.id);
    expect(reloaded.todos).toHaveLength(2);
    expect(reloaded.todos.every((todo) => todo.status === "completed")).toBe(true);

    const rendered = renderTodos(ctx.state.todos);
    expect(rendered).toContain("[x] one");
    expect(rendered).toContain("[x] two");
  });
});
