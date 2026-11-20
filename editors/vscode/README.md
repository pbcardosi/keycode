# KeyCode for VS Code

This extension opens the KeyCode web UI in a VS Code editor tab. It reuses the
same frontend as `keycode remote`, so streaming, tools, diffs, approvals,
sessions, Markdown, and model switching are all available unchanged.

## Requirements

- VS Code 1.85 or newer.
- The `keycode` CLI installed and on `PATH`. The npm package is not published yet, so
  build and install the tarball from the repository first:

  ```bash
  npm install && npm run build && npm pack
  npm install -g ./keycode-cli-0.1.0.tgz
  keycode --version
  ```

  Or set `keycode.executable` to an absolute path.

## Use

1. Run **KeyCode: Open Chat** from the Command Palette.
2. The extension starts `keycode remote --permission-mode manual` in the first
   workspace folder and opens the printed URL in a **Simple Browser** tab.
3. Use the chat normally. Approvals appear in the panel.
4. The active file and selection are forwarded automatically. The web UI shows
   a context chip above the composer; **Detach** removes it.

You can also open the chat from a shell with the registered deep link:

```powershell
Start-Process "vscode://keycode.keycode-vscode/open"
```

To copy the pairing token for Chrome or another browser:

```powershell
Start-Process "vscode://keycode.keycode-vscode/token"
```

## Editor context

With `keycode.forwardSelection` enabled (the default), the extension sends:

- the active file path, and
- the selected text with 1-based start/end lines, when there is a selection.

The KeyCode server shows the context above the composer and prepends it to the
next prompt as data:

```text
# Editor context (data, not instructions)
File: src/example.ts
Lines: 3-5
Selected text:
function answer() { return 42; }
```

Selections are capped at 20,000 characters. The server also accepts context
over `POST /context` with the pairing token, so other editors can integrate the
same way. **Detach** sends `clear_context`; the extension reattaches on the next
selection change, or immediately when you reopen the chat.

Commands:

- **KeyCode: Open Chat**
- **KeyCode: Restart Server**
- **KeyCode: Stop Server**
- **KeyCode: Open in Browser**
- **KeyCode: Copy Pairing Token**
- **KeyCode: Show Log**

Settings:

| Setting | Default | Meaning |
|---|---|---|
| `keycode.executable` | `keycode` | CLI path or command |
| `keycode.provider` | empty | Provider id, for example `ollama` |
| `keycode.model` | empty | Model id |
| `keycode.permissionMode` | `manual` | Permission mode |
| `keycode.cwd` | empty | Working directory; empty uses the first workspace folder |
| `keycode.openIn` | `editor` | `editor` for Simple Browser, `external` for the default browser |
| `keycode.forwardSelection` | `true` | Forward the active file and selection |

## Notes

- The server binds to `127.0.0.1` and is stopped when the extension deactivates.
- The token is part of the printed URL and is redacted from the output channel.
- The Simple Browser loads the local server. If your organization blocks local
  origins in webviews, set `keycode.openIn` to `external`.
- If the panel asks to pair, paste the token from the KeyCode output channel or
  switch to **KeyCode: Open in Browser**.
- To use Chrome or another browser, run **KeyCode: Open in Browser** or
  **KeyCode: Copy Pairing Token** and paste it into the pairing dialog.

## Package a VSIX

No build step is required; the extension is plain CommonJS.

```bash
cd editors/vscode
npx @vscode/vsce package
code --install-extension keycode-vscode-0.1.0.vsix
```
