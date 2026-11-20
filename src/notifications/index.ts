export type NotificationEvent = "idle" | "permission_required" | "task_complete" | "input_needed";

export interface NotificationChannel {
  name: string;
  send(event: NotificationEvent, text: string): void | Promise<void>;
}

export interface NotifierOptions {
  channels: NotificationChannel[];
  dedupeMs?: number | undefined;
  idleThresholdMs?: number | undefined;
  now?: (() => number) | undefined;
}

export const BELL = "\x07";

export function oscNotification(text: string): string {
  return `\x1b]9;${text.replace(/\x07/g, "")}\x07`;
}

export function terminalChannel(write: (text: string) => void): NotificationChannel {
  return {
    name: "terminal",
    send: (event, text) => {
      write(event === "permission_required" ? `${BELL}${oscNotification(text)}` : `${BELL}${oscNotification(text)}`);
    },
  };
}

export function webhookChannel(url: string, fetchImpl: typeof fetch = fetch): NotificationChannel {
  return {
    name: "webhook",
    send: async (event, text) => {
      await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event, text, timestamp: new Date().toISOString() }),
      });
    },
  };
}

export class Notifier {
  private readonly options: NotifierOptions;
  private readonly lastSent = new Map<string, number>();
  private idleSince: number | null = null;

  constructor(options: NotifierOptions) {
    this.options = options;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  activity(): void {
    this.idleSince = this.now();
  }

  async notify(event: NotificationEvent, text: string): Promise<boolean> {
    const key = `${event}:${text}`;
    const now = this.now();
    const last = this.lastSent.get(key);
    const dedupeMs = this.options.dedupeMs ?? 5_000;
    if (last !== undefined && now - last < dedupeMs) return false;
    this.lastSent.set(key, now);
    for (const channel of this.options.channels) {
      await channel.send(event, text);
    }
    return true;
  }

  async checkIdle(): Promise<boolean> {
    const now = this.now();
    if (this.idleSince === null) {
      this.idleSince = now;
      return false;
    }
    if (now - this.idleSince < (this.options.idleThresholdMs ?? 30_000)) return false;
    this.idleSince = now;
    return await this.notify("idle", "KeyCode is idle");
  }
}
