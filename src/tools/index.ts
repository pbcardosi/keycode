import { createBashTool } from "./bash.js";
import { createPowerShellTool } from "./powershell.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";
import { createEditTool } from "./edit.js";
import { createGlobTool } from "./glob.js";
import { createGrepTool } from "./grep.js";
import { createTodoTool } from "./todo.js";
import { createQuestionTool } from "./question.js";
import { createWebFetchTool } from "./webfetch.js";
import { createWebSearchTool } from "./websearch.js";
import { createNotebookEditTool } from "./notebook.js";
import type { Tool } from "../contracts/tool.js";
import type { ToolSpec } from "../contracts/provider.js";
import { z } from "zod";

export function createCoreTools(): Tool[] {
  return [
    createBashTool(),
    createPowerShellTool(),
    createReadTool(),
    createWriteTool(),
    createEditTool(),
    createGlobTool(),
    createGrepTool(),
    createTodoTool(),
    createQuestionTool(),
    createWebFetchTool(),
    createWebSearchTool({ provider: null }),
    createNotebookEditTool(),
  ];
}

export function toolSpecs(tools: Tool[]): ToolSpec[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.input, { target: "draft-7" }),
  }));
}

export function findTool(tools: Tool[], name: string): Tool | undefined {
  return tools.find((tool) => tool.name === name);
}
