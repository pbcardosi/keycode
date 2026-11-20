const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const forceMotion = new URLSearchParams(window.location.search).get("motion") === "on";
const WINDOW_MS = 60_000;
const MAX_EVENTS = 80;

const lanes = [
  { token: "--color-accent", label: "Context" },
  { token: "--color-accent", label: "Read" },
  { token: "--color-accent", label: "Search" },
  { token: "--color-magenta", label: "Edit" },
  { token: "--color-lime", label: "Shell" },
  { token: "--color-lime", label: "Test" },
];

const kindMeta = {
  Context: { lane: 0, key: "context", icon: "i-memory", category: "context" },
  Read: { lane: 1, key: "read", icon: "i-read", category: "tool", file: true },
  Search: { lane: 2, key: "search", icon: "i-search", category: "tool" },
  Edit: { lane: 3, key: "edit", icon: "i-edit", category: "tool", file: true },
  Shell: { lane: 4, key: "shell", icon: "i-shell", category: "tool" },
  Test: { lane: 5, key: "test", icon: "i-test", category: "tool" },
  Approval: { lane: 4, key: "approval", icon: "i-approval", category: "tool" },
};

const seed = [
  { kind: "Context", title: "Session context loaded", meta: "16 files, 4 rules" },
  { kind: "Read", title: "README.md", meta: "12 ms" },
  { kind: "Read", title: "src/web/public/styles.css", meta: "18 ms" },
  { kind: "Search", title: '"sandbox" in src', meta: "9 ms" },
  { kind: "Edit", title: "src/web/public/styles.css", meta: "+148 −32" },
  { kind: "Shell", title: "npm run build", meta: "2.4 s" },
  { kind: "Test", title: "T-S3 permission dialog", meta: "failed 1", status: "error" },
  { kind: "Read", title: "src/contracts/permissions.ts", meta: "14 ms" },
  { kind: "Edit", title: "src/contracts/permissions.ts", meta: "+6 −2" },
  { kind: "Test", title: "T-S3 permission dialog", meta: "passed" },
  { kind: "Approval", title: "Allow Bash(npm run verify)", meta: "allowed once" },
  { kind: "Shell", title: "npm run verify", meta: "18.2 s" },
  { kind: "Read", title: "src/web/public/index.html", meta: "11 ms" },
  { kind: "Edit", title: "src/web/public/index.html", meta: "+86 −12" },
];

const demo = [
  { kind: "Read", title: "src/tools/bash.ts", meta: "9 ms" },
  { kind: "Edit", title: "src/tools/bash.ts", meta: "+4 −1" },
  { kind: "Shell", title: "npm run typecheck", meta: "3.8 s" },
  { kind: "Test", title: "T-S5 sandbox", meta: "passed" },
  { kind: "Search", title: '"sandboxSpawn" in src', meta: "6 ms" },
  { kind: "Read", title: "src/sandbox/command.ts", meta: "13 ms" },
  { kind: "Edit", title: "src/sandbox/command.ts", meta: "+12 −4" },
  { kind: "Shell", title: "npm run build", meta: "2.2 s" },
  { kind: "Test", title: "T-O1 settings hot reload", meta: "passed" },
  { kind: "Context", title: "Compacted 2 turns", meta: "saved 3.1k" },
];

const state = {
  events: [],
  filter: "all",
  query: "",
  preview: "full",
  order: "latest",
  paused: false,
  freezeAt: null,
  raf: 0,
  timer: 0,
  demoIndex: 0,
  sequence: 0,
  sessionStart: Date.now() - 18 * 60_000,
};

const dom = {
  events: document.getElementById("events"),
  skeleton: document.getElementById("skeleton"),
  empty: document.getElementById("empty-state"),
  error: document.getElementById("error-state"),
  stream: document.getElementById("stream-body"),
  count: document.getElementById("event-count"),
  order: document.getElementById("order"),
  filter: document.getElementById("filter"),
  state: document.getElementById("state"),
  pause: document.getElementById("pause"),
  fieldState: document.getElementById("field-state"),
  sessionState: document.getElementById("session-state"),
  title: document.getElementById("session-title"),
  sub: document.getElementById("session-sub"),
  duration: document.getElementById("duration"),
  tools: document.getElementById("stat-tools"),
  files: document.getElementById("stat-files"),
  tests: document.getElementById("stat-tests"),
  approvals: document.getElementById("stat-approvals"),
  recent: document.getElementById("recent-list"),
  newSession: document.getElementById("new-session"),
  composer: document.getElementById("composer"),
  canvas: document.getElementById("field"),
  canvasWrap: document.getElementById("canvas-wrap"),
};

const css = getComputedStyle(document.documentElement);
const token = (name) => css.getPropertyValue(name).trim();
const colors = {
  accent: token("--color-accent"),
  magenta: token("--color-magenta"),
  lime: token("--color-lime"),
  error: token("--color-error"),
  rule: token("--color-rule"),
  ink: token("--color-ink"),
};
const laneColors = lanes.map((lane) => token(lane.token));

let canvasSize = { width: 0, height: 0 };
const ctx = dom.canvas ? dom.canvas.getContext("2d") : null;

function makeEvent(template, perf, wall) {
  const meta = kindMeta[template.kind];
  return {
    id: ++state.sequence,
    perf,
    wall,
    kind: template.kind,
    lane: meta.lane,
    laneKey: meta.key,
    icon: meta.icon,
    category: meta.category,
    file: meta.file === true,
    title: template.title,
    meta: template.meta,
    status: template.status ?? "ok",
    isNew: false,
  };
}

function seedEvents() {
  const now = performance.now();
  const wallNow = Date.now();
  state.events = seed.map((template, index) => {
    const offset = (seed.length - index) * 3_800;
    return makeEvent(template, now - offset, new Date(wallNow - offset));
  });
}

function formatClock(date) {
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function icon(id, className = "icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}

function matches(event) {
  if (state.filter === "tools" && event.category !== "tool") return false;
  if (state.filter === "errors" && event.status !== "error") return false;
  const query = state.query.trim().toLowerCase();
  if (query.length === 0) return true;
  return `${event.kind} ${event.title} ${event.meta}`.toLowerCase().includes(query);
}

function eventRow(event) {
  const row = document.createElement("li");
  row.className = "event";
  if (event.isNew) row.classList.add("is-new");
  row.dataset.lane = event.laneKey;
  row.dataset.status = event.status;

  const time = document.createElement("time");
  time.className = "event-time";
  time.dateTime = event.wall.toISOString();
  time.textContent = formatClock(event.wall);

  const kind = document.createElement("span");
  kind.className = "event-kind";
  kind.append(icon(event.icon), document.createTextNode(event.kind));

  const title = document.createElement("span");
  title.className = "event-title";
  title.textContent = event.title;

  const meta = document.createElement("span");
  meta.className = "event-meta";
  meta.textContent = event.meta;

  row.append(time, kind, title, meta);
  return row;
}

function setEmptyCopy(title, copy) {
  dom.empty.querySelector(".state-title").textContent = title;
  dom.empty.querySelector(".state-copy").textContent = copy;
}

function renderEvents() {
  const loading = state.preview === "loading";
  const forcedEmpty = state.preview === "empty";
  const forcedError = state.preview === "error";

  dom.skeleton.hidden = !loading;
  dom.empty.hidden = !forcedEmpty;
  dom.error.hidden = !forcedError;
  dom.events.hidden = loading || forcedEmpty || forcedError;
  dom.stream.setAttribute("aria-busy", loading ? "true" : "false");

  if (loading) {
    dom.events.replaceChildren();
    updateCount(0);
    return;
  }

  if (forcedError) {
    dom.events.replaceChildren();
    updateCount(0);
    return;
  }

  if (forcedEmpty) {
    setEmptyCopy(
      "No events in this session yet",
      "This is the empty state for the prototype. The full sample stream is one click away.",
    );
    dom.events.replaceChildren();
    updateCount(0);
    return;
  }

  const visible = state.events.filter(matches);
  if (visible.length === 0) {
    setEmptyCopy(
      "No events match this view",
      "Clear the filter or return to the full sample stream.",
    );
    dom.events.replaceChildren();
    dom.empty.hidden = false;
    updateCount(0);
    return;
  }

  const maxRows = Math.max(1, Math.floor(dom.stream.clientHeight / 34));
  const ordered = [...visible].sort((left, right) => left.perf - right.perf);
  const shown =
    state.order === "latest" ? ordered.slice(-maxRows).reverse() : ordered.slice(0, maxRows);

  dom.empty.hidden = true;
  dom.events.replaceChildren(...shown.map(eventRow));
  updateCount(shown.length);
  dom.stream.scrollTop = 0;
}

function updateCount(shown) {
  const total = state.events.length;
  dom.count.textContent = shown === total ? `${total} events` : `${shown} of ${total} events`;
}

function updateStats() {
  const tools = state.events.filter((event) => event.category === "tool");
  const files = new Set(
    state.events.filter((event) => event.file === true).map((event) => event.title),
  );
  const tests = state.events.filter((event) => event.kind === "Test");
  const failed = tests.filter((event) => event.status === "error").length;
  const passed = tests.length - failed;
  const approvals = state.events.filter((event) => event.kind === "Approval");

  dom.tools.textContent = String(tools.length);
  dom.files.textContent = String(files.size);
  dom.tests.textContent = failed > 0 ? `${passed} passed, ${failed} failed` : `${passed} passed`;
  dom.tests.classList.toggle("danger", failed > 0);
  dom.approvals.textContent = String(approvals.length);
  dom.sub.textContent = `${tools.length} tool calls, ${files.size} files changed`;
}

function updateClock() {
  const minutes = Math.max(0, Math.floor((Date.now() - state.sessionStart) / 60_000));
  dom.duration.textContent =
    minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function laneY(index) {
  return ((index + 0.5) * canvasSize.height) / lanes.length;
}

function eventColor(event) {
  if (event.status === "error") return colors.error;
  if (event.kind === "Approval") return colors.magenta;
  return laneColors[event.lane];
}

function eventX(event, now) {
  return canvasSize.width - ((now - event.perf) / WINDOW_MS) * canvasSize.width;
}

function draw(now) {
  if (ctx === null || canvasSize.width === 0 || canvasSize.height === 0) return;
  const width = canvasSize.width;
  const height = canvasSize.height;
  const compact = Math.min(1, height / lanes.length / 36);
  const scale = 0.55 + 0.45 * compact;

  ctx.clearRect(0, 0, width, height);

  // Lane bands and a time grid give the field a coordinate system.
  ctx.save();
  for (let lane = 0; lane < lanes.length; lane += 1) {
    if (lane % 2 === 0) {
      ctx.globalAlpha = 0.018;
      ctx.fillStyle = colors.ink;
      ctx.fillRect(0, (lane * height) / lanes.length, width, height / lanes.length);
    }
  }
  ctx.globalAlpha = 0.32;
  ctx.strokeStyle = colors.rule;
  ctx.lineWidth = 1;
  for (let step = 1; step < 6; step += 1) {
    const x = (step * width) / 6;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let lane = 1; lane < lanes.length; lane += 1) {
    const y = (lane * height) / lanes.length;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();

  // Ambient strands, one family per lane.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let lane = 0; lane < lanes.length; lane += 1) {
    const baseY = laneY(lane);
    for (let strand = 0; strand < 4; strand += 1) {
      const amplitude = (4 + strand * 3.2 + (lane % 2) * 2) * scale;
      const phase = now / (6_000 + strand * 1_700) + lane * 0.9 + strand * 2.2;
      ctx.beginPath();
      for (let x = 0; x <= width; x += 8) {
        const y =
          baseY +
          Math.sin(x / 70 + phase) * amplitude +
          Math.sin(x / 210 - phase * 0.8) * amplitude * 0.45;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = laneColors[lane];
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.12 + strand * 0.025;
      ctx.lineWidth = 1 + strand * 0.18;
      ctx.stroke();
      ctx.globalAlpha *= 0.28;
      ctx.lineWidth += 4;
      ctx.stroke();
    }
  }
  ctx.restore();

  const visible = state.events.filter(
    (event) => now - event.perf <= WINDOW_MS && event.perf <= now,
  );

  // Links between consecutive events make the causal shape visible.
  ctx.save();
  for (let index = 1; index < visible.length; index += 1) {
    const previous = visible[index - 1];
    const current = visible[index];
    if (previous === undefined || current === undefined) continue;
    if (current.perf - previous.perf > 12_000) continue;
    const x1 = eventX(previous, now);
    const x2 = eventX(current, now);
    const y1 = laneY(previous.lane);
    const y2 = laneY(current.lane);
    if (x1 < 0 || x2 < 0) continue;
    const middle = (x1 + x2) / 2;
    ctx.globalAlpha = index > visible.length - 4 ? 0.3 : 0.12;
    ctx.strokeStyle = eventColor(current);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(middle, y1, middle, y2, x2, y2);
    ctx.stroke();
  }
  ctx.restore();

  // Event nodes and a short pulse for the newest ones.
  ctx.save();
  for (const event of visible) {
    const x = eventX(event, now);
    if (x < -8 || x > width + 8) continue;
    const y = laneY(event.lane);
    const age = now - event.perf;
    const color = eventColor(event);
    const recent = age < 2_000;

    ctx.globalAlpha = recent ? 0.95 : 0.6;
    ctx.fillStyle = color;
    ctx.save();
    if (recent) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
    }
    ctx.beginPath();
    ctx.arc(x, y, recent ? Math.max(2, 3.2 * scale) : Math.max(1.4, 2.2 * scale), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (recent) {
      ctx.globalAlpha = Math.max(0, 1 - age / 2_000);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 4 + age / 500, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();

  // The now line.
  ctx.save();
  ctx.globalAlpha = 0.62;
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 1;
  ctx.shadowColor = colors.accent;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(width - 1, 0);
  ctx.lineTo(width - 1, height);
  ctx.stroke();
  ctx.restore();
}

function resizeCanvas() {
  if (!dom.canvas || !ctx) return;
  const rect = dom.canvasWrap.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvasSize = { width: rect.width, height: rect.height };
  dom.canvas.width = Math.round(rect.width * dpr);
  dom.canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw(state.freezeAt ?? performance.now());
}

function frame(now) {
  if (state.paused) return;
  draw(now);
  state.raf = window.requestAnimationFrame(frame);
}

function appendDemoEvent() {
  if (state.paused) return;
  const template = demo[state.demoIndex % demo.length];
  state.demoIndex += 1;
  if (!template) return;
  for (const event of state.events) event.isNew = false;
  const event = makeEvent(template, performance.now(), new Date());
  event.isNew = true;
  state.events.push(event);
  if (state.events.length > MAX_EVENTS) state.events.shift();
  renderEvents();
  updateStats();
  updateClock();
}

function startMotion() {
  stopMotion();
  state.paused = false;
  state.freezeAt = null;
  state.raf = window.requestAnimationFrame(frame);
  state.timer = window.setInterval(appendDemoEvent, 2_600);
  dom.pause.setAttribute("aria-pressed", "false");
  dom.pause.setAttribute("aria-label", "Pause sample activity");
  dom.fieldState.hidden = true;
  dom.sessionState.textContent = "Running sample";
}

function stopMotion() {
  if (state.raf !== 0) window.cancelAnimationFrame(state.raf);
  state.raf = 0;
  if (state.timer !== 0) window.clearInterval(state.timer);
  state.timer = 0;
}

function setPaused(paused) {
  if (paused) {
    state.paused = true;
    state.freezeAt = performance.now();
    stopMotion();
    draw(state.freezeAt);
    dom.pause.setAttribute("aria-pressed", "true");
    dom.pause.setAttribute("aria-label", "Resume sample activity");
    dom.fieldState.hidden = false;
    dom.sessionState.textContent = "Paused sample";
  } else {
    startMotion();
  }
}

function setPreview(value) {
  state.preview = value;
  dom.state.value = value;
  renderEvents();
  if (state.paused) draw(state.freezeAt ?? performance.now());
}

function setFilter(value) {
  state.filter = value;
  for (const button of document.querySelectorAll("[data-filter]")) {
    button.setAttribute("aria-pressed", button.dataset.filter === value ? "true" : "false");
  }
  if (state.preview !== "full") setPreview("full");
  else renderEvents();
}

function showFull() {
  state.query = "";
  dom.filter.value = "";
  state.filter = "all";
  for (const button of document.querySelectorAll("[data-filter]")) {
    button.setAttribute("aria-pressed", button.dataset.filter === "all" ? "true" : "false");
  }
  setPreview("full");
}

function resetSession() {
  state.events = [];
  state.sessionStart = Date.now();
  state.demoIndex = 0;
  state.sequence = 0;
  state.filter = "all";
  state.query = "";
  state.preview = "full";
  dom.filter.value = "";
  dom.state.value = "full";
  for (const button of document.querySelectorAll("[data-filter]")) {
    button.setAttribute("aria-pressed", button.dataset.filter === "all" ? "true" : "false");
  }
  dom.title.textContent = "New session";
  dom.sub.textContent = "0 tool calls, 0 files changed";

  for (const item of dom.recent.querySelectorAll(".recent-item")) {
    item.classList.remove("is-current");
  }
  const item = document.createElement("li");
  item.className = "recent-item is-current";
  const title = document.createElement("span");
  title.className = "recent-title";
  title.textContent = "New session";
  const meta = document.createElement("span");
  meta.className = "recent-meta";
  meta.textContent = formatClock(new Date()).slice(0, 5);
  item.append(title, meta);
  dom.recent.prepend(item);
  while (dom.recent.children.length > 4) dom.recent.lastElementChild?.remove();

  const start = makeEvent(
    { kind: "Context", title: "Session started", meta: "waiting for a prompt" },
    performance.now(),
    new Date(),
  );
  state.events.push(start);
  renderEvents();
  updateStats();
  updateClock();
  if (state.paused) draw(state.freezeAt ?? performance.now());
}

dom.pause.addEventListener("click", () => setPaused(!state.paused));

for (const button of document.querySelectorAll("[data-filter]")) {
  button.addEventListener("click", () => setFilter(button.dataset.filter ?? "all"));
}

dom.state.addEventListener("change", () => setPreview(dom.state.value));

dom.filter.addEventListener("input", () => {
  state.query = dom.filter.value;
  if (state.preview !== "full") setPreview("full");
  else renderEvents();
});

dom.filter.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    dom.filter.value = "";
    state.query = "";
    renderEvents();
    dom.filter.blur();
  }
});

dom.order.addEventListener("click", () => {
  state.order = state.order === "latest" ? "oldest" : "latest";
  dom.order.setAttribute("aria-pressed", state.order === "latest" ? "true" : "false");
  dom.order.textContent = state.order === "latest" ? "Newest first" : "Oldest first";
  renderEvents();
});

document.getElementById("show-full")?.addEventListener("click", showFull);
document.getElementById("error-full")?.addEventListener("click", showFull);
dom.newSession.addEventListener("click", resetSession);
dom.composer.addEventListener("submit", (event) => event.preventDefault());

window.addEventListener("keydown", (event) => {
  const tag = document.activeElement?.tagName;
  const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    dom.filter.focus();
    dom.filter.select();
    return;
  }
  if (event.key === "/" && !typing) {
    event.preventDefault();
    dom.filter.focus();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (state.raf !== 0) window.cancelAnimationFrame(state.raf);
    state.raf = 0;
  } else if (!state.paused) {
    state.raf = window.requestAnimationFrame(frame);
  }
});

if (dom.canvas && ctx) {
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(resizeCanvas).observe(dom.canvasWrap);
  } else {
    window.addEventListener("resize", resizeCanvas);
  }
}

let streamHeight = 0;
if (typeof ResizeObserver === "function") {
  new ResizeObserver(() => {
    const height = dom.stream.clientHeight;
    if (Math.abs(height - streamHeight) > 1) {
      streamHeight = height;
      renderEvents();
    }
  }).observe(dom.stream);
}

seedEvents();
renderEvents();
updateStats();
updateClock();
resizeCanvas();

if (reduceMotion && !forceMotion) {
  setPaused(true);
} else {
  startMotion();
}

window.setInterval(updateClock, 1_000);
