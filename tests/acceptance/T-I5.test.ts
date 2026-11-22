import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  startRemoteControl,
  type RemotePermission,
} from "../../dist/integrations/remote.js";
import { connectWebSocket } from "../helpers.js";

async function nextOfType(client: Awaited<ReturnType<typeof connectWebSocket>>, type: string) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const message = JSON.parse(await client.nextMessage()) as { type: string };
    if (message.type === type) return message;
  }
  throw new Error(`did not receive a ${type} message`);
}

async function nextSessionsWhere(
  client: Awaited<ReturnType<typeof connectWebSocket>>,
  predicate: (session: Record<string, unknown>) => boolean,
) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const message = JSON.parse(await client.nextMessage()) as {
      type: string;
      sessions?: Array<Record<string, unknown>>;
    };
    if (message.type === "sessions" && (message.sessions ?? []).some(predicate)) return message;
  }
  throw new Error("did not receive the expected session list");
}

describe("T-I5: Remote Control", () => {
  it("binds loopback, streams a reply with the pairing token, and rejects a wrong token", async () => {
    let stopped = false;
    const server = await startRemoteControl({
      token: "pair-token",
      handler: {
        onPrompt: async (prompt) => `reply: ${prompt}`,
        onStop: () => {
          stopped = true;
        },
      },
    });
    expect(server.url.startsWith("http://127.0.0.1")).toBe(true);

    const response = await fetch(`${server.url}/prompt?token=pair-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hi" }),
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"reply: hi"');
    expect(text).toContain('"type":"done"');

    const wrong = await fetch(`${server.url}/prompt?token=wrong`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hi" }),
    });
    expect(wrong.status).toBe(401);

    const stop = await fetch(`${server.url}/stop?token=pair-token`, { method: "POST" });
    expect(stop.status).toBe(200);
    expect(stopped).toBe(true);

    await server.close();
  });

  it("serves the web UI and streams agent events and approvals over WebSocket", async () => {
    let emit: (event: unknown) => void = () => undefined;
    let notifyPermission: (permission: RemotePermission | null) => void = () => undefined;
    let pending: RemotePermission | null = {
      id: "perm-1",
      tool: "Bash",
      reason: "Manual mode requires approval",
      preview: "$ echo hi",
    };
    const resolved: Array<[string, string]> = [];
    const resumed: Array<string | null> = [];
    const renamed: Array<[string, string]> = [];
    const forked: Array<[string, string | undefined]> = [];
    const deleted: string[] = [];
    const models: Array<[string, string]> = [];
    const providerKeys: Array<[string, string]> = [];
    const removedProviderKeys: string[] = [];
    const fakeProviderStatus = {
      id: "fake",
      name: "Fake",
      models: ["fake-model", "other-model"],
      defaultModel: "fake-model",
      free: true,
      local: true,
      configured: true,
      source: null,
      fingerprint: null,
      apiKeyEnv: null,
      current: true,
    };
    const baseInfo = (provider = "fake", model = "fake-model") => ({
      provider,
      model,
      sessionId: "12345678-0000-0000-0000-000000000000",
      permissionMode: "manual",
    });

    const server = await startRemoteControl({
      token: "pair-token",
      staticDir: resolve(process.cwd(), "dist/web/public"),
      handler: {
        info: () => baseInfo(),
        sessions: () => [
          {
            id: "12345678-0000-0000-0000-000000000000",
            name: "current",
            messageCount: 1,
            createdAt: "2026-11-20T00:00:00.000Z",
            provider: "fake",
            model: "fake-model",
          },
          {
            id: "aaaaaaaa-0000-0000-0000-000000000000",
            name: "older",
            messageCount: 3,
            createdAt: "2026-11-19T00:00:00.000Z",
            provider: "fake",
            model: "fake-model",
          },
        ],
        history: () => [
          {
            role: "assistant",
            content: [{ type: "text", text: "previous answer" }],
          },
        ],
        resume: (id) => {
          resumed.push(id);
          return {
            provider: "fake",
            model: "fake-model",
            sessionId: id ?? "bbbbbbbb-0000-0000-0000-000000000000",
            permissionMode: "manual",
          };
        },
        catalog: () => [
          {
            id: "fake",
            name: "Fake",
            models: ["fake-model", "other-model"],
            defaultModel: "fake-model",
            free: true,
            local: true,
          },
        ],
        providerStatuses: () => [fakeProviderStatus],
        setProviderKey: (provider, key) => {
          providerKeys.push([provider, key]);
          return [fakeProviderStatus];
        },
        removeProviderKey: (provider) => {
          removedProviderKeys.push(provider);
          return [fakeProviderStatus];
        },
        setModel: (provider, model) => {
          models.push([provider, model]);
          return baseInfo(provider, model);
        },
        renameSession: (id, name) => {
          renamed.push([id, name]);
          return [
            {
              id,
              name,
              messageCount: 1,
              createdAt: "2026-11-20T00:00:00.000Z",
              provider: "fake",
              model: "fake-model",
            },
          ];
        },
        forkSession: (id, name) => {
          forked.push([id, name]);
          return {
            provider: "fake",
            model: "fake-model",
            sessionId: "cccccccc-0000-0000-0000-000000000000",
            permissionMode: "manual",
          };
        },
        deleteSession: (id) => {
          deleted.push(id);
        },
        subscribe: (listener) => {
          emit = listener;
          return () => {
            emit = () => undefined;
          };
        },
        onPrompt: async (prompt) => {
          emit({ type: "text", delta: `reply ${prompt}` });
          emit({ type: "done", stopReason: "end_turn" });
          return `reply ${prompt}`;
        },
      },
      permissions: {
        current: () => pending,
        subscribe: (listener) => {
          notifyPermission = listener;
          return () => {
            notifyPermission = () => undefined;
          };
        },
        resolve: (id, choice) => {
          resolved.push([id, choice]);
          pending = null;
          notifyPermission(null);
          return true;
        },
      },
    });

    const page = await fetch(`${server.url}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await page.text()).toContain("KeyCode");
    const script = await fetch(`${server.url}/app.js`);
    expect(script.status).toBe(200);
    expect(await script.text()).toContain("WebSocket");
    expect((await fetch(`${server.url}/health`)).status).toBe(200);

    const port = Number(new URL(server.url).port);
    const client = await connectWebSocket(port, "/?token=pair-token");

    const hello = (await nextOfType(client, "hello")) as {
      type: string;
      info: { provider: string };
      permission: { id: string } | null;
      history: unknown[];
    };
    expect(hello.type).toBe("hello");
    expect(hello.info.provider).toBe("fake");
    expect(hello.permission?.id).toBe("perm-1");
    expect(hello.history).toHaveLength(1);

    await nextOfType(client, "providers");

    client.send(JSON.stringify({ type: "permission", id: "perm-1", choice: "allow_once" }));
    const cleared = (await nextOfType(client, "permission")) as { type: string; permission: unknown };
    expect(cleared).toEqual({ type: "permission", permission: null });
    expect(resolved).toEqual([["perm-1", "allow_once"]]);

    client.send(JSON.stringify({ type: "prompt", prompt: "hi" }));
    const start = await nextOfType(client, "turn_start");
    expect(start.type).toBe("turn_start");
    const textEvent = (await nextOfType(client, "event")) as {
      type: string;
      event: { type: string; delta: string };
    };
    expect(textEvent.type).toBe("event");
    expect(textEvent.event).toMatchObject({ type: "text", delta: "reply hi" });
    const done = (await nextOfType(client, "event")) as { type: string; event: { type: string } };
    expect(done.event.type).toBe("done");
    const turnDone = await nextOfType(client, "turn_done");
    expect(turnDone.type).toBe("turn_done");

    client.send(JSON.stringify({ type: "sessions" }));
    const list = (await nextOfType(client, "sessions")) as {
      sessions: Array<{ id: string; messageCount: number }>;
    };
    expect(list.sessions).toHaveLength(2);
    expect(list.sessions[1]).toMatchObject({ messageCount: 3 });

    client.send(JSON.stringify({ type: "resume", id: "aaaaaaaa-0000-0000-0000-000000000000" }));
    const switched = (await nextOfType(client, "session")) as {
      info: { sessionId: string };
      history: Array<{ role: string }>;
    };
    expect(switched.info.sessionId).toBe("aaaaaaaa-0000-0000-0000-000000000000");
    expect(switched.history[0]?.role).toBe("assistant");
    expect(resumed).toEqual(["aaaaaaaa-0000-0000-0000-000000000000"]);

    client.send(JSON.stringify({ type: "new" }));
    const created = (await nextOfType(client, "session")) as { info: { sessionId: string } };
    expect(created.info.sessionId).toBe("bbbbbbbb-0000-0000-0000-000000000000");
    expect(resumed).toEqual(["aaaaaaaa-0000-0000-0000-000000000000", null]);

    client.send(JSON.stringify({ type: "catalog" }));
    const catalog = (await nextOfType(client, "catalog")) as {
      providers: Array<{ id: string; models: string[] }>;
    };
    expect(catalog.providers[0]).toMatchObject({ id: "fake", models: ["fake-model", "other-model"] });

    client.send(JSON.stringify({ type: "model", provider: "fake", model: "other-model" }));
    const changed = (await nextOfType(client, "model_changed")) as {
      info: { provider: string; model: string };
    };
    expect(changed.info).toMatchObject({ provider: "fake", model: "other-model" });
    expect(models).toEqual([["fake", "other-model"]]);

    client.send(JSON.stringify({ type: "provider_key", provider: "fake", key: "secret-key" }));
    const keyed = (await nextOfType(client, "providers")) as {
      providers: Array<{ id: string; configured: boolean }>;
    };
    expect(keyed.providers[0]).toMatchObject({ id: "fake", configured: true });
    expect(providerKeys).toEqual([["fake", "secret-key"]]);

    client.send(JSON.stringify({ type: "provider_remove", provider: "fake" }));
    const unkeyed = (await nextOfType(client, "providers")) as {
      providers: Array<{ id: string }>;
    };
    expect(unkeyed.providers[0]?.id).toBe("fake");
    expect(removedProviderKeys).toEqual(["fake"]);

    client.send(JSON.stringify({ type: "rename", id: "aaaaaaaa-0000-0000-0000-000000000000", name: "renamed" }));
    await nextSessionsWhere(client, (session) => session.name === "renamed");
    expect(renamed).toEqual([["aaaaaaaa-0000-0000-0000-000000000000", "renamed"]]);

    client.send(JSON.stringify({ type: "delete", id: "aaaaaaaa-0000-0000-0000-000000000000" }));
    await nextSessionsWhere(
      client,
      (session) => session.id !== "aaaaaaaa-0000-0000-0000-000000000000",
    );
    expect(deleted).toEqual(["aaaaaaaa-0000-0000-0000-000000000000"]);

    client.send(
      JSON.stringify({ type: "fork", id: "aaaaaaaa-0000-0000-0000-000000000000", name: "copy" }),
    );
    const forkedSession = (await nextOfType(client, "session")) as { info: { sessionId: string } };
    expect(forkedSession.info.sessionId).toBe("cccccccc-0000-0000-0000-000000000000");
    expect(forked).toEqual([["aaaaaaaa-0000-0000-0000-000000000000", "copy"]]);

    await expect(connectWebSocket(port, "/?token=wrong")).rejects.toThrow();
    client.close();
    await server.close();
  });

  it("delivers AskUserQuestion questions and accepts answers", async () => {
    let pending: {
      id: string;
      questions: Array<{
        question: string;
        header: string;
        options: Array<{ label: string; description?: string }>;
      }>;
    } | null = {
      id: "question-1",
      questions: [
        {
          question: "Pick a color",
          header: "Color",
          options: [{ label: "Cyan" }, { label: "Magenta" }],
        },
      ],
    };
    let notify: (question: typeof pending) => void = () => undefined;
    const answers: unknown[] = [];

    const server = await startRemoteControl({
      token: "pair-token",
      handler: { onPrompt: async () => "ok" },
      questions: {
        current: () => pending,
        subscribe: (listener) => {
          notify = listener;
          return () => {
            notify = () => undefined;
          };
        },
        resolve: (id, result) => {
          answers.push({ id, result });
          pending = null;
          notify(null);
          return true;
        },
      },
    });

    const port = Number(new URL(server.url).port);
    const client = await connectWebSocket(port, "/?token=pair-token");
    const hello = (await nextOfType(client, "hello")) as {
      question: { id: string; questions: Array<{ header: string }> } | null;
    };
    expect(hello.question?.id).toBe("question-1");
    expect(hello.question?.questions[0]?.header).toBe("Color");

    client.send(
      JSON.stringify({
        type: "answer",
        id: "question-1",
        answers: [{ header: "Color", selected: ["Cyan"] }],
      }),
    );
    const cleared = (await nextOfType(client, "question")) as { question: unknown };
    expect(cleared.question).toBeNull();
    expect(answers).toEqual([
      {
        id: "question-1",
        result: { answers: [{ header: "Color", selected: ["Cyan"] }] },
      },
    ]);

    client.close();
    await server.close();
  });

  it("forwards editor context and prepends it to prompts", async () => {
    const prompts: string[] = [];
    const server = await startRemoteControl({
      token: "pair-token",
      handler: {
        onPrompt: async (prompt) => {
          prompts.push(prompt);
          return "ok";
        },
      },
    });

    const update = await fetch(`${server.url}/context?token=pair-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        file: "src/a.ts",
        text: "const answer = 42;",
        startLine: 4,
        endLine: 4,
      }),
    });
    expect(update.status).toBe(200);
    const updated = (await update.json()) as { context: { file: string } };
    expect(updated.context.file).toBe("src/a.ts");

    const port = Number(new URL(server.url).port);
    const client = await connectWebSocket(port, "/?token=pair-token");
    const hello = (await nextOfType(client, "hello")) as {
      context: { file: string; text: string; startLine: number } | null;
    };
    expect(hello.context).toMatchObject({
      file: "src/a.ts",
      text: "const answer = 42;",
      startLine: 4,
    });

    client.send(JSON.stringify({ type: "prompt", prompt: "explain this" }));
    await nextOfType(client, "turn_start");
    await nextOfType(client, "turn_done");
    expect(prompts[0]).toContain("# Editor context");
    expect(prompts[0]).toContain("src/a.ts");
    expect(prompts[0]).toContain("const answer = 42;");
    expect(prompts[0]?.endsWith("explain this")).toBe(true);

    const cleared = await fetch(`${server.url}/context?token=pair-token`, {
      method: "DELETE",
    });
    expect(cleared.status).toBe(200);
    client.send(JSON.stringify({ type: "prompt", prompt: "again" }));
    await nextOfType(client, "turn_start");
    await nextOfType(client, "turn_done");
    expect(prompts[1]).toBe("again");

    client.close();
    await server.close();
  });

  it("lists artifacts and returns tokenized previews", async () => {
    const stored = [
      {
        id: "artifact_1",
        name: "report",
        latestVersion: 2,
        createdAt: "2026-11-20T00:00:00.000Z",
      },
    ];
    const server = await startRemoteControl({
      token: "pair-token",
      handler: {
        onPrompt: async () => "ok",
        artifacts: () => [...stored],
        artifactPreview: (id, version) =>
          `http://127.0.0.1:9999/artifacts/${id}/${version ?? 2}?token=t`,
        createExampleArtifact: () => {
          stored.push({
            id: "artifact_2",
            name: "Example artifact",
            latestVersion: 1,
            createdAt: "2026-11-21T00:00:00.000Z",
          });
          return [...stored];
        },
        deleteArtifact: (id) => {
          const index = stored.findIndex((item) => item.id === id);
          if (index === -1) throw new Error("Artifact not found");
          stored.splice(index, 1);
          return [...stored];
        },
      },
    });

    const port = Number(new URL(server.url).port);
    const client = await connectWebSocket(port, "/?token=pair-token");
    const list = (await nextOfType(client, "artifacts")) as {
      artifacts: Array<{ id: string; latestVersion: number }>;
    };
    expect(list.artifacts[0]).toMatchObject({ id: "artifact_1", latestVersion: 2 });

    client.send(JSON.stringify({ type: "artifact_preview", id: "artifact_1", version: 2 }));
    const preview = (await nextOfType(client, "artifact_preview")) as {
      id: string;
      url: string;
    };
    expect(preview.id).toBe("artifact_1");
    expect(preview.url).toContain("token=t");

    client.send(JSON.stringify({ type: "artifact_example" }));
    const created = (await nextOfType(client, "artifacts")) as {
      artifacts: Array<{ id: string }>;
      example?: boolean;
    };
    expect(created.example).toBe(true);
    expect(created.artifacts.map((artifact) => artifact.id)).toContain("artifact_2");

    client.send(JSON.stringify({ type: "artifact_delete", id: "artifact_2" }));
    const afterDelete = (await nextOfType(client, "artifacts")) as {
      artifacts: Array<{ id: string }>;
      example?: boolean;
    };
    expect(afterDelete.artifacts.map((artifact) => artifact.id)).not.toContain("artifact_2");
    expect(afterDelete.example).toBeUndefined();

    client.close();
    await server.close();
  });

  it("reviews project trust and applies it over WebSocket", async () => {
    let accepted: boolean | null = null;
    const state = {
      trusted: false,
      changed: false,
      fingerprint: "fingerprint-1",
      items: [
        { kind: "permissions", name: ".keycode/settings.json: allow", detail: "Bash(npm test)" },
      ],
    };
    const server = await startRemoteControl({
      token: "pair-token",
      handler: {
        onPrompt: async () => "ok",
        trust: () => state,
        setTrust: (accept) => {
          accepted = accept;
          state.trusted = accept;
          return {
            provider: "fake",
            model: "fake-model",
            sessionId: "12345678-0000-0000-0000-000000000000",
            permissionMode: "manual",
          };
        },
      },
    });

    const port = Number(new URL(server.url).port);
    const client = await connectWebSocket(port, "/?token=pair-token");
    const hello = (await nextOfType(client, "hello")) as {
      trust: { trusted: boolean; items: Array<{ detail: string }> } | null;
    };
    expect(hello.trust?.trusted).toBe(false);
    expect(hello.trust?.items[0]?.detail).toBe("Bash(npm test)");

    client.send(JSON.stringify({ type: "trust", accept: true }));
    const trust = (await nextOfType(client, "trust")) as { trust: { trusted: boolean } };
    expect(trust.trust.trusted).toBe(true);
    expect(accepted).toBe(true);

    client.close();
    await server.close();
  });
});
