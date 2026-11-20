function text(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function appendInline(parent, value) {
  const pattern =
    /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  for (const match of value.matchAll(pattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > last) parent.appendChild(document.createTextNode(value.slice(last, index)));
    const strong = /^(\*\*|__)/.test(token);
    if (token.startsWith("`")) {
      parent.appendChild(text("code", "", token.slice(1, -1)));
    } else if (strong) {
      const node = text("strong", "", token.slice(2, -2));
      parent.appendChild(node);
    } else if (token.startsWith("[")) {
      const label = /^\[([^\]]+)\]/.exec(token)?.[1] ?? token;
      const href = /\((https?:\/\/[^)\s]+)\)$/.exec(token)?.[1];
      const link = text("a", "", label);
      if (href) {
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      parent.appendChild(link);
    } else {
      parent.appendChild(text("em", "", token.slice(1, -1)));
    }
    last = index + token.length;
  }
  if (last < value.length) parent.appendChild(document.createTextNode(value.slice(last)));
}

function codeBlock(lines, language) {
  const wrapper = text("div", "code-block");
  const pre = text("pre");
  const code = text("code", language ? `language-${language}` : "", lines.join("\n"));
  pre.appendChild(code);
  const copy = text("button", "copy", "Copy");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(code.textContent ?? "");
      copied = true;
    } catch {
      // Fall back to the legacy copy path when clipboard permissions are denied.
    }
    if (!copied) {
      const area = document.createElement("textarea");
      area.value = code.textContent ?? "";
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      area.remove();
    }
    copy.textContent = copied ? "Copied" : "Copy failed";
    setTimeout(() => {
      copy.textContent = "Copy";
    }, 1400);
  });
  wrapper.append(pre, copy);
  return wrapper;
}

export function renderMarkdown(container, source) {
  container.textContent = "";
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const body = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      container.appendChild(codeBlock(body, language));
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min((heading[1] ?? "#").length, 4);
      const node = text(`h${level}`);
      appendInline(node, heading[2] ?? "");
      container.appendChild(node);
      index += 1;
      continue;
    }

    if (/^\s*([-*+])\s+/.test(line)) {
      const list = text("ul");
      while (index < lines.length && /^\s*([-*+])\s+/.test(lines[index] ?? "")) {
        const item = text("li");
        appendInline(item, (lines[index] ?? "").replace(/^\s*([-*+])\s+/, ""));
        list.appendChild(item);
        index += 1;
      }
      container.appendChild(list);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const list = text("ol");
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? "")) {
        const item = text("li");
        appendInline(item, (lines[index] ?? "").replace(/^\s*\d+\.\s+/, ""));
        list.appendChild(item);
        index += 1;
      }
      container.appendChild(list);
      continue;
    }

    if (line.startsWith("> ")) {
      const quote = text("blockquote");
      while (index < lines.length && (lines[index] ?? "").startsWith("> ")) {
        const paragraph = text("p");
        appendInline(paragraph, (lines[index] ?? "").slice(2));
        quote.appendChild(paragraph);
        index += 1;
      }
      container.appendChild(quote);
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      container.appendChild(document.createElement("hr"));
      index += 1;
      continue;
    }

    const paragraph = text("p");
    const paragraphLines = [];
    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (
        next.trim().length === 0 ||
        next.startsWith("```") ||
        /^(#{1,4})\s+/.test(next) ||
        /^\s*([-*+]|\d+\.)\s+/.test(next) ||
        next.startsWith("> ") ||
        /^\s*---+\s*$/.test(next)
      ) {
        break;
      }
      paragraphLines.push(next);
      index += 1;
    }
    appendInline(paragraph, paragraphLines.join("\n"));
    container.appendChild(paragraph);
  }
}
