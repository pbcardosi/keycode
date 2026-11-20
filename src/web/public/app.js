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

let socket = null;
let token = "";
let busy = false;
let intentionalClose = false;
let reconnectTimer = null;
let failures = 0;
let currentAssistant = null;
let usage = { input: 0, output: 0 };
const tools = new Map();

function setStatus(text, state) {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

function scrollIfNearBottom() {
  const distance = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
  if (distance < 90) transcript.scrollTop = transcript.scrollHeight;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function hideEmpty() {
  if (empty && empty.parentElement) empty.remove();
}

function addMessage(role, text) {
  hideEmpty();
  const wrap = element("div", `message ${role}`);
  wrap.appendChild(element("div", "who", role === "user" ? "you" : "keycode"));
  const body = element("div", "body");
  body.textContent = text;
  wrap.appendChild(body);
  transcript.appendChild(wrap);
  scrollIfNearBottom();
  return body;
}

function ensureAssistant() {
  if (currentAssistant === null) currentAssistant = addMessage("assistant", "");
  return currentAssistant;
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
  const row = element("div", "tool");
  row.dataset.status = "pending";
  row.appendChild(element("span", "icon", "⚙"));
  row.appendChild(element("span", "name", event.name));
  const detail = toolDetail(event.input);
  if (detail) row.appendChild(element("span", "detail", `· ${detail}`));
  row.appendChild(element("span", "outcome", "running"));
  transcript.appendChild(row);
  tools.set(event.id, row);
  scrollIfNearBottom();
}

function finishToolRow(event) {
  const row = tools.get(event.id);
  if (!row) return;
  row.dataset.status = event.ok ? "ok" : "error";
  const outcome = row.querySelector(".outcome");
  if (outcome) outcome.textContent = event.ok ? "ok" : "error";
}

function showError(message) {
  hideEmpty();
  const banner = element("div", "error-banner", message);
  transcript.appendChild(banner);
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

function startTurn() {
  busy = true;
  sendButton.disabled = true;
  stopButton.disabled = false;
  currentAssistant = null;
  setStatus("working", "busy");
}

function endTurn() {
  busy = false;
  sendButton.disabled = false;
  stopButton.disabled = true;
  currentAssistant = null;
  setStatus("ready", "ready");
  input.focus();
}

function handleEvent(event) {
  if (event === null || typeof event !== "object") return;
  switch (event.type) {
    case "text": {
      const body = ensureAssistant();
      body.textContent += event.delta ?? "";
      scrollIfNearBottom();
      break;
    }
    case "thinking": {
      hideEmpty();
      let thinking = transcript.querySelector(".thinking:last-of-type");
      if (!thinking) {
        thinking = element("div", "thinking");
        transcript.appendChild(thinking);
      }
      thinking.textContent += event.delta ?? "";
      scrollIfNearBottom();
      break;
    }
    case "tool_start":
      addToolRow(event);
      break;
    case "tool_result":
      finishToolRow(event);
      break;
    case "usage":
      usage = { input: event.inputTokens ?? 0, output: event.outputTokens ?? 0 };
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

function handleMessage(message) {
  switch (message.type) {
    case "hello":
      failures = 0;
      tokenModal.hidden = true;
      renderMeta(message.info);
      showPermission(message.permission ?? null);
      setStatus(busy ? "working" : "ready", busy ? "busy" : "ready");
      break;
    case "event":
      handleEvent(message.event);
      break;
    case "permission":
      if (message.permission) permissionModal.dataset.id = message.permission.id;
      showPermission(message.permission ?? null);
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

  socket.addEventListener("open", () => {
    setStatus("connected", "ready");
  });

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

  socket.addEventListener("error", () => {
    socket.close();
  });
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
