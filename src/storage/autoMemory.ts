import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Message } from "../contracts/message.js";
import type { Provider } from "../contracts/provider.js";
import { atomicWrite, ensureDir } from "../util/fsx.js";
import { newId } from "../util/ids.js";

export interface MemoryEntry {
  id: string;
  text: string;
  createdAt: string;
}

interface MemoryFile {
  version: 1;
  paused: boolean;
  entries: MemoryEntry[];
}

export class AutoMemoryStore {
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  private read(): MemoryFile {
    if (!existsSync(this.file)) return { version: 1, paused: false, entries: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<MemoryFile>;
      return {
        version: 1,
        paused: parsed.paused === true,
        entries: parsed.entries ?? [],
      };
    } catch {
      return { version: 1, paused: false, entries: [] };
    }
  }

  private write(data: MemoryFile): void {
    ensureDir(join(this.file, ".."));
    atomicWrite(this.file, `${JSON.stringify(data, null, 2)}\n`);
  }

  get paused(): boolean {
    return this.read().paused;
  }

  list(): MemoryEntry[] {
    return this.read().entries;
  }

  add(text: string): MemoryEntry {
    const data = this.read();
    const entry: MemoryEntry = { id: newId("mem"), text: text.trim(), createdAt: new Date().toISOString() };
    data.entries.push(entry);
    this.write(data);
    return entry;
  }

  remove(id: string): boolean {
    const data = this.read();
    const next = data.entries.filter((entry) => entry.id !== id);
    if (next.length === data.entries.length) return false;
    data.entries = next;
    this.write(data);
    return true;
  }

  pause(): void {
    const data = this.read();
    data.paused = true;
    this.write(data);
  }

  resume(): void {
    const data = this.read();
    data.paused = false;
    this.write(data);
  }

  recall(query = ""): MemoryEntry[] {
    const data = this.read();
    if (data.paused) return [];
    const needle = query.toLowerCase().trim();
    if (needle.length === 0) return data.entries.slice(-20);
    const words = needle.split(/\s+/).filter((word) => word.length > 2);
    return data.entries.filter((entry) => {
      const text = entry.text.toLowerCase();
      return words.length === 0 ? text.includes(needle) : words.some((word) => text.includes(word));
    });
  }
}

export const EXTRACT_PROMPT = [
  "Extract at most one durable fact about this project that will help future sessions.",
  "Return only the fact as a single sentence, or NONE when there is nothing durable to store.",
  "Do not store secrets, credentials, or transient task details.",
].join("\n");

export async function extractMemory(
  provider: Provider,
  model: string,
  messages: Message[],
  signal: AbortSignal,
): Promise<string | null> {
  let text = "";
  for await (const event of provider.stream(
    { model, system: EXTRACT_PROMPT, messages, tools: [], temperature: 0 },
    signal,
  )) {
    if (event.type === "text") text += event.delta;
    if (event.type === "error") throw event.error;
  }
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.toUpperCase() === "NONE") return null;
  return trimmed;
}
