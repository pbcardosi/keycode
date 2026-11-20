import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { CheckpointRecord } from "../contracts/session.js";
import type { SessionStore } from "./session.js";
import { checkpointsDir, isInside } from "../util/paths.js";
import { ensureDir } from "../util/fsx.js";
import { newId } from "../util/ids.js";

export type RewindMode = "files" | "conversation" | "both";

export class CheckpointStore {
  private readonly home: string;
  private readonly cwd: string;
  private readonly sessions: SessionStore;

  constructor(home: string, cwd: string, sessions: SessionStore) {
    this.home = home;
    this.cwd = cwd;
    this.sessions = sessions;
  }

  create(
    sessionId: string,
    turn: number,
    paths: string[],
    conversationLength: number,
  ): CheckpointRecord {
    const id = newId("ckpt");
    const root = join(checkpointsDir(this.home, this.cwd), id);
    ensureDir(root);
    const files: CheckpointRecord["files"] = [];

    for (const path of [...new Set(paths.map((item) => resolve(item)))]) {
      if (!isInside(this.cwd, path)) {
        files.push({ path, backup: null });
        continue;
      }
      if (!existsSync(path)) {
        files.push({ path, backup: null });
        continue;
      }
      const rel = relative(this.cwd, path);
      const backup = join("files", rel);
      const target = join(root, backup);
      mkdirSync(dirname(target), { recursive: true });
      try {
        copyFileSync(path, target);
        files.push({ path, backup });
      } catch {
        files.push({ path, backup: null });
      }
    }

    const record: CheckpointRecord = {
      type: "checkpoint",
      id,
      turn,
      files,
      timestamp: new Date().toISOString(),
      conversationLength,
    };
    this.sessions.appendCheckpoint(sessionId, record);
    return record;
  }

  restore(
    sessionId: string,
    checkpointId: string,
    mode: RewindMode,
  ): { files: number; messages: number } {
    const view = this.sessions.load(sessionId);
    const checkpoint = view.checkpoints.find((item) => item.id === checkpointId);
    if (!checkpoint) throw new Error(`Checkpoint ${checkpointId} was not found`);

    let files = 0;
    if (mode === "files" || mode === "both") {
      const root = join(checkpointsDir(this.home, this.cwd), checkpoint.id);
      for (const file of checkpoint.files) {
        if (file.backup === null) {
          if (existsSync(file.path)) {
            rmSync(file.path, { force: true });
            files += 1;
          }
          continue;
        }
        if (existsSync(join(root, file.backup))) {
          copyFileSync(join(root, file.backup), file.path);
          files += 1;
        }
      }
    }

    let messages = view.messages.length;
    if (mode === "conversation" || mode === "both") {
      this.sessions.appendRewind(sessionId, checkpoint.id, checkpoint.conversationLength);
      messages = checkpoint.conversationLength;
    }

    return { files, messages };
  }

  latest(sessionId: string): CheckpointRecord | null {
    const view = this.sessions.load(sessionId);
    return view.checkpoints.at(-1) ?? null;
  }
}
