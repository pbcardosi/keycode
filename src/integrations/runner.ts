import type { Message } from "../contracts/message.js";
import type { SessionStore } from "../storage/session.js";

export interface RemoteSession {
  id: string;
  provider: string;
  model: string;
  cwd: string;
  name: string;
  messages: Message[];
}

export interface SessionRunner {
  upload(localSessionId: string, session: RemoteSession): Promise<string>;
  download(remoteId: string): Promise<RemoteSession>;
}

export function createMemoryRunner(): SessionRunner & { sessions: Map<string, RemoteSession> } {
  const sessions = new Map<string, RemoteSession>();
  let counter = 0;
  return {
    sessions,
    async upload(_localSessionId, session) {
      counter += 1;
      const id = `remote-${counter}`;
      sessions.set(id, { ...session, id });
      return id;
    },
    async download(remoteId) {
      const session = sessions.get(remoteId);
      if (!session) throw new Error(`Remote session not found: ${remoteId}`);
      return session;
    },
  };
}

export interface TeleportOptions {
  store: SessionStore;
  remote: RemoteSession;
  forkName?: string | undefined;
}

export function teleportSession(options: TeleportOptions): { sessionId: string } {
  const header = options.store.create({
    provider: options.remote.provider,
    model: options.remote.model,
    name: options.forkName ?? options.remote.name,
  });
  for (const message of options.remote.messages) {
    options.store.appendMessage(header.id, message);
  }
  return { sessionId: header.id };
}

export function createDockerRunner(options: {
  image: string;
  containerName?: string | undefined;
  exec?: ((args: string[]) => Promise<string>) | undefined;
}): SessionRunner {
  const exec =
    options.exec ??
    (async (args: string[]) => {
      const { execFile } = await import("node:child_process");
      return await new Promise<string>((resolvePromise, rejectPromise) => {
        execFile("docker", args, { encoding: "utf8", windowsHide: true }, (error, stdout) => {
          if (error) rejectPromise(error);
          else resolvePromise(stdout);
        });
      });
    });

  return {
    async upload(localSessionId, session) {
      const id = options.containerName ?? localSessionId;
      await exec(["run", "--rm", options.image, JSON.stringify(session)]);
      return id;
    },
    async download(remoteId) {
      const output = await exec(["exec", remoteId, "cat", "/session.json"]);
      return JSON.parse(output) as RemoteSession;
    },
  };
}
