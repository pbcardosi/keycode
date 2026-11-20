# Install KeyCode

KeyCode is alpha. The npm package name is `keycode-ai`; the executable is
`keycode`.

## Requirements

- Node.js 22 or newer, unless you use the Windows portable build.
- A provider key, or Ollama / LM Studio / llama.cpp running locally.
- Optional: Chrome for browser automation.
- Optional: `typescript-language-server` for TypeScript diagnostics.

## From npm

```bash
npm install -g keycode-ai
keycode --version
```

Upgrade:

```bash
npm install -g keycode-ai@latest
```

Uninstall:

```bash
npm uninstall -g keycode-ai
```

## Windows portable build

Download `keycode-<version>-win-x64.zip` from the
[releases page](https://github.com/pbcardosi/keycode/releases), unzip it, and
run `keycode.exe`. The zip bundles Node.js and the CLI, so no separate Node
install is required. Add the folder to `PATH` to run `keycode` from any shell.

The winget manifest for this build lives in `packaging/winget`. It is validated
locally but is not yet in the `microsoft/winget-pkgs` repository.

## Homebrew

```bash
brew tap pbcardosi/keycode
brew install keycode
keycode --version
```

## From a release tarball

Use this when you want to install a specific artifact or verify its checksum.

```bash
npm install -g ./keycode-ai-<version>.tgz
keycode --version
```

Windows PowerShell:

```powershell
npm install -g .\keycode-ai-<version>.tgz
keycode --version
```

Compare the tarball against `SHA256SUMS` from the same release.

## From source

```bash
git clone https://github.com/pbcardosi/keycode.git
cd keycode
npm ci
npm run build
npm link
keycode --version
```

## VS Code

Download `keycode-vscode-<version>.vsix` from the releases page, or build it:

```powershell
cd editors/vscode
npx @vscode/vsce package
code --install-extension keycode-vscode-<version>.vsix --force
```

The extension is not yet on the Visual Studio Marketplace. Compare the VSIX
against `SHA256SUMS` when installing a downloaded copy.

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
