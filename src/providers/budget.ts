import { KeycodeError } from "../util/errors.js";

export interface Pricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

export interface BudgetState {
  maxUsd: number;
  spentUsd: number;
  requests: number;
  exhausted: boolean;
}

export class BudgetGuard {
  private readonly maxUsd: number;
  private readonly pricing: Pricing | undefined;
  private spentUsd = 0;
  private requests = 0;
  private exhausted = false;

  constructor(maxUsd: number | undefined, pricing?: Pricing | undefined) {
    this.maxUsd = maxUsd ?? Number.POSITIVE_INFINITY;
    this.pricing = pricing;
  }

  get spent(): number {
    return this.spentUsd;
  }

  get remaining(): number {
    return Math.max(0, this.maxUsd - this.spentUsd);
  }

  get isExhausted(): boolean {
    return this.exhausted || this.spentUsd >= this.maxUsd;
  }

  state(): BudgetState {
    return {
      maxUsd: this.maxUsd,
      spentUsd: this.spentUsd,
      requests: this.requests,
      exhausted: this.isExhausted,
    };
  }

  assertCanStart(): void {
    if (this.isExhausted) {
      this.exhausted = true;
      throw new KeycodeError(
        "BUDGET_EXCEEDED",
        `Budget of $${this.maxUsd.toFixed(4)} reached (spent $${this.spentUsd.toFixed(4)})`,
      );
    }
    this.requests += 1;
  }

  addUsage(inputTokens: number, outputTokens: number): number {
    if (!this.pricing) return 0;
    const cost =
      (inputTokens / 1_000_000) * this.pricing.inputPerMTok +
      (outputTokens / 1_000_000) * this.pricing.outputPerMTok;
    this.spentUsd += cost;
    if (this.spentUsd >= this.maxUsd) this.exhausted = true;
    return cost;
  }
}
