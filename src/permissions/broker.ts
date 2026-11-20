import type { PermissionDecision, PermissionRequest } from "../contracts/tool.js";
import type { PermissionPrompter, PromptChoice } from "./pipeline.js";
import { newId } from "../util/ids.js";

export interface PendingPermission {
  id: string;
  request: PermissionRequest;
  decision: PermissionDecision;
  resolve: (choice: PromptChoice) => void;
}

export class PermissionBroker implements PermissionPrompter {
  private readonly pendingRequests: PendingPermission[] = [];
  private readonly listeners = new Set<() => void>();

  ask(request: PermissionRequest, decision: PermissionDecision): Promise<PromptChoice> {
    return new Promise<PromptChoice>((resolve) => {
      this.pendingRequests.push({ id: newId("perm"), request, decision, resolve });
      this.emit();
    });
  }

  get current(): PendingPermission | null {
    return this.pendingRequests[0] ?? null;
  }

  get size(): number {
    return this.pendingRequests.length;
  }

  resolveCurrent(choice: PromptChoice): boolean {
    const current = this.pendingRequests.shift();
    if (!current) return false;
    current.resolve(choice);
    this.emit();
    return true;
  }

  resolveById(id: string, choice: PromptChoice): boolean {
    const index = this.pendingRequests.findIndex((request) => request.id === id);
    if (index === -1) return false;
    const [current] = this.pendingRequests.splice(index, 1);
    current?.resolve(choice);
    this.emit();
    return true;
  }

  cancelAll(): void {
    const requests = this.pendingRequests.splice(0, this.pendingRequests.length);
    for (const request of requests) request.resolve({ behavior: "cancel" });
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
