# keycode for VS Code

This extension opens the keycode web UI in a VS Code editor tab. It reuses the
same frontend as `keycode remote`, so streaming, tools, diffs, approvals,
sessions, Markdown, and model switching are all available unchanged.

## Requirements

- VS Code 1.85 or newer.
- `keycode` installed and on `PATH`. The npm package is not published yet, so
  build and install the tarball from the repository first:

  ```bash
  npm install && npm run build && npm pack
  npm install -g ./keycode-cli-0.1.0.tgz
  keycode --version
  ```

  Or set `keycode.executable` to an absolute path.

## Use

1. Run **keycode: Open Chat** from the Command Palette.
2. The extension starts `keycode remote --permission-mode manual` in the first
   workspace folder and opens the printed URL in a **Simple Browser** tab.
3. Use the chat normally. Approvals appear in the panel.
4. The status bar shows the server state; click it to reopen the chat.

Commands:

- **keycode: Open Chat**
- **keycode: Restart Server**
- **keycode: Stop Server**
- **keycode: Open in Browser**
- **keycode: Show Log**

Settings:

| Setting | Default | Meaning |
|---|---|---|
| `keycode.executable` | `keycode` | CLI path or command |
| `keycode.provider` | empty | Provider id, for example `ollama` |
| `keycode.model` | empty | Model id |
| `keycode.permissionMode` | `manual` | Permission mode |
| `keycode.cwd` | empty | Working directory; empty uses the first workspace folder |
| `keycode.openIn` | `editor` | `editor` for Simple Browser, `external` for the default browser |

## Notes

- The server binds to `127.0.0.1` and is stopped when the extension deactivates.
- The token is part of the printed URL and is redacted from the output channel.
- The Simple Browser loads the local server. If your organization blocks local
  origins in webviews, set `keycode.openIn` to `external`.
- If the panel asks to pair, paste the token from the keycode output channel or
  switch to **keycode: Open in Browser**.

## Package a VSIX

No build step is required; the extension is plain CommonJS.

```bash
cd editors/vscode
npx @vscode/vsce package
code --install-extension keycode-vscode-0.1.0.vsix
```
