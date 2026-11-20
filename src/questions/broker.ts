import type { Question, QuestionResult } from "../contracts/tool.js";
import { newId } from "../util/ids.js";

export interface PendingQuestion {
  id: string;
  questions: Question[];
  resolve: (result: QuestionResult) => void;
}

export class QuestionBroker {
  private readonly pendingRequests: PendingQuestion[] = [];
  private readonly listeners = new Set<() => void>();

  ask(questions: Question[]): Promise<QuestionResult> {
    return new Promise<QuestionResult>((resolve) => {
      this.pendingRequests.push({ id: newId("question"), questions, resolve });
      this.emit();
    });
  }

  get current(): PendingQuestion | null {
    return this.pendingRequests[0] ?? null;
  }

  resolveById(id: string, result: QuestionResult): boolean {
    const index = this.pendingRequests.findIndex((request) => request.id === id);
    if (index === -1) return false;
    const [current] = this.pendingRequests.splice(index, 1);
    current?.resolve(result);
    this.emit();
    return true;
  }

  cancelAll(): void {
    const requests = this.pendingRequests.splice(0, this.pendingRequests.length);
    for (const request of requests) request.resolve({ answers: [], cancelled: true });
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
