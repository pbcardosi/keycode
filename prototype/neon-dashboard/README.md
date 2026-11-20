# KeyCode session overview prototype

A static shell for the neon dashboard direction. It is a layout and interaction
study, not a replacement for the shipped web UI.

## Run

```bash
node prototype/serve.mjs prototype/neon-dashboard 4173
```

Open <http://127.0.0.1:4173>.

## What is real

- The event stream, activity field, session counters, and filter results update
  from one in-memory sample event list.
- Pause stops both the field animation and the incoming sample events.
- The filter tabs, search field, autoscroll control, state preview, and New
  session button work in the page.
- The activity field is drawn with Canvas 2D from the same events as the list.
  It is not a decorative background.

## What is sample data

Every event, token count, model name, and session value is sample data for
layout review. The composer is visible but disabled. Nothing is sent to a
server.

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
