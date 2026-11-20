# Windows portable build

The portable zip bundles the Node.js runtime, the `keycode-ai` npm package, and
a small launcher. It targets Windows 10 or later on x64.

Build steps (PowerShell, from the repository root):

```powershell
$version = "0.1.2"
$stage = Join-Path $env:TEMP "keycode-portable"
$tgz = (Resolve-Path "release\keycode-ai-$version.tgz").Path

Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $stage "app") | Out-Null
npm install $tgz --prefix (Join-Path $stage "app") --omit=dev --no-audit --no-fund
Copy-Item (Get-Command node).Source (Join-Path $stage "node.exe")
Copy-Item LICENSE (Join-Path $stage "LICENSE-KeyCode.txt")
Invoke-WebRequest "https://raw.githubusercontent.com/nodejs/node/v26.13.1/LICENSE" `
  -OutFile (Join-Path $stage "LICENSE-Node.txt")

& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe `
  /out:"$stage\keycode.exe" "packaging\windows\launcher.cs"

Compress-Archive -Path (Join-Path $stage "*") `
  -DestinationPath "release\keycode-$version-win-x64.zip" -CompressionLevel Optimal
```

Add `README.txt` to the staging folder before zipping, and verify the result:

```powershell
keycode.exe --version
keycode.exe doctor
Get-FileHash "release\keycode-$version-win-x64.zip" -Algorithm SHA256
```

The bundled Node version must match the one named in `LICENSE-Node.txt`. Keep
the Node.js license file with the build; Node.js is distributed under the MIT
license.
