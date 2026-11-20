import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { atomicWrite, ensureDir } from "../util/fsx.js";
import { KeycodeError } from "../util/errors.js";

export interface WorkflowStepContext {
  context: Record<string, unknown>;
  results: Record<string, unknown>;
  charge(usd: number): void;
}

export interface WorkflowStep {
  id: string;
  run: (ctx: WorkflowStepContext) => Promise<unknown>;
  parallel?: WorkflowStep[] | undefined;
}

export interface WorkflowDefinition {
  name: string;
  steps: WorkflowStep[];
}

export interface WorkflowOptions {
  scriptPath: string;
  checkpointDir: string;
  context?: Record<string, unknown> | undefined;
  budgetUsd?: number | undefined;
}

export interface WorkflowResult {
  status: "completed" | "failed";
  completed: string[];
  failedStep?: string | undefined;
  error?: string | undefined;
  spentUsd: number;
}

interface Checkpoint {
  completed: string[];
  results: Record<string, unknown>;
}

export async function runWorkflow(options: WorkflowOptions): Promise<WorkflowResult> {
  const module = (await import(pathToFileURL(options.scriptPath).href)) as {
    default?: WorkflowDefinition;
  };
  const definition = module.default;
  if (!definition || !Array.isArray(definition.steps)) {
    throw new KeycodeError("CONFIG_INVALID", `Workflow ${options.scriptPath} has no default definition`);
  }
  ensureDir(options.checkpointDir);
  const checkpointPath = join(options.checkpointDir, `${definition.name}.json`);
  let completed: string[] = [];
  let results: Record<string, unknown> = {};
  if (existsSync(checkpointPath)) {
    try {
      const saved = JSON.parse(readFileSync(checkpointPath, "utf8")) as Checkpoint;
      completed = saved.completed ?? [];
      results = saved.results ?? {};
    } catch {
      completed = [];
      results = {};
    }
  }

  let spentUsd = 0;
  let current: string | null = null;
  const save = (): void => {
    atomicWrite(checkpointPath, `${JSON.stringify({ completed, results }, null, 2)}\n`);
  };
  const charge = (usd: number): void => {
    spentUsd += usd;
    if (options.budgetUsd !== undefined && spentUsd > options.budgetUsd) {
      throw new KeycodeError("BUDGET_EXCEEDED", `Workflow budget exceeded: $${spentUsd.toFixed(4)}`);
    }
  };
  const runStep = async (step: WorkflowStep): Promise<void> => {
    if (completed.includes(step.id)) return;
    current = step.id;
    const result = await step.run({ context: options.context ?? {}, results, charge });
    results[step.id] = result;
    completed.push(step.id);
    save();
    if (step.parallel) await Promise.all(step.parallel.map((child) => runStep(child)));
  };

  try {
    for (const step of definition.steps) await runStep(step);
    return { status: "completed", completed, spentUsd };
  } catch (error) {
    save();
    return {
      status: "failed",
      completed,
      ...(current === null ? {} : { failedStep: current }),
      error: error instanceof Error ? error.message : String(error),
      spentUsd,
    };
  }
}
