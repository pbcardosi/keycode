# Install KeyCode

KeyCode is alpha. The npm package name is `keycode-ai`, but it has not been
published to the public registry yet. Use a tarball until the first publish.

## Requirements

- Node.js 22 or newer.
- A provider key, or Ollama / LM Studio / llama.cpp running locally.
- Optional: Chrome for browser automation.
- Optional: `typescript-language-server` for TypeScript diagnostics.

## From a release tarball

```bash
npm install -g ./keycode-ai-0.1.1.tgz
keycode --version
```

Windows PowerShell:

```powershell
npm install -g .\keycode-ai-0.1.1.tgz
keycode --version
```

## From source

```bash
git clone <repository>
cd keycode
npm ci
npm run build
npm link
keycode --version
```

## After the npm publish

```bash
npm install -g keycode-ai
```

Upgrade:

```bash
npm install -g keycode-ai@latest
```

Uninstall:

```bash
npm uninstall -g keycode-ai
```

## VS Code

```powershell
cd editors/vscode
npx @vscode/vsce package
code --install-extension keycode-vscode-0.1.1.vsix --force
```

Verify the extension package against `SHA256SUMS` when one is published.

## winget, Homebrew, and native binaries

These are not published yet. The release workflow currently produces:

- `keycode-ai-<version>.tgz`
- `keycode-vscode-<version>.vsix`
- `SHA256SUMS`

Standalone binaries can be generated later with Node SEA or a bundler.

## First run

```powershell
$env:OLLAMA_HOST = "http://127.0.0.1:11434"
ollama pull gemma4:e2b
keycode --provider ollama --model gemma4:e2b
```

Or use a free hosted key:

```powershell
$env:GEMINI_API_KEY = "your-key"
keycode --provider gemini --model gemini-2.5-flash
```
