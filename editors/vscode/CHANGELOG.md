# Changelog

## 0.1.2

- Track the CLI 0.1.2 release.
- Install the CLI from npm with `npm install -g keycode-ai`.

## 0.1.1

- Track the CLI 0.1.1 patch release.

## 0.1.0

- Initial VS Code extension.
- Starts `keycode remote` and opens the shared web UI in Simple Browser.
- Commands for open, restart, stop, external browser, and logs.
- Settings for executable, provider, model, permission mode, working directory,
  and open target.
- Active file and selection forwarding to the KeyCode server, with
  `keycode.forwardSelection` to disable it.
- `vscode://keycode.keycode-vscode/open` deep link to open the chat directly.
- **KeyCode: Copy Pairing Token** for pairing a normal browser with the running
  server, also available as `vscode://keycode.keycode-vscode/token`.
