import { renderMarkdown } from "/markdown.js";

const $ = (id) => document.getElementById(id);
const appEl = document.querySelector(".app");
const transcript = $("transcript");
const empty = $("empty");
const composerEl = document.querySelector(".composer");
const dashboard = $("dashboard");
const dashboardButton = $("dashboard-button");
const dashChatBody = $("dash-chat-body");
const dashEvents = $("dash-events");
const dashCanvas = $("dash-canvas");
const dashCanvasWrap = $("dash-canvas-wrap");
const dashSessionName = $("dash-session-name");
const dashSessionId = $("dash-session-id");
const dashSessionTitle = $("dash-title");
const dashSub = $("dash-sub");
const dashStatus = $("dash-status");
const dashEventCount = $("dash-event-count");
const dashAxisStart = $("dash-axis-start");
const dashAxisMid = $("dash-axis-mid");
const dashProvider = $("dash-provider");
const dashModel = $("dash-model");
const dashInput = $("dash-input");
const dashOutput = $("dash-output");
const dashCached = $("dash-cached");
const dashId = $("dash-id");
const dashMode = $("dash-mode");
const dashState = $("dash-state");
const dashChat = $("dash-chat");
const dashSessions = $("dash-sessions");
const dashNew = $("dash-new");
const dashProviders = $("dash-providers");
const dashSettings = $("dash-settings");
const dashArtifacts = $("dash-artifacts");
const dashTerminal = $("dash-terminal");
const terminalButton = $("terminal-button");
const terminalPanel = $("terminal-panel");
const terminalOutput = $("terminal-output");
const terminalForm = $("terminal-form");
const terminalInput = $("terminal-input");
const terminalRun = $("terminal-run");
const terminalStop = $("terminal-stop");
const terminalClear = $("terminal-clear");
const terminalStatus = $("terminal-status");
const settingsButton = $("settings-button");
const settingsModal = $("settings-modal");
const settingsClose = $("settings-close");
const settingsModel = $("settings-model");
const settingsManageProviders = $("settings-manage-providers");
const settingsPermission = $("settings-permission");
const settingsPermissionHint = $("settings-permission-hint");
const settingsError = $("settings-error");
const settingsChat = $("settings-chat");
const settingsDashboard = $("settings-dashboard");
const settingsMotion = $("settings-motion");
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
let dashboardOpen = false;
let dashboardUsage = null;
const toolTrace = [];
let dashCtx = null;
let dashSize = { width: 0, height: 0 };
let dashRaf = 0;
const dashReduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let dashMotionEnabled = !dashReduceMotion;
let sessions = [];
let pendingSessionAction = null;
let currentQuestion = null;
let trustState = null;
let artifacts = [];
let activeArtifactId = null;
let currentAssistant = null;
let renderTimer = null;
const tools = new Map();
let terminalEnabled = false;
let terminalRunning = false;
let terminalActiveId = "";
const terminalHistory = [];
let terminalHistoryIndex = 0;

function setStatus(text, state) {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
  updateDashStatus();
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
  if (dashboardOpen) renderDashboard();
  if (settingsModal !== null && !settingsModal.hidden) renderSettings();
}

const dashNumberFormat = new Intl.NumberFormat("en-US");
const dashTheme = getComputedStyle(document.documentElement);
const dashColors = {
  cyan: dashTheme.getPropertyValue("--color-accent-cyan").trim() || "#00ffff",
  magenta: dashTheme.getPropertyValue("--color-accent-magenta").trim() || "#ff00ff",
  lime: dashTheme.getPropertyValue("--color-accent-lime").trim() || "#ccff00",
  danger: dashTheme.getPropertyValue("--color-danger").trim() || "#ff2d6f",
  border: dashTheme.getPropertyValue("--color-border").trim() || "rgba(0, 255, 255, 0.16)",
  ink: dashTheme.getPropertyValue("--color-text-primary").trim() || "#e0e0e0",
};

function dashNumber(value) {
  return value === null || value === undefined ? "-" : dashNumberFormat.format(Math.max(0, Math.round(value)));
}

function dashTime(date) {
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function dashLane(name, input) {
  const lower = String(name).toLowerCase();
  const command = typeof input?.command === "string" ? input.command : "";
  if (lower === "read") return { key: "read", kind: "Read" };
  if (["glob", "grep", "websearch", "webfetch"].includes(lower)) {
    return { key: "search", kind: name };
  }
  if (["edit", "write", "notebookedit"].includes(lower)) {
    return { key: "edit", kind: name };
  }
  if (
    ["bash", "powershell"].includes(lower) &&
    /(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|verify)|vitest|jest|mocha|pytest|cargo\s+test|go\s+test|dotnet\s+test|mvn\s+test|gradle\s+test/i.test(
      command,
    )
  ) {
    return { key: "test", kind: "Test" };
  }
  return { key: "shell", kind: name };
}

function dashTitle(name, input) {
  const lower = String(name).toLowerCase();
  if (["read", "write", "edit", "notebookedit"].includes(lower)) {
    return String(input?.file_path ?? input?.path ?? name);
  }
  if (lower === "grep" || lower === "glob") {
    return String(input?.pattern ?? input?.path ?? input?.query ?? name);
  }
  if (lower === "bash" || lower === "powershell") {
    return String(input?.command ?? name);
  }
  if (lower === "websearch" || lower === "webfetch") {
    return String(input?.query ?? input?.url ?? name);
  }
  if (lower === "task") {
    return String(input?.description ?? input?.prompt ?? name);
  }
  return String(input?.file_path ?? input?.command ?? input?.query ?? name);
}

function dashLaneColor(lane) {
  if (lane === "edit") return dashColors.magenta;
  if (lane === "shell" || lane === "test") return dashColors.lime;
  return dashColors.cyan;
}

function dashDuration(ms) {
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1_000).toFixed(1)} s`;
  return `${Math.round(ms / 1_000)} s`;
}

function dashItemMeta(item) {
  if (item.status === "running") return "running";
  if (item.status === "error") return "failed";
  return dashDuration(item.endAt - item.startAt);
}

function recordToolStart(event) {
  if (event === null || typeof event !== "object") return;
  const lane = dashLane(event.name, event.input);
  toolTrace.push({
    id: String(event.id ?? `${event.name}-${Date.now()}`),
    name: String(event.name ?? "Tool"),
    kind: lane.kind,
    lane: lane.key,
    title: dashTitle(event.name, event.input),
    status: "running",
    at: Date.now(),
    startAt: Date.now(),
    endAt: null,
    perf: performance.now(),
    endPerf: null,
  });
  if (toolTrace.length > 80) toolTrace.shift();
  if (dashboardOpen) {
    renderDashboard();
    drawDash(performance.now());
  }
}

function recordToolResult(event) {
  if (event === null || typeof event !== "object") return;
  const item = toolTrace.find((entry) => entry.id === String(event.id));
  if (item === undefined) return;
  item.endAt = Date.now();
  item.endPerf = performance.now();
  item.status = event.ok === true ? "ok" : "error";
  if (dashboardOpen) {
    renderDashboard();
    drawDash(performance.now());
  }
}

function resetDashboardTrace() {
  toolTrace.length = 0;
  dashboardUsage = null;
  if (dashboardOpen) renderDashboard();
}

function updateDashStatus() {
  if (dashStatus === null) return;
  dashStatus.textContent = statusEl.textContent || "offline";
  dashStatus.dataset.state = statusEl.dataset.state || "offline";
  if (dashState !== null) dashState.textContent = statusEl.textContent || "offline";
  if (settingsState !== null) settingsState.textContent = statusEl.textContent || "offline";
}

function dashEventRow(item) {
  const row = element("li", "dash-event");
  row.dataset.lane = item.lane;
  row.dataset.status = item.status;
  row.append(
    element("span", "dash-event-time", dashTime(new Date(item.at))),
    element("span", "dash-kind", item.kind),
    element("span", "dash-event-title", item.title),
    element("span", "dash-event-meta", dashItemMeta(item)),
  );
  row.lastElementChild?.setAttribute("title", dashItemMeta(item));
  return row;
}

function renderDashEvents() {
  if (dashEvents === null) return;
  if (toolTrace.length === 0) {
    dashEvents.replaceChildren(element("li", "dash-event-empty", "No tool calls yet."));
  } else {
    dashEvents.replaceChildren(...[...toolTrace].reverse().map(dashEventRow));
  }
  if (dashEventCount !== null) {
    dashEventCount.textContent = `${toolTrace.length} event${toolTrace.length === 1 ? "" : "s"}`;
  }
}

function renderDashboard() {
  if (!dashboardOpen) return;
  const session = sessions.find((entry) => entry.id === currentSessionId);
  const name =
    session?.name &&
    session.name.length > 0 &&
    session.name !== session.id &&
    !session.id.startsWith(session.name)
      ? session.name
      : "Session overview";
  const shortId = currentSessionId.length > 0 ? currentSessionId.slice(0, 8) : "no session";
  if (dashSessionName !== null) dashSessionName.textContent = name;
  if (dashSessionId !== null) dashSessionId.textContent = shortId;
  if (dashSessionTitle !== null) dashSessionTitle.textContent = name;
  if (dashSub !== null) {
    dashSub.textContent = `${toolTrace.length} tool call${toolTrace.length === 1 ? "" : "s"} · ${shortId}`;
  }
  if (dashProvider !== null) dashProvider.textContent = currentProvider.length > 0 ? currentProvider : "-";
  if (dashModel !== null) dashModel.textContent = currentModel.length > 0 ? currentModel : "-";
  if (dashInput !== null) dashInput.textContent = dashNumber(dashboardUsage?.inputTokens);
  if (dashOutput !== null) dashOutput.textContent = dashNumber(dashboardUsage?.outputTokens);
  if (dashCached !== null) dashCached.textContent = dashNumber(dashboardUsage?.cachedTokens);
  if (dashId !== null) dashId.textContent = shortId;
  if (dashMode !== null) dashMode.textContent = currentPermissionMode.length > 0 ? currentPermissionMode : "-";
  updateDashStatus();
  renderDashEvents();
}

function dashLaneY(index) {
  return ((index + 0.5) * dashSize.height) / 6;
}

function dashX(item, now) {
  return dashSize.width - ((now - item.perf) / 60_000) * dashSize.width;
}

function drawDash(now) {
  if (dashCtx === null || dashSize.width === 0 || dashSize.height === 0) return;
  const width = dashSize.width;
  const height = dashSize.height;
  const laneHeight = height / 6;
  const compact = Math.min(1, laneHeight / 34);
  const scale = 0.6 + 0.4 * compact;

  dashCtx.clearRect(0, 0, width, height);

  dashCtx.save();
  dashCtx.strokeStyle = dashColors.border;
  dashCtx.globalAlpha = 0.4;
  dashCtx.lineWidth = 1;
  for (let step = 1; step < 6; step += 1) {
    const x = (step * width) / 6;
    dashCtx.beginPath();
    dashCtx.moveTo(x, 0);
    dashCtx.lineTo(x, height);
    dashCtx.stroke();
  }
  for (let lane = 1; lane < 6; lane += 1) {
    const y = (lane * height) / 6;
    dashCtx.beginPath();
    dashCtx.moveTo(0, y);
    dashCtx.lineTo(width, y);
    dashCtx.stroke();
  }
  dashCtx.restore();

  dashCtx.save();
  dashCtx.globalCompositeOperation = "lighter";
  for (let lane = 0; lane < 6; lane += 1) {
    const key = ["context", "read", "search", "edit", "shell", "test"][lane];
    const baseY = dashLaneY(lane);
    for (let strand = 0; strand < 3; strand += 1) {
      const amplitude = (3 + strand * 3 + (lane % 2) * 2) * scale;
      const phase = now / (7_000 + strand * 1_900) + lane * 0.8 + strand * 2.1;
      dashCtx.beginPath();
      for (let x = 0; x <= width; x += 8) {
        const y =
          baseY +
          Math.sin(x / 70 + phase) * amplitude +
          Math.sin(x / 210 - phase * 0.8) * amplitude * 0.4;
        if (x === 0) dashCtx.moveTo(x, y);
        else dashCtx.lineTo(x, y);
      }
      dashCtx.strokeStyle = dashLaneColor(key);
      dashCtx.globalAlpha = 0.1 + strand * 0.04;
      dashCtx.lineWidth = 1 + strand * 0.2;
      dashCtx.stroke();
    }
  }
  dashCtx.restore();

  const laneIndex = { context: 0, read: 1, search: 2, edit: 3, shell: 4, test: 5 };
  const visible = toolTrace.filter((item) => now - item.perf <= 60_000 && item.perf <= now);

  dashCtx.save();
  for (let index = 1; index < visible.length; index += 1) {
    const previous = visible[index - 1];
    const current = visible[index];
    if (previous === undefined || current === undefined) continue;
    const x1 = dashX(previous, now);
    const x2 = dashX(current, now);
    const y1 = dashLaneY(laneIndex[previous.lane] ?? 4);
    const y2 = dashLaneY(laneIndex[current.lane] ?? 4);
    if (x1 < 0 || x2 < 0) continue;
    const middle = (x1 + x2) / 2;
    dashCtx.globalAlpha = 0.18;
    dashCtx.strokeStyle = dashLaneColor(current.lane);
    dashCtx.lineWidth = 1;
    dashCtx.beginPath();
    dashCtx.moveTo(x1, y1);
    dashCtx.bezierCurveTo(middle, y1, middle, y2, x2, y2);
    dashCtx.stroke();
  }
  dashCtx.restore();

  dashCtx.save();
  for (const item of visible) {
    const x = dashX(item, now);
    if (x < -8 || x > width + 8) continue;
    const y = dashLaneY(laneIndex[item.lane] ?? 4);
    const color = item.status === "error" ? dashColors.danger : dashLaneColor(item.lane);
    const age = now - item.perf;
    const recent = age < 1_500;
    const endX = item.endPerf === null ? x : dashX({ perf: item.endPerf }, now);

    dashCtx.globalAlpha = item.status === "running" ? 0.75 : 0.45;
    dashCtx.strokeStyle = color;
    dashCtx.lineWidth = 1.2;
    dashCtx.beginPath();
    dashCtx.moveTo(x, y);
    dashCtx.lineTo(Math.max(x, endX), y);
    dashCtx.stroke();

    dashCtx.globalAlpha = 0.95;
    dashCtx.fillStyle = color;
    if (recent) {
      dashCtx.shadowColor = color;
      dashCtx.shadowBlur = 10;
    }
    dashCtx.beginPath();
    dashCtx.arc(x, y, recent ? 2.8 : 1.9, 0, Math.PI * 2);
    dashCtx.fill();
    dashCtx.shadowBlur = 0;
  }
  dashCtx.restore();

  dashCtx.save();
  dashCtx.globalAlpha = 0.55;
  dashCtx.strokeStyle = dashColors.cyan;
  dashCtx.lineWidth = 1;
  dashCtx.shadowColor = dashColors.cyan;
  dashCtx.shadowBlur = 10;
  dashCtx.beginPath();
  dashCtx.moveTo(width - 1, 0);
  dashCtx.lineTo(width - 1, height);
  dashCtx.stroke();
  dashCtx.restore();
}

function resizeDashCanvas() {
  if (dashCanvas === null || dashCtx === null || !dashboardOpen) return;
  const rect = dashCanvasWrap.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  dashSize = { width: rect.width, height: rect.height };
  dashCanvas.width = Math.round(rect.width * dpr);
  dashCanvas.height = Math.round(rect.height * dpr);
  dashCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawDash(performance.now());
}

function stopDashLoop() {
  if (dashRaf !== 0) window.cancelAnimationFrame(dashRaf);
  dashRaf = 0;
}

function startDashLoop() {
  stopDashLoop();
  if (!dashboardOpen) return;
  if (!dashMotionEnabled) {
    drawDash(performance.now());
    return;
  }
  const frame = (now) => {
    if (!dashboardOpen) return;
    drawDash(now);
    dashRaf = window.requestAnimationFrame(frame);
  };
  dashRaf = window.requestAnimationFrame(frame);
}

function setDashboard(open) {
  if (open === dashboardOpen) return;
  if (open) {
    dashboardOpen = true;
    dashboard.hidden = false;
    appEl.classList.add("dashboard-open");
    dashChatBody.append(transcript, composerEl);
    dashboardButton.textContent = "Chat";
    renderDashboard();
    resizeDashCanvas();
    startDashLoop();
    input.focus();
  } else {
    stopDashLoop();
    dashboardOpen = false;
    appEl.classList.remove("dashboard-open");
    dashboard.hidden = true;
    appEl.insertBefore(transcript, dashboard);
    appEl.insertBefore(composerEl, dashboard);
    dashboardButton.textContent = "Dashboard";
    input.focus();
  }
  if (settingsModal !== null && !settingsModal.hidden) renderSettings();
}

function initDashboard() {
  if (dashCanvas !== null) dashCtx = dashCanvas.getContext("2d");
  if (typeof ResizeObserver === "function" && dashCanvasWrap !== null) {
    new ResizeObserver(() => {
      if (dashboardOpen) resizeDashCanvas();
    }).observe(dashCanvasWrap);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopDashLoop();
    else if (dashboardOpen) startDashLoop();
  });
}

const permissionHints = {
  manual: "Ask before writes, shell commands, and network access.",
  acceptEdits: "Accept file edits; still ask for shell and network.",
  plan: "Read-only planning; edits and execution are blocked.",
  auto: "Approve safe actions automatically; ask for risky ones.",
  dontAsk: "Deny anything that would require approval.",
  bypassPermissions: "Skip permission prompts. Use only in a trusted workspace.",
};

function setTerminalStatus(text) {
  terminalStatus.textContent = text;
}

function applyTerminalRunning(value) {
  terminalRunning = value;
  terminalStop.disabled = !value;
  terminalRun.disabled = value;
  if (!value) terminalActiveId = "";
}

function terminalWrite(text) {
  // Strip ANSI control sequences; the panel renders plain UTF-8 text.
  const clean = String(text)
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  if (clean.length === 0) return;
  const nearBottom =
    terminalOutput.scrollTop + terminalOutput.clientHeight >= terminalOutput.scrollHeight - 24;
  terminalOutput.textContent += clean;
  if (terminalOutput.textContent.length > 400_000) {
    terminalOutput.textContent = terminalOutput.textContent.slice(-300_000);
  }
  if (nearBottom || terminalRunning) terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function openTerminal() {
  if (!terminalEnabled) {
    showError("The terminal is not available on this server.");
    return;
  }
  terminalPanel.hidden = false;
  terminalInput.focus();
}

function closeTerminal() {
  terminalPanel.hidden = true;
  input.focus();
}

function submitTerminal() {
  const command = terminalInput.value.trim();
  if (command.length === 0) return;
  if (socket === null || socket.readyState !== WebSocket.OPEN) {
    showError("Not connected to KeyCode.");
    return;
  }
  const id = crypto.randomUUID();
  terminalActiveId = id;
  terminalHistory.push(command);
  if (terminalHistory.length > 100) terminalHistory.shift();
  terminalHistoryIndex = terminalHistory.length;
  terminalInput.value = "";
  terminalWrite(`\n$ ${command}\n`);
  applyTerminalRunning(true);
  setTerminalStatus("waiting…");
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
  send({ type: "terminal_run", id, command });
}

terminalButton.addEventListener("click", () =>
  terminalPanel.hidden ? openTerminal() : closeTerminal(),
);
dashTerminal.addEventListener("click", openTerminal);
$("terminal-close").addEventListener("click", closeTerminal);
terminalClear.addEventListener("click", () => {
  terminalOutput.textContent = "";
  setTerminalStatus("idle");
});
terminalStop.addEventListener("click", () => {
  if (terminalActiveId.length === 0) return;  if (socket === null || socket.readyState !== WebSocket.OPEN) {
    showError("Not connected to KeyCode.");
    return;
  }
  send({ type: "terminal_cancel", id: terminalActiveId });
});
terminalForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitTerminal();
});
terminalInput.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (terminalHistoryIndex > 0) terminalHistoryIndex -= 1;
    terminalInput.value = terminalHistory[terminalHistoryIndex] ?? "";
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (terminalHistoryIndex < terminalHistory.length - 1) terminalHistoryIndex += 1;
    terminalInput.value = terminalHistory[terminalHistoryIndex] ?? "";
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeTerminal();
  }
});

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
  settingsChat.classList.toggle("is-active", !dashboardOpen);
  settingsDashboard.classList.toggle("is-active", dashboardOpen);
  settingsChat.setAttribute("aria-pressed", String(!dashboardOpen));
  settingsDashboard.setAttribute("aria-pressed", String(dashboardOpen));
  settingsMotion.checked = dashMotionEnabled;
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

dashboardButton.addEventListener("click", () => setDashboard(!dashboardOpen));
dashChat.addEventListener("click", () => setDashboard(false));
dashSessions.addEventListener("click", () => sessionsButton.click());
dashNew.addEventListener("click", () => newSessionButton.click());
dashProviders.addEventListener("click", () => providersButton.click());
dashArtifacts.addEventListener("click", () => $("artifacts-button").click());
dashSettings.addEventListener("click", openSettings);
settingsButton.addEventListener("click", openSettings);
settingsClose.addEventListener("click", closeSettings);
settingsModal.addEventListener("click", (event) => {
  if (event.target === settingsModal) closeSettings();
});
settingsManageProviders.addEventListener("click", () => {
  closeSettings();
  providersButton.click();
});
settingsChat.addEventListener("click", () => {
  closeSettings();
  setDashboard(false);
});
settingsDashboard.addEventListener("click", () => {
  closeSettings();
  setDashboard(true);
});
settingsMotion.addEventListener("change", () => {
  dashMotionEnabled = settingsMotion.checked;
  if (dashboardOpen) {
    if (dashMotionEnabled) startDashLoop();
    else {
      stopDashLoop();
      drawDash(performance.now());
    }
  }
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
  resetDashboardTrace();
  transcript.textContent = "";
  transcript.appendChild(empty);
  empty.hidden = false;
}

function recordHistoryToolCall(block, message) {
  if (block === null || typeof block !== "object" || typeof block.id !== "string") return;
  const at = typeof message.timestamp === "string" ? Date.parse(message.timestamp) : Date.now();
  const stamp = Number.isFinite(at) ? at : Date.now();
  const lane = dashLane(block.name, block.input);
  toolTrace.push({
    id: block.id,
    name: String(block.name ?? "Tool"),
    kind: lane.kind,
    lane: lane.key,
    title: dashTitle(block.name, block.input),
    status: "running",
    at: stamp,
    startAt: stamp,
    endAt: null,
    perf: performance.now() - Math.max(0, Date.now() - stamp),
    endPerf: null,
  });
  if (toolTrace.length > 80) toolTrace.shift();
}

function recordHistoryToolResult(block, message) {
  if (block === null || typeof block !== "object") return;
  const item = toolTrace.find((entry) => entry.id === block.toolCallId);
  if (item === undefined) return;
  const at = typeof message.timestamp === "string" ? Date.parse(message.timestamp) : Date.now();
  const stamp = Number.isFinite(at) ? at : Date.now();
  item.endAt = stamp;
  item.endPerf = performance.now() - Math.max(0, Date.now() - stamp);
  item.status = block.ok === true ? "ok" : "error";
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
          recordHistoryToolResult(block, message);
        }
      }
    } else if (message.role === "assistant") {
      const text = textOf(message.content);
      if (text.trim().length > 0) addMessage("assistant", text, true);
      if (message.usage !== null && typeof message.usage === "object") {
        dashboardUsage = {
          inputTokens: Number(message.usage.inputTokens) || 0,
          outputTokens: Number(message.usage.outputTokens) || 0,
          cachedTokens: Number(message.usage.cachedTokens) || 0,
        };
      }
      for (const block of message.content) {
        if (block?.type === "tool_call") {
          addToolRow(block);
          recordHistoryToolCall(block, message);
        }
      }
    }
  }
  if (dashboardOpen) {
    renderDashboard();
    drawDash(performance.now());
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
      recordToolStart(event);
      break;
    case "tool_result":
      finishToolRow(event);
      recordToolResult(event);
      break;
    case "usage":
      dashboardUsage = {
        inputTokens: Number(event.inputTokens) || 0,
        outputTokens: Number(event.outputTokens) || 0,
        cachedTokens: Number(event.cachedTokens) || 0,
      };
      if (dashboardOpen) renderDashboard();
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
      terminalEnabled = message.terminal?.enabled === true;
      terminalButton.hidden = !terminalEnabled;
      if (!terminalEnabled) terminalPanel.hidden = true;
      if (message.terminal?.running) {
        terminalActiveId = message.terminal.running.id ?? "";
        applyTerminalRunning(true);
        setTerminalStatus("running");
      } else {
        applyTerminalRunning(false);
        setTerminalStatus("idle");
      }
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
    case "terminal_start":
      terminalActiveId = typeof message.id === "string" ? message.id : terminalActiveId;
      applyTerminalRunning(true);
      setTerminalStatus(`running · ${message.shell ?? "shell"}`);
      terminalWrite(`[${message.shell ?? "shell"} · ${message.cwd ?? ""}]\n`);
      break;
    case "terminal_output":
      terminalWrite(typeof message.text === "string" ? message.text : "");
      break;
    case "terminal_exit": {
      applyTerminalRunning(false);
      const seconds =
        typeof message.durationMs === "number" ? (message.durationMs / 1000).toFixed(1) : "0.0";
      if (typeof message.denied === "string" && message.denied.length > 0) {
        setTerminalStatus("denied");
        terminalWrite(`\n[denied] ${message.denied}\n`);
      } else if (message.cancelled === true) {
        setTerminalStatus("cancelled");
        terminalWrite(`\n[cancelled · ${seconds}s]\n`);
      } else {
        const code = message.code === null || message.code === undefined ? "?" : message.code;
        setTerminalStatus(`exit ${code}`);
        terminalWrite(
          `\n[exit ${code} · ${seconds}s${message.truncated === true ? " · output truncated" : ""}]\n`,
        );
      }
      break;
    }
    case "terminal_error":
      applyTerminalRunning(false);
      setTerminalStatus("error");
      terminalWrite(`\n[error] ${message.message ?? "The command failed."}\n`);
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
    applyTerminalRunning(false);
    setTerminalStatus("disconnected");
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

initDashboard();

const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
token = hash.get("token") ?? "";
if (token.length === 0) {
  tokenModal.hidden = false;
  tokenInput.focus();
} else {
  connect();
}
