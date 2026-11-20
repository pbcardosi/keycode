import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentSetup } from "./factory.js";
import type { Agent } from "./agent.js";
import { exportJson, exportMarkdown, latestAssistantText } from "./export.js";
import { contextGrid } from "../core/context.js";
import { getPreset } from "../providers/presets.js";
import { copyToClipboard } from "../util/clipboard.js";
import { normalizeSlashes } from "../util/paths.js";
import { findCommand, renderCommand } from "../extensions/commands.js";

export interface CommandResult {
  handled: boolean;
  clear?: boolean;
  exit?: boolean;
}

export interface CommandContext {
  setup: AgentSetup;
  agent: Agent;
  out: (text: string) => void;
  signal: AbortSignal;
}

export const COMMAND_HELP: Array<[string, string]> = [
  ["/help", "Show this command list"],
  ["/model [id]", "Show or change the model"],
  ["/effort [level]", "Show or change reasoning effort"],
  ["/cost", "Show session cost and token usage"],
  ["/usage", "Show token usage"],
  ["/stats", "Show session statistics"],
  ["/context", "Show the context budget"],
  ["/compact [instructions]", "Summarize older turns"],
  ["/rewind [id|latest] [files|conversation|both]", "Restore a checkpoint"],
  ["/branch [name]", "Fork the current session"],
  ["/btw <question>", "Ask a side question without saving it"],
  ["/add-dir <paths...>", "Add directories to the workspace"],
  ["/cd <path>", "Change the session working directory"],
  ["/export [file]", "Export the transcript as markdown or JSON"],
  ["/copy [N]", "Copy the Nth-latest response text"],
  ["/rename <name>", "Rename the session"],
  ["/clear", "Start a new session"],
  ["/sessions", "List recent sessions"],
  ["/permissions", "Show permission mode and rules"],
  ["/memory", "Show loaded memory files"],
  ["/status", "Show provider, model, and session"],
  ["/exit", "Exit keycode"],
];

function usageLine(agent: Agent): string {
  const usage = agent.usage;
  return `tokens: ${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out | cost: $${agent.costUsd.toFixed(4)}`;
}

function workspaceRoots(agent: Agent): string[] {
  return agent.workspaceRoots;
}

export async function executeCommand(line: string, ctx: CommandContext): Promise<CommandResult> {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) return { handled: false };
  const [rawName = "", ...rest] = trimmed.slice(1).split(/\s+/);
  const name = rawName.toLowerCase();
  const args = rest.join(" ").trim();
  const { setup, agent, out } = ctx;

  switch (name) {
    case "help": {
      const lines = COMMAND_HELP.map(([command, description]) => `${command.padEnd(32)} ${description}`);
      for (const command of setup.commands) {
        lines.push(`${`/${command.name}`.padEnd(32)} ${command.description || "Custom command"}`);
      }
      out(lines.join("\n"));
      return { handled: true };
    }
    case "model": {
      if (args.length === 0) {
        out(`model: ${agent.model} (provider: ${agent.providerId})`);
      } else {
        agent.setModel(args);
        out(`model set to ${args}`);
      }
      return { handled: true };
    }
    case "effort": {
      if (args.length === 0) {
        out(`effort: ${agent.effort ?? "default"}`);
      } else if (["low", "medium", "high", "xhigh", "max"].includes(args)) {
        agent.setEffort(args as NonNullable<Agent["effort"]>);
        out(`effort set to ${args}`);
      } else {
        out("effort must be low, medium, high, xhigh, or max");
      }
      return { handled: true };
    }
    case "cost":
    case "usage":
    case "stats": {
      out(`${usageLine(agent)}\nsession: ${setup.sessionId}\nmodel: ${setup.providerId}/${setup.model}`);
      return { handled: true };
    }
    case "context": {
      const estimate = agent.contextEstimate();
      const preset = getPreset(setup.providerId);
      out(contextGrid(estimate.tokens, preset?.contextWindow ?? 128_000));
      return { handled: true };
    }
    case "compact": {
      const result = await agent.compact(args.length > 0 ? args : undefined, ctx.signal);
      if (result.compacted) {
        out(
          `Compacted ${result.summary?.replaces.length ?? 0} messages: ${result.tokensBefore.toLocaleString()} -> ${result.tokensAfter.toLocaleString()} tokens.`,
        );
      } else {
        out("Nothing to compact yet.");
      }
      return { handled: true };
    }
    case "rewind": {
      const [target, modeRaw] = args.split(/\s+/);
      const view = setup.store.load(setup.sessionId);
      if (!target) {
        if (view.checkpoints.length === 0) {
          out("No checkpoints yet.");
        } else {
          out(
            view.checkpoints
              .slice(-10)
              .map(
                (checkpoint) =>
                  `${checkpoint.id}  turn ${checkpoint.turn}  ${checkpoint.files.length} file(s)  ${checkpoint.timestamp}`,
              )
              .join("\n"),
          );
        }
        return { handled: true };
      }
      const checkpoint =
        target === "latest"
          ? view.checkpoints.at(-1)
          : view.checkpoints.find((item) => item.id === target);
      if (!checkpoint) {
        out(`Checkpoint not found: ${target}`);
        return { handled: true };
      }
      const mode = modeRaw === "files" || modeRaw === "conversation" || modeRaw === "both" ? modeRaw : "both";
      const result = agent.rewind(checkpoint.id, mode);
      out(`Rewound ${mode}: ${result.files} file(s) restored, ${result.messages} message(s) kept.`);
      return { handled: true };
    }
    case "branch": {
      const id = agent.branch(args.length > 0 ? args : undefined);
      out(`Branched session: ${id}`);
      return { handled: true };
    }
    case "btw": {
      if (args.length === 0) {
        out("Usage: /btw <question>");
        return { handled: true };
      }
      const answer = await agent.sideQuestion(args, ctx.signal);
      out(answer);
      return { handled: true };
    }
    case "add-dir": {
      const dirs = args.split(/\s+/).filter((item) => item.length > 0);
      const roots = [...new Set([...workspaceRoots(agent), ...dirs.map((dir) => resolve(agent.cwd, dir))])];
      agent.setWorkspace(agent.cwd, roots);
      out(`Workspace roots: ${roots.map((root) => normalizeSlashes(root)).join("; ")}`);
      return { handled: true };
    }
    case "cd": {
      if (args.length === 0) {
        out(`cwd: ${normalizeSlashes(agent.cwd)}`);
        return { handled: true };
      }
      const next = resolve(agent.cwd, args);
      const roots = [...new Set([...workspaceRoots(agent), next])];
      agent.setWorkspace(next, roots);
      out(`cwd set to ${normalizeSlashes(next)}`);
      return { handled: true };
    }
    case "export": {
      const view = setup.store.load(setup.sessionId);
      const format = args.endsWith(".json") ? "json" : "markdown";
      const path = resolve(
        setup.store.cwd,
        args.length > 0
          ? args
          : `keycode-session-${setup.sessionId.slice(0, 8)}.${format === "json" ? "json" : "md"}`,
      );
      writeFileSync(path, format === "json" ? exportJson(view) : exportMarkdown(view));
      out(`Exported to ${path}`);
      return { handled: true };
    }
    case "copy": {
      const view = setup.store.load(setup.sessionId);
      const index = Number(args) > 0 ? Number(args) : 1;
      const text = latestAssistantText(view, index);
      if (text.length > 0) {
        copyToClipboard(text);
        out(text);
      } else {
        out("No assistant response to copy.");
      }
      return { handled: true };
    }
    case "rename": {
      if (args.length === 0) {
        out("Usage: /rename <name>");
        return { handled: true };
      }
      setup.store.rename(setup.sessionId, args);
      out(`Renamed session to ${args}`);
      return { handled: true };
    }
    case "clear":
      out("Starting a new session.");
      return { handled: true, clear: true };
    case "sessions": {
      const sessions = setup.store.list().slice(0, 10);
      out(
        sessions.length === 0
          ? "No sessions."
          : sessions
              .map((session) => `${session.id.slice(0, 8)}  ${session.name}  ${session.messageCount} msgs  ${session.model}`)
              .join("\n"),
      );
      return { handled: true };
    }
    case "permissions":
      out(`mode: ${setup.permissionMode}`);
      return { handled: true };
    case "memory": {
      const view = setup.store.load(setup.sessionId);
      out(
        view.systemPrompt
          ? `Memory files: ${view.systemPrompt.length} bytes embedded in the system prompt.`
          : "No system prompt snapshot.",
      );
      return { handled: true };
    }
    case "status":
      out(
        `session: ${setup.sessionId}\nprovider: ${setup.providerId}\nmodel: ${setup.model}\neffort: ${agent.effort ?? "default"}\nmode: ${setup.permissionMode}\ncwd: ${setup.store.cwd}`,
      );
      return { handled: true };
    case "exit":
    case "quit":
      return { handled: true, exit: true };
    default: {
      const custom = findCommand(setup.commands, name);
      if (custom) {
        const prompt = renderCommand(custom, args);
        if (prompt.trim().length > 0) {
          out(`Running command /${custom.name}`);
          await agent.runTurn(prompt, ctx.signal);
        }
        return { handled: true };
      }
      out(`Unknown command: /${name}. Run /help.`);
      return { handled: true };
    }
  }
}
