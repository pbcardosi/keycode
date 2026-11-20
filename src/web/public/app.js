import { renderMarkdown } from "/markdown.js";

const $ = (id) => document.getElementById(id);
const transcript = $("transcript");
const empty = $("empty");
const input = $("input");
const sendButton = $("send");
const stopButton = $("stop");
const statusEl = $("status");
const metaEl = $("meta");
const tokenModal = $("token-modal");
const tokenForm = $("token-form");
const tokenInput = $("token-input");
const permissionModal = $("permission-modal");
const permissionTool = $("permission-tool");
const permissionReason = $("permission-reason");
const permissionPreview = $("permission-preview");
const permissionDiff = $("permission-diff");
const contextBar = $("context-bar");
const contextLabel = $("context-label");
const sessionModal = $("session-modal");
const sessionList = $("session-list");
const sessionsButton = $("sessions-button");
const newSessionButton = $("new-session");
const modelModal = $("model-modal");
const modelForm = $("model-form");
const modelButton = $("model-button");
const modelProvider = $("model-provider");
const modelName = $("model-name");
const modelOptions = $("model-options");
const sessionFormModal = $("session-form-modal");
const sessionForm = $("session-form");
const sessionFormTitle = $("session-form-title");
const sessionFormInput = $("session-form-input");
const sessionFormSubmit = $("session-form-submit");

let socket = null;
let token = "";
let busy = false;
let intentionalClose = false;
let reconnectTimer = null;
let failures = 0;
let currentSessionId = "";
let currentProvider = "";
let currentModel = "";
let providers = [];
let sessions = [];
let pendingSessionAction = null;
let currentAssistant = null;
let renderTimer = null;
const tools = new Map();

function setStatus(text, state) {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

function scrollIfNearBottom() {
  const distance = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
  if (distance < 90) transcript.scrollTop = transcript.scrollHeight;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function toolIcon() {
  const wrapper = element("span", "icon");
  wrapper.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "icon-svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M8 8l-4 4 4 4M16 8l4 4-4 4");
  svg.appendChild(path);
  wrapper.appendChild(svg);
  return wrapper;
}

function hideEmpty() {
  empty.hidden = true;
}

function addMessage(role, text, markdown = false) {
  hideEmpty();
  const wrap = element("div", `message ${role}`);
  wrap.appendChild(element("div", "who", role === "user" ? "you" : "keycode"));
  const body = element("div", markdown ? "body markdown" : "body");
  if (markdown) renderMarkdown(body, text);
  else body.textContent = text;
  wrap.appendChild(body);
  transcript.appendChild(wrap);
  scrollIfNearBottom();
  return body;
}

function textOf(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block !== null && typeof block === "object" && block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

function toolDetail(input) {
  if (input === null || typeof input !== "object") return "";
  for (const key of ["command", "file_path", "path", "pattern", "url", "description"]) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) {
      return value.length > 120 ? `${value.slice(0, 117)}…` : value;
    }
  }
  return "";
}

function addToolRow(event) {
  hideEmpty();
  const key = event.id ?? `${event.name}-${tools.size}`;
  const row = element("div", "tool");
  row.dataset.status = "pending";
  row.appendChild(toolIcon());
  row.appendChild(element("span", "name", event.name ?? "tool"));
  const detail = toolDetail(event.input);
  if (detail) row.appendChild(element("span", "detail", `· ${detail}`));
  row.appendChild(element("span", "outcome", "running"));
  const output = element("pre", "tool-output");
  output.hidden = true;
  row.addEventListener("click", () => {
    if (row.classList.contains("has-output")) output.hidden = !output.hidden;
  });
  transcript.append(row, output);
  tools.set(key, { row, output });
  scrollIfNearBottom();
}

function finishToolRow(event) {
  const entry = tools.get(event.id);
  if (!entry) return;
  entry.row.dataset.status = event.ok ? "ok" : "error";
  const outcome = entry.row.querySelector(".outcome");
  if (outcome) outcome.textContent = event.ok ? "ok" : "error";
  const text = typeof event.text === "string" ? event.text : "";
  if (text.length > 0) {
    entry.output.textContent = text.length > 4_000 ? `${text.slice(0, 4_000)}\n…` : text;
    entry.row.classList.add("has-output");
  }
}

function showError(message) {
  hideEmpty();
  transcript.appendChild(element("div", "error-banner", message));
  scrollIfNearBottom();
}

function renderMeta(info) {
  if (info === null || typeof info !== "object") return;
  const parts = [];
  if (info.provider) parts.push(info.provider);
  if (info.model) parts.push(info.model);
  if (info.sessionId) parts.push(info.sessionId.slice(0, 8));
  if (info.permissionMode) parts.push(info.permissionMode);
  metaEl.textContent = parts.join(" · ");
  currentSessionId = info.sessionId ?? currentSessionId;
  currentProvider = info.provider ?? currentProvider;
  currentModel = info.model ?? currentModel;
}

function renderContext(context) {
  if (!context || typeof context.file !== "string" || context.file.length === 0) {
    contextBar.hidden = true;
    contextLabel.textContent = "";
    return;
  }
  const base = context.file.split(/[\\/]/).pop() || context.file;
  const lines =
    typeof context.startLine === "number"
      ? `:${context.startLine}-${typeof context.endLine === "number" ? context.endLine : context.startLine}`
      : "";
  contextBar.hidden = false;
  contextLabel.textContent = `${base}${lines}`;
  contextBar.title =
    context.text && context.text.length > 0
      ? `${context.file}${lines} · ${context.text.length} selected characters`
      : `${context.file} · active file`;
}

function showPermission(permission) {
  if (permission === null) {
    permissionModal.hidden = true;
    return;
  }
  permissionTool.textContent = permission.tool;
  permissionReason.textContent = permission.reason;
  permissionModal.dataset.id = permission.id;
  permissionPreview.textContent = permission.preview ?? "";
  permissionPreview.hidden = !permission.preview;
  permissionDiff.textContent = permission.diff ?? "";
  permissionDiff.hidden = !permission.diff;
  permissionModal.hidden = false;
  const first = permissionModal.querySelector("button");
  if (first) first.focus();
}

function resolvePermission(choice) {
  if (permissionModal.hidden) return;
  const id = permissionModal.dataset.id;
  permissionModal.hidden = true;
  if (!id || socket === null || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "permission", id, choice }));
}

function ensureAssistant() {
  if (currentAssistant === null) {
    currentAssistant = { body: addMessage("assistant", "", true), raw: "" };
  }
  return currentAssistant;
}

function scheduleRender() {
  if (renderTimer !== null) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    if (currentAssistant) {
      renderMarkdown(currentAssistant.body, currentAssistant.raw);
      scrollIfNearBottom();
    }
  }, 60);
}

function flushAssistant() {
  if (renderTimer !== null) {
    clearTimeout(renderTimer);
    renderTimer = null;
  }
  if (currentAssistant) renderMarkdown(currentAssistant.body, currentAssistant.raw);
}

function startTurn() {
  busy = true;
  sendButton.disabled = true;
  stopButton.disabled = false;
  currentAssistant = null;
  setStatus("working", "busy");
}

function endTurn() {
  flushAssistant();
  busy = false;
  sendButton.disabled = false;
  stopButton.disabled = true;
  currentAssistant = null;
  setStatus("ready", "ready");
  input.focus();
}

function resetTranscript() {
  if (renderTimer !== null) clearTimeout(renderTimer);
  renderTimer = null;
  currentAssistant = null;
  tools.clear();
  transcript.textContent = "";
  transcript.appendChild(empty);
  empty.hidden = false;
}

function renderHistory(messages) {
  resetTranscript();
  if (!Array.isArray(messages) || messages.length === 0) return;
  for (const message of messages) {
    if (message === null || typeof message !== "object" || !Array.isArray(message.content)) continue;
    if (message.role === "user") {
      const text = textOf(message.content);
      if (text.trim().length > 0) addMessage("user", text);
      for (const block of message.content) {
        if (block?.type === "tool_result") {
          finishToolRow({
            id: block.toolCallId,
            ok: block.ok === true,
            text: textOf(block.content),
          });
        }
      }
    } else if (message.role === "assistant") {
      const text = textOf(message.content);
      if (text.trim().length > 0) addMessage("assistant", text, true);
      for (const block of message.content) {
        if (block?.type === "tool_call") addToolRow(block);
      }
    }
  }
}

function handleEvent(event) {
  if (event === null || typeof event !== "object") return;
  switch (event.type) {
    case "text": {
      const assistant = ensureAssistant();
      assistant.raw += event.delta ?? "";
      scheduleRender();
      break;
    }
    case "thinking":
      break;
    case "tool_start":
      addToolRow(event);
      break;
    case "tool_result":
      finishToolRow(event);
      break;
    case "done":
      if (event.stopReason === "aborted") showError("Stopped.");
      break;
    case "error": {
      const error = event.error;
      const message =
        error !== null && typeof error === "object" && typeof error.userMessage === "string"
          ? error.userMessage
          : "The turn failed.";
      showError(message);
      break;
    }
    default:
      break;
  }
}

function send(message) {
  if (socket !== null && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function renderSessionList() {
  sessionList.textContent = "";
  if (sessions.length === 0) {
    sessionList.appendChild(element("p", "", "No sessions in this directory yet."));
    return;
  }
  for (const session of sessions) {
    const row = element("div", "session-item");
    if (session.id === currentSessionId) row.classList.add("active");

    const open = element("button", "session-open");
    open.type = "button";
    open.appendChild(element("span", "name", session.name || session.id.slice(0, 8)));
    const when = new Date(session.createdAt).toLocaleString();
    open.appendChild(
      element(
        "span",
        "sub",
        `${session.provider}/${session.model} · ${session.messageCount} messages · ${when}`,
      ),
    );
    open.addEventListener("click", () => {
      sessionModal.hidden = true;
      setStatus("switching", "busy");
      send({ type: "resume", id: session.id });
    });

    const actions = element("div", "session-item-actions");
    const rename = element("button", "chip", "Rename");
    rename.type = "button";
    rename.addEventListener("click", () => openSessionForm("rename", session));
    const fork = element("button", "chip", "Fork");
    fork.type = "button";
    fork.addEventListener("click", () => openSessionForm("fork", session));
    actions.append(rename, fork);
    if (session.id !== currentSessionId) {
      const remove = element("button", "chip danger", "Delete");
      remove.type = "button";
      remove.addEventListener("click", () => {
        if (!window.confirm(`Delete session "${session.name}"? This cannot be undone.`)) return;
        send({ type: "delete", id: session.id });
      });
      actions.appendChild(remove);
    }

    row.append(open, actions);
    sessionList.appendChild(row);
  }
}

function renderModelOptions() {
  modelProvider.textContent = "";
  for (const provider of providers) {
    const option = element("option", "", provider.name);
    option.value = provider.id;
    modelProvider.appendChild(option);
  }
  if (currentProvider) modelProvider.value = currentProvider;
  const selected = providers.find((provider) => provider.id === modelProvider.value);
  renderModelNames(selected);
  modelName.value = currentModel;
}

function renderModelNames(provider) {
  modelOptions.textContent = "";
  for (const id of provider?.models ?? []) {
    const option = document.createElement("option");
    option.value = id;
    modelOptions.appendChild(option);
  }
}

function openSessionForm(action, session) {
  pendingSessionAction = { action, id: session.id };
  sessionFormTitle.textContent = action === "fork" ? "Fork session" : "Rename session";
  sessionFormSubmit.textContent = action === "fork" ? "Fork" : "Save";
  sessionFormInput.value = action === "fork" ? `${session.name} fork` : session.name;
  sessionModal.hidden = true;
  sessionFormModal.hidden = false;
  sessionFormInput.focus();
  sessionFormInput.select();
}

function handleMessage(message) {
  switch (message.type) {
    case "hello":
      failures = 0;
      tokenModal.hidden = true;
      renderMeta(message.info);
      renderHistory(message.history ?? []);
      renderContext(message.context ?? null);
      showPermission(message.permission ?? null);
      if (message.busy === true) startTurn();
      else setStatus("ready", "ready");
      break;
    case "event":
      handleEvent(message.event);
      break;
    case "permission":
      showPermission(message.permission ?? null);
      break;
    case "context":
      renderContext(message.context ?? null);
      break;
    case "sessions":
      sessions = Array.isArray(message.sessions) ? message.sessions : [];
      renderSessionList();
      break;
    case "catalog":
      providers = Array.isArray(message.providers) ? message.providers : [];
      if (!modelModal.hidden) renderModelOptions();
      break;
    case "model_changed":
      renderMeta(message.info);
      setStatus("ready", "ready");
      break;
    case "session":
      sessionModal.hidden = true;
      permissionModal.hidden = true;
      renderMeta(message.info);
      resetTranscript();
      renderHistory(message.history ?? []);
      showPermission(message.permission ?? null);
      busy = false;
      sendButton.disabled = false;
      stopButton.disabled = true;
      setStatus("ready", "ready");
      renderSessionList();
      break;
    case "turn_start":
      if (!busy) startTurn();
      break;
    case "turn_done":
      endTurn();
      break;
    case "stopped":
      endTurn();
      break;
    case "error":
      showError(message.message ?? "Something went wrong.");
      if (busy) endTurn();
      break;
    default:
      break;
  }
}

function connect() {
  if (token.length === 0) {
    tokenModal.hidden = false;
    tokenInput.focus();
    return;
  }
  intentionalClose = false;
  setStatus("connecting", "offline");
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const url = `${scheme}://${location.host}/?token=${encodeURIComponent(token)}`;
  socket = new WebSocket(url);

  socket.addEventListener("open", () => setStatus("connected", "ready"));
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    handleMessage(message);
  });
  socket.addEventListener("close", () => {
    if (intentionalClose) return;
    failures += 1;
    setStatus("offline", "error");
    if (failures >= 3) {
      tokenModal.hidden = false;
      tokenInput.value = token;
      tokenInput.focus();
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1200);
  });
  socket.addEventListener("error", () => socket.close());
}

function sendPrompt() {
  const prompt = input.value.trim();
  if (prompt.length === 0 || busy) return;
  if (socket === null || socket.readyState !== WebSocket.OPEN) {
    showError("Not connected. Reconnecting…");
    connect();
    return;
  }
  addMessage("user", prompt);
  input.value = "";
  startTurn();
  socket.send(JSON.stringify({ type: "prompt", prompt }));
}

function normalizeToken(value) {
  const trimmed = value.trim();
  const hashIndex = trimmed.indexOf("#");
  if (hashIndex !== -1) {
    const params = new URLSearchParams(trimmed.slice(hashIndex + 1));
    const fromUrl = params.get("token");
    if (fromUrl) return fromUrl;
  }
  if (trimmed.startsWith("token=")) return trimmed.slice("token=".length);
  return trimmed;
}

function submitToken() {
  const value = normalizeToken(tokenInput.value);
  if (value.length === 0) return;
  token = value;
  history.replaceState(null, "", `#token=${encodeURIComponent(value)}`);
  failures = 0;
  tokenModal.hidden = true;
  connect();
}

tokenForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitToken();
});

sendButton.addEventListener("click", sendPrompt);
stopButton.addEventListener("click", () => {
  if (socket !== null && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "stop" }));
    setStatus("stopping", "busy");
  }
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendPrompt();
  }
});

sessionsButton.addEventListener("click", () => {
  sessionModal.hidden = false;
  renderSessionList();
  if (socket !== null && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "sessions" }));
  }
});

newSessionButton.addEventListener("click", () => {
  sessionModal.hidden = true;
  setStatus("switching", "busy");
  if (socket !== null && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "new" }));
  }
});

modelButton.addEventListener("click", () => {
  modelModal.hidden = false;
  renderModelOptions();
  if (providers.length === 0) send({ type: "catalog" });
  modelName.focus();
});

modelProvider.addEventListener("change", () => {
  const provider = providers.find((entry) => entry.id === modelProvider.value);
  renderModelNames(provider);
  if (provider && provider.defaultModel) modelName.value = provider.defaultModel;
});

modelForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const provider = modelProvider.value;
  const model = modelName.value.trim();
  if (provider.length === 0 || model.length === 0) return;
  modelModal.hidden = true;
  setStatus("switching", "busy");
  send({ type: "model", provider, model });
});

$("model-cancel").addEventListener("click", () => {
  modelModal.hidden = true;
});

$("context-clear").addEventListener("click", () => {
  send({ type: "clear_context" });
});

sessionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const action = pendingSessionAction;
  if (!action) return;
  const name = sessionFormInput.value.trim();
  sessionFormModal.hidden = true;
  pendingSessionAction = null;
  if (action.action === "rename") {
    if (name.length > 0) send({ type: "rename", id: action.id, name });
    return;
  }
  setStatus("forking", "busy");
  send({ type: "fork", id: action.id, ...(name.length > 0 ? { name } : {}) });
});

$("session-form-cancel").addEventListener("click", () => {
  sessionFormModal.hidden = true;
  pendingSessionAction = null;
});

sessionFormModal.addEventListener("click", (event) => {
  if (event.target === sessionFormModal) {
    sessionFormModal.hidden = true;
    pendingSessionAction = null;
  }
});

modelModal.addEventListener("click", (event) => {
  if (event.target === modelModal) modelModal.hidden = true;
});

$("sessions-close").addEventListener("click", () => {
  sessionModal.hidden = true;
});

sessionModal.addEventListener("click", (event) => {
  if (event.target === sessionModal) sessionModal.hidden = true;
});

permissionModal.addEventListener("click", (event) => {
  const button = event.target instanceof HTMLElement ? event.target.closest("button[data-choice]") : null;
  if (button) resolvePermission(button.dataset.choice ?? "cancel");
});

document.addEventListener("keydown", (event) => {
  if (permissionModal.hidden) return;
  const choice = {
    "1": "allow_once",
    "2": "allow_always",
    "3": "allow_session",
    "4": "deny",
    "5": "cancel",
  }[event.key];
  if (choice) {
    event.preventDefault();
    resolvePermission(choice);
  }
});

window.addEventListener("beforeunload", () => {
  intentionalClose = true;
  if (socket !== null) socket.close();
});

const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
token = hash.get("token") ?? "";
if (token.length === 0) {
  tokenModal.hidden = false;
  tokenInput.focus();
} else {
  connect();
}
