# Release KeyCode

## Version and changelog

1. Update `package.json`, `src/cli/index.ts` `VERSION`, `editors/vscode/package.json`,
   and `CHANGELOG.md`.
2. Run:

```bash
npm run validate:package
npm run validate:extension
npm run verify
npm run pack:smoke
npm run browser:smoke
npm run extension:smoke
```

## Local release check

```bash
npm run release:check
```

This runs verification, the tarball smoke test, and `npm publish --dry-run`.
It does not publish.

## Package name

The npm name is `keycode-ai`; `keycode` and `keycode-cli` are already taken.
The executable is `keycode`.

## Publish to npm

Requires `npm login` and ownership of `keycode-ai`.

```bash
npm publish --provenance --access public
```

In CI, run the **Publish npm** workflow with `dry_run: false` after adding an
`NPM_TOKEN` repository secret. The workflow reruns verification and pack smoke
before publishing.

## GitHub release

```bash
git tag v0.1.2
git push origin v0.1.2
```

`.github/workflows/release.yml` reruns verification, packs the tarball, writes
`SHA256SUMS`, and attaches both to the GitHub release.

## VS Code extension

```powershell
cd editors/vscode
npx @vscode/vsce package --out keycode-vscode-0.1.2.vsix
```

Attach the VSIX to the GitHub release and add its checksum:

```bash
node ../../scripts/checksums.mjs .
```

Publishing to the Visual Studio Marketplace needs a publisher account and a
Personal Access Token; marketplace signing is handled by the marketplace.

## Installers

winget, Homebrew, and standalone binaries are not set up yet. The release
workflow is the source of truth for current artifacts.
