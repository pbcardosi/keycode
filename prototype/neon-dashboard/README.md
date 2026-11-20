# KeyCode session overview prototype

A static shell for the neon dashboard direction. It is a layout and interaction
study, not a replacement for the shipped web UI. The activity row places the
execution field and event stream side by side; the chat panel fills the space
below it.

## Run

```bash
node prototype/serve.mjs prototype/neon-dashboard 4173
```

Open <http://127.0.0.1:4173>. Load the recorded session with
<http://127.0.0.1:4173/?trace=real>. If `trace.json` is missing or cannot be
loaded, the page falls back to the seeded sample trace.

## Real trace

`trace.json` is generated from a KeyCode session transcript:

```bash
node scripts/extract-trace.mjs path/to/session.jsonl
```

Without a path, the newest file under `~/.keycode/projects` is used. The
extractor writes the dashboard model to `prototype/neon-dashboard/trace.json`
and includes tool names, paths, statuses, durations, token counts, and
truncated chat excerpts. Tool output is read for diff counts and status but is
never written to the trace.

The committed trace is a real Ollama `gemma4:e2b` session with six tool calls,
including two failed edits.

## What is real

- By default, the event stream, activity field, session counters, and filter
  results update from one in-memory sample event list.
- `?trace=real` loads `trace.json`, generated from a real KeyCode session. The
  field, stream, session counters, context meter, and chat then use that trace.
- Pause stops both the field animation and the incoming sample events.
- The filter tabs, search field, sort control, state preview, and New session
  button work in the page.
- The activity field is drawn with Canvas 2D from the same events as the list.
  It is not a decorative background.

## What is sample data

The default events, token counts, model name, session values, and chat are
sample data for layout review. The composer is visible but disabled. Nothing is
sent to a server.

In `?trace=real` mode, the tool events and token counts come from the recorded
session. The chat excerpt is truncated, tool output is not included, and the
permissions, sandbox, and provider endpoint panels remain sample values.

## States to review

Use **Preview state** in the event stream header to switch between:

- Full: the seeded sample stream.
- Loading: skeleton rows in the shape of the event list.
- Empty: the empty session state.
- Error: the stream failure state.

`prefers-reduced-motion: reduce` starts the field paused and disables row and
skeleton animation. Resume is still available in the field header. Append
`?motion=on` to the URL to start motion even when the OS requests reduced
motion, which is useful for screenshots.

## Files

- `index.html`: shell, panels, icons, and copy.
- `styles.css`: page layout and visual system. Tokens are in `tokens.css`; base
  rules are in `base.css`.
- `app.js`: sample event model, Canvas 2D field, filters, and state preview.
- `tokens.css`: palette, type, spacing, motion, and chrome tokens.
- `base.css`: shared base rules from the Hallmark scaffold.
