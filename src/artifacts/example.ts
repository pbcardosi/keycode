export const EXAMPLE_ARTIFACT_NAME = "Example artifact";

export const EXAMPLE_ARTIFACT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>KeyCode example artifact</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 32px;
        background:
          radial-gradient(circle at 12% -10%, rgba(0, 255, 255, 0.18), transparent 45%),
          radial-gradient(circle at 88% 2%, rgba(255, 0, 255, 0.12), transparent 40%),
          #0b0d10;
        color: #e0e0e0;
        font: 16px/1.6 "Segoe UI", system-ui, sans-serif;
      }
      main {
        width: min(640px, 100%);
        padding: 32px;
        border: 1px solid rgba(0, 255, 255, 0.35);
        border-radius: 16px;
        background: rgba(12, 14, 18, 0.86);
        box-shadow: 0 0 24px rgba(0, 255, 255, 0.18);
      }
      .tag {
        margin: 0 0 10px;
        color: #00ffff;
        font: 600 11px/1 ui-monospace, monospace;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      h1 { margin: 0 0 12px; font-size: 28px; line-height: 1.2; }
      p { margin: 0 0 14px; color: #b8c2cf; }
      ul { margin: 0 0 18px; padding-left: 20px; color: #b8c2cf; }
      li { margin-bottom: 6px; }
      code {
        padding: 2px 6px;
        border-radius: 6px;
        background: rgba(0, 255, 255, 0.1);
        color: #ccff00;
        font: 13px/1 ui-monospace, monospace;
      }
      .foot {
        margin: 0;
        padding-top: 14px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        color: #8d98a8;
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <main>
      <p class="tag">Example artifact</p>
      <h1>Artifacts render inside KeyCode</h1>
      <p>
        This page is a stored HTML artifact. The agent creates them with the
        <code>Artifact</code> tool, and the Artifacts panel previews them in a
        sandboxed frame.
      </p>
      <ul>
        <li>Each update adds a new version, and old versions stay available.</li>
        <li>Previews are served over loopback with a per-session token.</li>
        <li>This example lives in your local artifact store until you delete it.</li>
      </ul>
      <p class="foot">
        Created from the Artifacts panel. Use Delete to remove it when you are
        done.
      </p>
    </main>
  </body>
</html>
`;
