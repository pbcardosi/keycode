import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../contracts/tool.js";
import { toolOk } from "../contracts/tool.js";
import { newId } from "../util/ids.js";

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority?: string | undefined;
}

export const TodoInput = z.object({
  todos: z.array(
    z.object({
      id: z.string().optional(),
      content: z.string().min(1),
      status: z.enum(["pending", "in_progress", "completed"]),
      priority: z.enum(["high", "medium", "low"]).optional(),
    }),
  ),
});

export type TodoInputType = z.infer<typeof TodoInput>;

export function renderTodos(todos: TodoItem[]): string {
  return todos
    .map((todo) => {
      const mark = todo.status === "completed" ? "[x]" : todo.status === "in_progress" ? "[>]" : "[ ]";
      return `${mark} ${todo.content}${todo.priority ? ` (${todo.priority})` : ""}`;
    })
    .join("\n");
}

export function createTodoTool(): Tool<TodoInputType> {
  return {
    name: "TodoWrite",
    description:
      "Replace the session todo list. Use it to track multi-step work and keep exactly one item in_progress.",
    input: TodoInput,
    readOnly: true,
    concurrency: "exclusive",
    async execute(input: TodoInputType, ctx: ToolContext): Promise<ToolResult> {
      const todos: TodoItem[] = input.todos.map((todo) => ({
        id: todo.id ?? newId("todo"),
        content: todo.content,
        status: todo.status,
        ...(todo.priority === undefined ? {} : { priority: todo.priority }),
      }));
      ctx.state.todos = todos;
      const completed = todos.filter((todo) => todo.status === "completed").length;
      return toolOk(`${completed}/${todos.length} complete\n${renderTodos(todos)}`, { todos });
    },
  };
}
