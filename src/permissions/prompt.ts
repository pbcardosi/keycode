import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { PermissionDecision, PermissionRequest } from "../contracts/tool.js";
import type { PermissionPrompter, PromptChoice } from "./pipeline.js";

const CHOICES: Array<{ key: string; choice: PromptChoice }> = [
  { key: "1", choice: { behavior: "allow_once" } },
  { key: "2", choice: { behavior: "allow_always" } },
  { key: "3", choice: { behavior: "allow_session" } },
  { key: "4", choice: { behavior: "deny" } },
  { key: "5", choice: { behavior: "cancel" } },
];

export function createReadlinePrompter(): PermissionPrompter {
  return {
    async ask(request: PermissionRequest, decision: PermissionDecision): Promise<PromptChoice> {
      const rl = createInterface({ input: stdin, output: stdout });
      try {
        stdout.write(`\nPermission required: ${request.tool}\n${decision.reason}\n`);
        if (request.diff) stdout.write(`\n${request.diff}\n`);
        if (request.preview) stdout.write(`\n${request.preview}\n`);
        stdout.write(
          "\n[1] allow once  [2] allow always  [3] allow for session  [4] deny  [5] cancel\nChoice: ",
        );
        const answer = (await rl.question("")).trim();
        const match = CHOICES.find((entry) => entry.key === answer);
        if (match) return match.choice;
        return { behavior: "cancel" };
      } finally {
        rl.close();
      }
    },
  };
}
