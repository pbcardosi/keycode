import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import type {
  CheckpointRecord,
  ContextRecord,
  MessageRecord,
  ModelChangeRecord,
  RenameRecord,
  RewindRecord,
  SessionHeader,
  SessionRecord,
  SessionView,
  SummaryRecord,
  TodosRecord,
} from "../contracts/session.js";
import { toMessage } from "../contracts/session.js";
import type { Message } from "../contracts/message.js";
import { KeycodeError } from "../util/errors.js";
import { ensureDir } from "../util/fsx.js";
import { redactDeep } from "../util/redact.js";
import { isUuid, newSessionId } from "../util/ids.js";
import { sessionsDir } from "../util/paths.js";

export interface CreateSessionOptions {
  home: string;
  cwd: string;
  provider: string;
  model: string;
  name?: string | undefined;
  id?: string | undefined;
  parentId?: string | undefined;
  createdAt?: string | undefined;
}

export interface SessionMeta {
  id: string;
  name: string;
  cwd: string;
  provider: string;
  model: string;
  createdAt: string;
  parentId: string | null;
  messageCount: number;
  file: string;
}

function parseLines(content: string): { records: SessionRecord[]; truncated: boolean } {
  const lines = content.split(/\r?\n/);
  const records: SessionRecord[] = [];
  let truncated = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || line.trim() === "") continue;
    try {
      records.push(JSON.parse(line) as SessionRecord);
    } catch {
      if (index === lines.length - 1) {
        truncated = true;
        continue;
      }
      throw new KeycodeError(
        "SESSION_CORRUPT",
        `Session file is corrupt at line ${index + 1}. Use --resume with another session or export and start fresh.`,
      );
    }
  }
  return { records, truncated };
}

export class SessionStore {
  readonly home: string;
  readonly cwd: string;
  readonly dir: string;
  private activeId: string | null = null;

  constructor(home: string, cwd: string) {
    this.home = home;
    this.cwd = cwd;
    this.dir = sessionsDir(home, cwd);
  }

  get activeSessionId(): string | null {
    return this.activeId;
  }

  private fileFor(id: string): string {
    return join(this.dir, `${id}.jsonl`);
  }

  create(options: Omit<CreateSessionOptions, "home" | "cwd">): SessionHeader {
    const id = options.id ?? newSessionId();
    if (!isUuid(id)) {
      throw new KeycodeError("CONFIG_INVALID", `--session-id must be a UUID, got "${id}"`);
    }
    if (existsSync(this.fileFor(id))) {
      throw new KeycodeError("CONFIG_INVALID", `Session ${id} already exists. Use --resume instead.`);
    }
    const header: SessionHeader = {
      type: "session",
      version: 1,
      id,
      name: options.name ?? null,
      cwd: this.cwd,
      provider: options.provider,
      model: options.model,
      createdAt: options.createdAt ?? new Date().toISOString(),
      parentId: options.parentId ?? null,
    };
    ensureDir(this.dir);
    this.appendRecord(header, id);
    this.activeId = id;
    return header;
  }

  use(id: string): SessionView {
    const view = this.load(id);
    this.activeId = id;
    return view;
  }

  appendRecord(record: SessionRecord, sessionId?: string): void {
    const recordType = (record as { type?: string }).type;
    const id =
      recordType === "session"
        ? (record as SessionHeader).id
        : (sessionId ?? this.activeId);
    if (!id) throw new KeycodeError("CONFIG_INVALID", "No active session to append to");
    ensureDir(this.dir);
    const path = this.fileFor(id);
    const line = `${JSON.stringify(record)}\n`;
    const fd = openSync(path, "a");
    try {
      writeSync(fd, line);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  appendMessage(sessionId: string, message: Message): void {
    const record: MessageRecord = {
      type: "message",
      id: message.id,
      role: message.role,
      content: redactDeep(message.content),
      timestamp: message.timestamp,
      ...(message.usage === undefined ? {} : { usage: message.usage }),
      ...(message.interrupted === undefined ? {} : { interrupted: message.interrupted }),
    };
    this.appendRecord(record, sessionId);
  }

  appendToolResult(
    sessionId: string,
    toolCallId: string,
    ok: boolean,
    content: Message["content"],
    timestamp = new Date().toISOString(),
  ): void {
    this.appendRecord(
      { type: "tool_result", toolCallId, ok, content: redactDeep(content), timestamp },
      sessionId,
    );
  }

  appendCheckpoint(sessionId: string, checkpoint: CheckpointRecord): void {
    this.appendRecord(checkpoint, sessionId);
  }

  appendSummary(sessionId: string, summary: SummaryRecord): void {
    this.appendRecord(summary, sessionId);
  }

  appendContext(sessionId: string, systemPrompt: string, hash: string): void {
    const record: ContextRecord = {
      type: "context",
      systemPrompt,
      systemPromptHash: hash,
      timestamp: new Date().toISOString(),
    };
    this.appendRecord(record, sessionId);
  }

  appendTodos(
    sessionId: string,
    todos: Array<{
      id: string;
      content: string;
      status: "pending" | "in_progress" | "completed";
      priority?: string | undefined;
    }>,
  ): void {
    const record: TodosRecord = { type: "todos", todos, timestamp: new Date().toISOString() };
    this.appendRecord(record, sessionId);
  }

  appendRewind(sessionId: string, checkpointId: string, keepMessages: number): void {
    const record: RewindRecord = {
      type: "rewind",
      checkpointId,
      keepMessages,
      timestamp: new Date().toISOString(),
    };
    this.appendRecord(record, sessionId);
  }

  rename(sessionId: string, name: string): void {
    const record: RenameRecord = { type: "rename", name, timestamp: new Date().toISOString() };
    this.appendRecord(record, sessionId);
  }

  setModel(sessionId: string, provider: string, model: string): void {
    const record: ModelChangeRecord = {
      type: "model",
      provider,
      model,
      timestamp: new Date().toISOString(),
    };
    this.appendRecord(record, sessionId);
  }

  delete(sessionId: string): void {
    this.load(sessionId);
    if (this.activeId === sessionId) this.activeId = null;
    rmSync(this.fileFor(sessionId), { force: true });
  }

  header(sessionId?: string): SessionHeader {
    const id = sessionId ?? this.activeId;
    if (!id) throw new KeycodeError("CONFIG_INVALID", "A session is required");
    return this.load(id).header;
  }

  load(sessionId: string): SessionView {
    const path = this.fileFor(sessionId);
    if (!existsSync(path)) {
      throw new KeycodeError("SESSION_CORRUPT", `Session "${sessionId}" was not found in ${this.dir}`);
    }
    const content = readFileSync(path, "utf8");
    const { records } = parseLines(content);
    const headerRecord = records[0];
    if (!headerRecord || headerRecord.type !== "session") {
      throw new KeycodeError("SESSION_CORRUPT", `Session "${sessionId}" has no valid header`);
    }
    const header = headerRecord as SessionHeader;
    let name = header.name ?? "";
    let provider = header.provider;
    let model = header.model;
    let systemPrompt: string | null = null;
    let messages: Message[] = [];
    let todos: SessionView["todos"] = [];
    const checkpoints: CheckpointRecord[] = [];
    const summaries: SummaryRecord[] = [];

    for (const record of records.slice(1)) {
      if (record.type === "message") {
        messages.push(toMessage(record as MessageRecord));
      } else if (record.type === "rename") {
        name = (record as RenameRecord).name;
      } else if (record.type === "model") {
        provider = (record as ModelChangeRecord).provider;
        model = (record as ModelChangeRecord).model;
      } else if (record.type === "checkpoint") {
        checkpoints.push(record as CheckpointRecord);
      } else if (record.type === "summary") {
        summaries.push(record as SummaryRecord);
      } else if (record.type === "context") {
        systemPrompt = (record as ContextRecord).systemPrompt;
      } else if (record.type === "rewind") {
        messages = messages.slice(0, (record as RewindRecord).keepMessages);
      } else if (record.type === "todos") {
        todos = (record as TodosRecord).todos;
      }
    }

    return {
      header: provider === header.provider && model === header.model ? header : { ...header, provider, model },
      records,
      messages,
      name: name.length > 0 ? name : header.id.slice(0, 8),
      checkpoints,
      summaries,
      systemPrompt,
      todos,
    };
  }

  list(): SessionMeta[] {
    if (!existsSync(this.dir)) return [];
    const result: SessionMeta[] = [];
    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith(".jsonl")) continue;
      const path = join(this.dir, file);
      try {
        const content = readFileSync(path, "utf8");
        const { records } = parseLines(content);
        const header = records[0] as SessionHeader | undefined;
        if (!header || header.type !== "session") continue;
        let name = header.name ?? header.id.slice(0, 8);
        let messageCount = 0;
        let provider = header.provider;
        let model = header.model;
        for (const record of records.slice(1)) {
          if (record.type === "message") messageCount += 1;
          if (record.type === "rename") name = (record as RenameRecord).name;
          if (record.type === "model") {
            provider = (record as ModelChangeRecord).provider;
            model = (record as ModelChangeRecord).model;
          }
        }
        result.push({
          id: header.id,
          name,
          cwd: header.cwd,
          provider,
          model,
          createdAt: header.createdAt,
          parentId: header.parentId,
          messageCount,
          file: path,
        });
      } catch {
        continue;
      }
    }
    return result.sort((a, b) => statSync(b.file).mtimeMs - statSync(a.file).mtimeMs);
  }

  latest(): SessionMeta | null {
    return this.list()[0] ?? null;
  }

  resolve(idOrName: string): SessionMeta {
    const list = this.list();
    const exact = list.find((session) => session.id === idOrName);
    if (exact) return exact;
    const byName = list.find((session) => session.name === idOrName);
    if (byName) return byName;
    const byPrefix = list.filter((session) => session.id.startsWith(idOrName));
    if (byPrefix.length === 1 && byPrefix[0]) return byPrefix[0];
    if (byPrefix.length > 1) {
      throw new KeycodeError("CONFIG_INVALID", `Session prefix "${idOrName}" is ambiguous`);
    }
    throw new KeycodeError("SESSION_CORRUPT", `No session matches "${idOrName}"`);
  }

  fork(sessionId: string, name?: string): SessionHeader {
    const view = this.load(sessionId);
    const header = this.create({
      provider: view.header.provider,
      model: view.header.model,
      ...(name === undefined ? {} : { name }),
      parentId: view.header.id,
    });
    for (const message of view.messages) {
      this.appendMessage(header.id, message);
    }
    if (view.systemPrompt) {
      const context = view.records.find((record): record is ContextRecord => record.type === "context");
      this.appendContext(
        header.id,
        view.systemPrompt,
        context?.systemPromptHash ?? "forked",
      );
    }
    if (view.todos.length > 0) this.appendTodos(header.id, view.todos);
    return header;
  }
}
