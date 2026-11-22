import { renderMarkdown } from "/markdown.js";

const $ = (id) => document.getElementById(id);
const transcript = $("transcript");
const empty = $("empty");
const composerEl = document.querySelector(".composer");
const settingsButton = $("settings-button");
const settingsModal = $("settings-modal");
const settingsClose = $("settings-close");
const settingsModel = $("settings-model");
const settingsManageProviders = $("settings-manage-providers");
const settingsPermission = $("settings-permission");
const settingsPermissionHint = $("settings-permission-hint");
const settingsError = $("settings-error");
const settingsSession = $("settings-session");
const settingsState = $("settings-state");
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
const questionModal = $("question-modal");
const questionForm = $("question-form");
const questionBody = $("question-body");
const trustBar = $("trust-bar");
const trustLabel = $("trust-label");
const trustModal = $("trust-modal");
const trustItems = $("trust-items");
const artifactModal = $("artifact-modal");
const artifactList = $("artifact-list");
const artifactFrame = $("artifact-frame");
const artifactPlaceholder = $("artifact-placeholder");
const sessionModal = $("session-modal");
const sessionList = $("session-list");
const sessionsButton = $("sessions-button");
const newSessionButton = $("new-session");
const providerModal = $("provider-modal");
const providersButton = $("providers-button");
const providerList = $("provider-list");
const providerName = $("provider-name");
const providerIdLabel = $("provider-id");
const providerBadge = $("provider-badge");
const providerStatus = $("provider-status");
const providerModel = $("provider-model");
const providerModelHint = $("provider-model-hint");
const providerKey = $("provider-key");
const providerKeyHint = $("provider-key-hint");
const providerKeySave = $("provider-key-save");
const providerKeyRemove = $("provider-key-remove");
const providerError = $("provider-error");
const providerRefresh = $("provider-refresh");
const providerSwitch = $("provider-switch");
const providerAdd = $("provider-add");
const providerAddModal = $("provider-add-modal");
const providerAddForm = $("provider-add-form");
const providerAddCancel = $("provider-add-cancel");
const providerAddId = $("provider-add-id");
const providerAddName = $("provider-add-name");
const providerAddKind = $("provider-add-kind");
const providerAddUrl = $("provider-add-url");
const providerAddModels = $("provider-add-models");
const providerAddDefault = $("provider-add-default");
const providerAddEnv = $("provider-add-env");
const providerAddKey = $("provider-add-key");
const providerAddLocal = $("provider-add-local");
const providerAddFree = $("provider-add-free");
const providerAddError = $("provider-add-error");
$("provider-close").addEventListener("click", closeProviders);
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
let providerStatuses = [];
let selectedProviderId = "";
let providerKeyRequest = false;
let pendingProviderAdd = "";
let currentPermissionMode = "";
let sessions = [];
let pendingSessionAction = null;
let currentQuestion = null;
let trustState = null;
let artifacts = [];
let activeArtifactId = null;
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
  wrap.appendChild(element("div", "who", role === "user" ? "you" : "KeyCode"));
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
  currentPermissionMode = info.permissionMode ?? currentPermissionMode;
  if (settingsModal !== null && !settingsModal.hidden) renderSettings();
}

const permissionHints = {
  manual: "Ask before writes, shell commands, and network access.",
  acceptEdits: "Accept file edits; still ask for shell and network.",
  plan: "Read-only planning; edits and execution are blocked.",
  auto: "Approve safe actions automatically; ask for risky ones.",
  dontAsk: "Deny anything that would require approval.",
  bypassPermissions: "Skip permission prompts. Use only in a trusted workspace.",
};

function permissionHint(mode) {
  return permissionHints[mode] ?? permissionHints.manual;
}

function hideSettingsError() {
  settingsError.hidden = true;
  settingsError.textContent = "";
}

function showSettingsError(message) {
  settingsError.textContent = message;
  settingsError.hidden = false;
}

function renderSettings() {
  if (settingsModal === null) return;
  const model =
    currentProvider.length > 0 || currentModel.length > 0
      ? `${currentProvider || "-"} · ${currentModel || "-"}`
      : "-";
  settingsModel.textContent = model;
  const mode = currentPermissionMode.length > 0 ? currentPermissionMode : "manual";
  settingsPermission.value = mode;
  settingsPermissionHint.textContent = permissionHint(mode);
  settingsSession.textContent = currentSessionId.length > 0 ? currentSessionId.slice(0, 8) : "-";
  settingsState.textContent = statusEl.textContent || "-";
}

function openSettings() {
  settingsModal.hidden = false;
  hideSettingsError();
  renderSettings();
  settingsClose.focus();
}

function closeSettings() {
  settingsModal.hidden = true;
  hideSettingsError();
}

settingsButton.addEventListener("click", openSettings);
settingsClose.addEventListener("click", closeSettings);
settingsModal.addEventListener("click", (event) => {
  if (event.target === settingsModal) closeSettings();
});
settingsManageProviders.addEventListener("click", () => {
  closeSettings();
  providersButton.click();
});
settingsPermission.addEventListener("change", () => {
  const mode = settingsPermission.value;
  settingsPermissionHint.textContent = permissionHint(mode);
  if (socket === null || socket.readyState !== WebSocket.OPEN) {
    showSettingsError("Not connected to KeyCode.");
    renderSettings();
    return;
  }
  hideSettingsError();
  send({ type: "permission_mode", mode });
});

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

function showQuestion(question) {
  if (!question || !Array.isArray(question.questions) || question.questions.length === 0) {
    currentQuestion = null;
    questionModal.hidden = true;
    return;
  }
  currentQuestion = question;
  questionForm.dataset.id = question.id;
  questionBody.textContent = "";
  question.questions.forEach((item, index) => {
    const block = element("div", "question-item");
    block.appendChild(element("h3", "", item.header));
    block.appendChild(element("p", "", item.question));
    for (const option of item.options ?? []) {
      const label = element("label", "option");
      const input = element("input");
      input.type = item.multiple ? "checkbox" : "radio";
      input.name = `question-${index}`;
      input.value = option.label;
      label.appendChild(input);
      const text = element("span");
      text.appendChild(element("span", "option-label", option.label));
      if (option.description) {
        text.appendChild(element("span", "option-description", option.description));
      }
      label.appendChild(text);
      block.appendChild(label);
    }
    const custom = element("input", "question-custom");
    custom.type = "text";
    custom.placeholder = "Other answer…";
    block.appendChild(custom);
    questionBody.appendChild(block);
  });
  questionModal.hidden = false;
  const first = questionBody.querySelector("input");
  if (first) first.focus();
}

function submitQuestion(cancelled) {
  const id = questionForm.dataset.id;
  questionModal.hidden = true;
  currentQuestion = null;
  if (!id) return;
  if (cancelled) {
    send({ type: "answer", id, answers: [], cancelled: true });
    return;
  }
  const answers = [...questionBody.querySelectorAll(".question-item")].map((item, index) => {
    const header = item.querySelector("h3")?.textContent ?? "";
    const selected = [
      ...item.querySelectorAll(`input[name="question-${index}"]:checked`),
    ].map((input) => input.value);
    const custom = item.querySelector(".question-custom")?.value.trim() ?? "";
    return { header, selected, ...(custom.length > 0 ? { custom } : {}) };
  });
  send({ type: "answer", id, answers });
}

function applyTrust(trust) {
  trustState = trust;
  if (
    !trust ||
    trust.trusted === true ||
    !Array.isArray(trust.items) ||
    trust.items.length === 0
  ) {
    trustBar.hidden = true;
    trustModal.hidden = true;
    return;
  }
  const count = trust.items.length;
  trustLabel.textContent = trust.changed
    ? "Project configuration changed. Review before applying it."
    : `Project wants ${count} project-controlled setting${count === 1 ? "" : "s"}.`;
  trustBar.hidden = false;
}

function openTrustReview() {
  if (!trustState || !Array.isArray(trustState.items)) return;
  trustItems.textContent = "";
  for (const item of trustState.items) {
    const row = element("div", "trust-item");
    row.appendChild(element("span", "trust-kind", item.kind ?? "item"));
    row.appendChild(element("span", "trust-name", item.name ?? ""));
    row.appendChild(element("span", "trust-detail", item.detail ?? ""));
    trustItems.appendChild(row);
  }
  trustModal.hidden = false;
}

function sendTrust(accept) {
  trustModal.hidden = true;
  setStatus("switching", "busy");
  send({ type: "trust", accept });
}

function renderArtifactList() {
  artifactList.textContent = "";
  if (artifacts.length === 0) {
    artifactList.appendChild(
      element("p", "hint", "No artifacts yet. Ask KeyCode to create one."),
    );
    return;
  }
  for (const artifact of artifacts) {
    const item = element("button", "artifact-item");
    item.type = "button";
    if (artifact.id === activeArtifactId) item.classList.add("active");
    item.appendChild(element("span", "name", artifact.name || artifact.id));
    item.appendChild(
      element(
        "span",
        "sub",
        `${artifact.id} · v${artifact.latestVersion} · ${new Date(artifact.createdAt).toLocaleString()}`,
      ),
    );
    item.addEventListener("click", () => {
      activeArtifactId = artifact.id;
      renderArtifactList();
      artifactFrame.hidden = true;
      artifactFrame.src = "about:blank";
      artifactPlaceholder.hidden = false;
      artifactPlaceholder.textContent = "Loading preview…";
      send({ type: "artifact_preview", id: artifact.id });
    });
    artifactList.appendChild(item);
  }
}

function openArtifacts() {
  artifactModal.hidden = false;
  renderArtifactList();
  send({ type: "artifacts" });
}

function showArtifactPreview(message) {
  if (message.id !== activeArtifactId) return;
  if (typeof message.url === "string" && message.url.length > 0) {
    artifactFrame.src = message.url;
    artifactFrame.hidden = false;
    artifactPlaceholder.hidden = true;
  } else {
    artifactFrame.hidden = true;
    artifactPlaceholder.hidden = false;
    artifactPlaceholder.textContent = "Preview unavailable.";
  }
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

function applyBusy(value) {
  busy = value;
  sendButton.disabled = value;
  stopButton.disabled = !value;
  if (value) {
    setStatus("working", "busy");
  } else if (statusEl.dataset.state === "busy") {
    setStatus("ready", "ready");
  }
}

function startTurn() {
  applyBusy(true);
  currentAssistant = null;
}

function endTurn() {
  flushAssistant();
  applyBusy(false);
  currentAssistant = null;
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
        if (block?.type === "tool_call") {
          addToolRow(block);
        }
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

function providerFlag(label, tone = "") {
  return element("span", `provider-flag ${tone}`.trim(), label);
}

function selectedProvider() {
  return providerStatuses.find((provider) => provider.id === selectedProviderId) ?? null;
}

function providerSource(provider) {
  switch (provider.source) {
    case "env":
      return `Key from ${provider.apiKeyEnv ?? "the environment"}.`;
    case "keychain":
      return provider.fingerprint
        ? `Saved key. Fingerprint ${provider.fingerprint}.`
        : "Saved key.";
    case "config":
      return "Key from settings.";
    case "helper":
      return "Key from apiKeyHelper.";
    default:
      return provider.local === true
        ? "Local provider. No API key required."
        : "No key configured.";
  }
}

function providerFlags(provider) {
  const flags = [];
  if (provider.current) flags.push(providerFlag("Current", "current"));
  if (provider.local) flags.push(providerFlag("Local", "ok"));
  else if (provider.configured) {
    const source =
      provider.source === "env"
        ? "Env key"
        : provider.source === "keychain"
          ? "Key saved"
          : provider.source === "config"
            ? "Settings"
            : provider.source === "helper"
              ? "Helper"
              : "Ready";
    flags.push(providerFlag(source, "ok"));
  } else {
    flags.push(providerFlag("Needs key", "warn"));
  }
  return flags;
}

function updateProviderDetail() {
  const provider = selectedProvider();
  if (provider === null) {
    providerName.textContent = "No providers";
    providerIdLabel.textContent = "";
    providerBadge.className = "provider-flag";
    providerBadge.textContent = "";
    providerStatus.textContent = "Connect to a session to load providers.";
    providerModel.value = "";
    providerModel.disabled = true;
    providerKey.disabled = true;
    providerKeySave.disabled = true;
    providerKeyRemove.disabled = true;
    providerSwitch.disabled = true;
    return;
  }

  providerName.textContent = provider.name;
  providerIdLabel.textContent = provider.id;
  const badgeTone = provider.current ? "current" : provider.configured ? "ok" : "warn";
  providerBadge.className = `provider-flag ${badgeTone}`;
  providerBadge.textContent = provider.current
    ? "Current"
    : provider.local
      ? "Local"
      : provider.configured
        ? "Ready"
        : "Needs key";
  providerStatus.textContent = providerSource(provider);

  const previousModel = providerModel.value;
  const models = [
    ...new Set(
      [
        ...(provider.models ?? []),
        provider.defaultModel,
        provider.current ? currentModel : "",
      ].filter((model) => typeof model === "string" && model.length > 0),
    ),
  ];
  providerModel.textContent = "";
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    providerModel.appendChild(option);
  }
  if (models.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No models reported";
    providerModel.appendChild(option);
  }
  const desiredModel =
    providerModel.dataset.provider === provider.id && models.includes(previousModel)
      ? previousModel
      : provider.current && currentModel.length > 0
        ? currentModel
        : provider.defaultModel || models[0] || "";
  providerModel.value = models.includes(desiredModel) ? desiredModel : (models[0] ?? "");
  providerModel.dataset.provider = provider.id;
  providerModel.disabled = models.length === 0;
  providerModelHint.textContent =
    models.length === 0
      ? "No models reported. Add models in settings."
      : "Switching keeps this session and its history.";
  providerSwitch.disabled = models.length === 0;

  const local = provider.local === true;
  const locked = provider.source === "env" || provider.source === "config";
  providerKey.disabled = local || locked || providerKeyRequest;
  providerKey.value = "";
  providerKey.placeholder = local
    ? "No key required"
    : locked
      ? "Managed outside KeyCode"
      : provider.source === "keychain"
        ? "Paste a replacement key"
        : "Paste a new key";
  providerKeySave.disabled = local || locked || providerKeyRequest;
  providerKeyRemove.disabled =
    local || provider.source !== "keychain" || providerKeyRequest;

  if (local) {
    providerKeyHint.textContent = "This provider runs locally. No API key is required.";
  } else if (provider.source === "env") {
    providerKeyHint.textContent = `This key comes from ${provider.apiKeyEnv ?? "the environment"}. Change the environment variable to replace it.`;
  } else if (provider.source === "config") {
    providerKeyHint.textContent =
      "This key comes from settings. Edit the settings file to change it.";
  } else if (provider.source === "helper") {
    providerKeyHint.textContent =
      "This key comes from apiKeyHelper. A saved key takes precedence.";
  } else if (provider.source === "keychain") {
    providerKeyHint.textContent =
      "Saving a new key replaces the stored key. Keys stay on this machine.";
  } else {
    providerKeyHint.textContent = "Keys are stored locally, never in settings.";
  }
}

function selectProvider(id) {
  selectedProviderId = id;
  providerModel.dataset.provider = "";
  hideProviderError();
  renderProviderList();
  revealSelectedProvider();
  if (!providerModal.hidden) {
    providerModel.focus();
  }
}

function revealSelectedProvider() {
  const selected = providerList.querySelector('[aria-pressed="true"]');
  selected?.scrollIntoView({ block: "nearest" });
}

function renderProviderList() {
  providerList.textContent = "";
  if (providerStatuses.length === 0) {
    const note = element("p", "provider-status", "No providers reported yet.");
    providerList.appendChild(note);
    updateProviderDetail();
    return;
  }

  for (const provider of providerStatuses) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "provider-item";
    item.setAttribute("aria-pressed", provider.id === selectedProviderId ? "true" : "false");
    item.append(
      element("span", "provider-item-name", provider.name),
      element("span", "provider-item-id", provider.id),
    );
    const flags = document.createElement("span");
    flags.className = "provider-flags";
    flags.append(...providerFlags(provider));
    item.appendChild(flags);
    item.addEventListener("click", () => selectProvider(provider.id));
    providerList.appendChild(item);
  }

  if (!providerStatuses.some((provider) => provider.id === selectedProviderId)) {
    const current =
      providerStatuses.find((provider) => provider.current) ?? providerStatuses[0];
    selectedProviderId = current?.id ?? "";
    providerModel.dataset.provider = "";
  }
  updateProviderDetail();
}

function showProviderError(message) {
  providerError.textContent = message;
  providerError.hidden = false;
}

function hideProviderError() {
  providerError.hidden = true;
  providerError.textContent = "";
}

function openProviders() {
  providerModal.hidden = false;
  hideProviderError();
  providerKey.value = "";
  providerKeyRequest = false;
  if (providerStatuses.length === 0) send({ type: "providers" });
  if (selectedProviderId.length === 0) {
    const current =
      providerStatuses.find((provider) => provider.id === currentProvider) ??
      providerStatuses.find((provider) => provider.current) ??
      providerStatuses[0];
    selectedProviderId = current?.id ?? "";
    providerModel.dataset.provider = "";
  }
  renderProviderList();
  revealSelectedProvider();
  if (selectedProviderId.length > 0) {
    providerModel.focus();
  }
}

function closeProviders() {
  providerModal.hidden = true;
  providerKey.value = "";
  providerKeyRequest = false;
  hideProviderError();
}

function showProviderAddError(message) {
  providerAddError.textContent = message;
  providerAddError.hidden = false;
}

function hideProviderAddError() {
  providerAddError.hidden = true;
  providerAddError.textContent = "";
}

function openAddProvider() {
  providerModal.hidden = true;
  providerAddModal.hidden = false;
  providerAddForm.reset();
  providerAddKey.disabled = false;
  hideProviderAddError();
  providerAddId.focus();
}

function closeAddProvider(reopen = true) {
  providerAddModal.hidden = true;
  providerAddKey.value = "";
  hideProviderAddError();
  if (reopen) openProviders();
}

function submitAddProvider() {
  const id = providerAddId.value.trim().toLowerCase();
  const name = providerAddName.value.trim();
  const kind = providerAddKind.value === "anthropic" ? "anthropic" : "openai-compatible";
  const baseUrl = providerAddUrl.value.trim();
  const models = [
    ...new Set(
      providerAddModels.value
        .split(/[\n,]/)
        .map((model) => model.trim())
        .filter((model) => model.length > 0),
    ),
  ];
  const defaultModel = providerAddDefault.value.trim() || models[0] || "";
  const apiKeyEnv = providerAddEnv.value.trim();
  const key = providerAddKey.value.trim();

  if (!/^[a-z0-9][a-z0-9-_]*$/.test(id)) {
    showProviderAddError(
      "Provider ID must start with a letter or digit and use letters, digits, dashes, or underscores.",
    );
    return;
  }
  if (baseUrl.length === 0) {
    showProviderAddError("Base URL is required.");
    return;
  }
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      showProviderAddError("Base URL must use http or https.");
      return;
    }
  } catch {
    showProviderAddError("Base URL must be a valid URL.");
    return;
  }
  if (models.length === 0) {
    showProviderAddError("Add at least one model.");
    return;
  }
  if (socket === null || socket.readyState !== WebSocket.OPEN) {
    showProviderAddError("Not connected to KeyCode.");
    return;
  }

  hideProviderAddError();
  providerAddKey.value = "";
  pendingProviderAdd = id;
  providerAddModal.hidden = true;
  providerModal.hidden = false;
  providerStatus.textContent = "Adding provider...";
  hideProviderError();
  send({
    type: "provider_add",
    provider: id,
    config: {
      kind,
      displayName: name.length > 0 ? name : id,
      baseUrl,
      models,
      defaultModel,
      apiKeyEnv: apiKeyEnv.length > 0 ? apiKeyEnv : null,
      free: providerAddFree.checked,
      local: providerAddLocal.checked,
    },
    ...(key.length > 0 ? { key } : {}),
  });
}

providerAdd.addEventListener("click", openAddProvider);
providerAddCancel.addEventListener("click", () => closeAddProvider(true));
providerAddForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitAddProvider();
});
providerAddModal.addEventListener("click", (event) => {
  if (event.target === providerAddModal) closeAddProvider(true);
});
providerAddLocal.addEventListener("change", () => {
  providerAddKey.disabled = providerAddLocal.checked;
  if (providerAddLocal.checked) providerAddKey.value = "";
});

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
      showQuestion(message.question ?? null);
      applyTrust(message.trust ?? null);
      if (message.busy === true) startTurn();
      else setStatus("ready", "ready");
      break;
    case "event":
      handleEvent(message.event);
      break;
    case "permission":
      showPermission(message.permission ?? null);
      break;
    case "question":
      showQuestion(message.question ?? null);
      break;
    case "trust":
      applyTrust(message.trust ?? null);
      break;
    case "artifacts":
      artifacts = Array.isArray(message.artifacts) ? message.artifacts : [];
      renderArtifactList();
      break;
    case "artifact_preview":
      showArtifactPreview(message);
      break;
    case "busy":
      applyBusy(message.busy === true);
      break;
    case "context":
      renderContext(message.context ?? null);
      break;
    case "sessions":
      sessions = Array.isArray(message.sessions) ? message.sessions : [];
      renderSessionList();
      break;
    case "providers": {
      const next = Array.isArray(message.providers) ? message.providers : [];
      providerKeyRequest = false;
      if (next.length === 0 && providerStatuses.length > 0) break;
      providerStatuses = next;
      if (
        pendingProviderAdd.length > 0 &&
        providerStatuses.some((provider) => provider.id === pendingProviderAdd)
      ) {
        selectedProviderId = pendingProviderAdd;
        pendingProviderAdd = "";
        providerModel.dataset.provider = "";
      }
      if (!providerModal.hidden) {
        if (!providerStatuses.some((provider) => provider.id === selectedProviderId)) {
          const target =
            providerStatuses.find((provider) => provider.current) ?? providerStatuses[0];
          if (target !== undefined) {
            selectedProviderId = target.id;
            providerModel.dataset.provider = "";
          }
        }
        renderProviderList();
        revealSelectedProvider();
      }
      break;
    }
    case "model_changed":
      renderMeta(message.info);
      setStatus("ready", "ready");
      break;
    case "session":
      sessionModal.hidden = true;
      permissionModal.hidden = true;
      showQuestion(null);
      renderMeta(message.info);
      resetTranscript();
      renderHistory(message.history ?? []);
      showPermission(message.permission ?? null);
      applyBusy(false);
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
      if (!providerAddModal.hidden) {
        showProviderAddError(message.message ?? "Something went wrong.");
      }
      if (!providerModal.hidden) {
        providerKeyRequest = false;
        pendingProviderAdd = "";
        showProviderError(message.message ?? "Something went wrong.");
        updateProviderDetail();
      }
      if (!settingsModal.hidden) {
        showSettingsError(message.message ?? "Something went wrong.");
        renderSettings();
      }
      showError(message.message ?? "Something went wrong.");
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

providersButton.addEventListener("click", openProviders);

providerModal.addEventListener("click", (event) => {
  if (event.target === providerModal) closeProviders();
});

providerRefresh.addEventListener("click", () => {
  providerKeyRequest = false;
  providerStatus.textContent = "Refreshing providers...";
  send({ type: "providers" });
});

providerModel.addEventListener("change", () => {
  providerSwitch.disabled = providerModel.value.trim().length === 0;
});

providerKey.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    providerKeySave.click();
  }
});

providerKeySave.addEventListener("click", () => {
  const provider = selectedProvider();
  if (provider === null) return;
  const key = providerKey.value.trim();
  if (key.length === 0) {
    showProviderError("Enter an API key first.");
    return;
  }
  if (socket === null || socket.readyState !== WebSocket.OPEN) {
    showProviderError("Not connected to KeyCode.");
    return;
  }
  providerKey.value = "";
  providerKeyRequest = true;
  hideProviderError();
  updateProviderDetail();
  send({ type: "provider_key", provider: provider.id, key });
});

providerKeyRemove.addEventListener("click", () => {
  const provider = selectedProvider();
  if (provider === null || provider.source !== "keychain") return;
  if (socket === null || socket.readyState !== WebSocket.OPEN) {
    showProviderError("Not connected to KeyCode.");
    return;
  }
  providerKeyRequest = true;
  hideProviderError();
  updateProviderDetail();
  send({ type: "provider_remove", provider: provider.id });
});

providerSwitch.addEventListener("click", () => {
  const provider = selectedProvider();
  const model = providerModel.value.trim();
  if (provider === null || model.length === 0) return;
  if (provider.local !== true && provider.configured !== true) {
    showProviderError("Add an API key before switching to this provider.");
    return;
  }
  if (socket === null || socket.readyState !== WebSocket.OPEN) {
    showProviderError("Not connected to KeyCode.");
    return;
  }
  providerModal.hidden = true;
  setStatus("switching", "busy");
  send({ type: "model", provider: provider.id, model });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsModal.hidden) {
    event.preventDefault();
    closeSettings();
    return;
  }
  if (event.key === "Escape" && !providerAddModal.hidden) {
    event.preventDefault();
    closeAddProvider(true);
    return;
  }
  if (event.key === "Escape" && !providerModal.hidden) {
    event.preventDefault();
    closeProviders();
  }
});

$("context-clear").addEventListener("click", () => {
  send({ type: "clear_context" });
});

$("trust-review").addEventListener("click", openTrustReview);

$("artifacts-button").addEventListener("click", openArtifacts);

$("artifacts-close").addEventListener("click", () => {
  artifactModal.hidden = true;
});

$("artifacts-refresh").addEventListener("click", () => {
  renderArtifactList();
  send({ type: "artifacts" });
});

artifactModal.addEventListener("click", (event) => {
  if (event.target === artifactModal) artifactModal.hidden = true;
});

$("trust-accept").addEventListener("click", () => {
  sendTrust(true);
});

$("trust-cancel").addEventListener("click", () => {
  sendTrust(false);
});

trustModal.addEventListener("click", (event) => {
  if (event.target === trustModal) trustModal.hidden = true;
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

questionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitQuestion(false);
});

$("question-cancel").addEventListener("click", () => submitQuestion(true));

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
