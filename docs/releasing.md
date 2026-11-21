# Release KeyCode

## Version and changelog

1. Update `package.json`, `package-lock.json`, `src/version.ts`, the version
   shown in `src/web/public/index.html`, and `CHANGELOG.md`.
   `editors/vscode/package.json` only changes when the extension changes; it
   releases on its own version line.
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
npm publish --access public
```

In CI, run the **Publish npm** workflow with `dry_run: false` after adding an
`NPM_TOKEN` repository secret. The workflow reruns verification and pack smoke
before publishing. Revoke the token when release work is finished.

## GitHub release

```bash
git tag -a v0.1.4 -m "KeyCode 0.1.4"
git push origin v0.1.4
```

`.github/workflows/release.yml` reruns verification, packs the tarball, writes
`SHA256SUMS`, and creates the release with both. Then stage the other artifacts
and upload them:

```powershell
$out = "release\0.1.4"
Copy-Item "release\keycode-ai-0.1.4.tgz" $out
Copy-Item "release\keycode-0.1.4-win-x64.zip" $out
Copy-Item "release\keycode-vscode-<ext-version>.vsix" $out
node scripts/checksums.mjs $out
gh release upload v0.1.4 "$out\keycode-0.1.4-win-x64.zip" `
  "$out\keycode-vscode-<ext-version>.vsix" "$out\SHA256SUMS" --clobber
```

## VS Code extension

```powershell
cd editors/vscode
npx @vscode/vsce package --out keycode-vscode-<version>.vsix
```

Attach the VSIX to the current GitHub release and regenerate `SHA256SUMS` with
`node scripts/checksums.mjs`. Publishing to the Visual Studio Marketplace needs
a publisher account and a Personal Access Token; marketplace signing is handled
by the marketplace.

## Windows portable build

See `packaging/windows/README.md`. The zip bundles the Node.js runtime, the
`keycode-ai` package, and `keycode.exe`; smoke-test it with `--version` and
`doctor` before uploading.

## Homebrew

The tap lives at `pbcardosi/homebrew-keycode`.

1. Copy the new registry tarball URL and SHA-256 into `Formula/keycode.rb`.
2. Update the version asserted in the formula test.
3. Commit `Update KeyCode to <version>` and push.

## winget

The manifests live in `packaging/winget/manifests/p/Pbcardosi/KeyCode/<version>`
and are submitted to `microsoft/winget-pkgs` from the `pbcardosi` fork.

1. Create the manifest folder for the new version with the release zip URL and
   its SHA-256 (uppercase hex).
2. Validate locally with
   `winget validate --manifest packaging\winget\manifests\p\Pbcardosi\KeyCode\<version>`.
3. Update the open PR in place, or open a new one if the previous version
   already merged.
4. `08. Installation Validation` can fail on
   `Another scan already in progress, cannot start scan`, which is Windows
   Defender contention. Only winget maintainers can re-run validation with
   `@wingetbot run`.

## Artifact checksums

Every published artifact is listed in `SHA256SUMS` on the GitHub release. Build
the list from the staged artifact folder, never from mixed versions.
