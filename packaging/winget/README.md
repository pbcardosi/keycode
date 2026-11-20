# winget manifests

These manifests describe the Windows x64 portable build published with each
GitHub release. They are validated with:

```powershell
winget validate --manifest packaging\winget\manifests\p\Pbcardosi\KeyCode\<version>
```

A local install can be tested with `winget install -m <path>` after enabling
local manifest files from an elevated shell:

```powershell
winget settings --enable LocalManifestFiles
```

Publication requires a pull request to `microsoft/winget-pkgs` that adds the
manifest folder under `manifests/p/Pbcardosi/KeyCode/<version>`. See
<https://learn.microsoft.com/windows/package-manager/package/repository>.

The package installs `keycode.exe`, a launcher next to a bundled `node.exe` and
the extracted npm package. The launcher exposes the `keycode` command alias.
