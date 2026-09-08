param([switch]$SkipTests)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    $localCargo = Join-Path $projectRoot '.tools\cargo'
    $localRustup = Join-Path $projectRoot '.tools\rustup'
    if (Test-Path -LiteralPath (Join-Path $localCargo 'bin\cargo.exe')) {
        $env:CARGO_HOME = $localCargo
        $env:RUSTUP_HOME = $localRustup
        $env:PATH = (Join-Path $localCargo 'bin') + ';' + $env:PATH
    }
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        throw 'Rust MSVC toolchain is missing. Install Rust and Visual Studio C++ Build Tools first.'
    }
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        throw 'pnpm is missing. Install Node.js and pnpm first.'
    }
    if (-not (Test-Path -LiteralPath 'src-tauri\Cargo.lock')) {
        throw 'Cargo.lock is missing. Run cargo generate-lockfile --manifest-path src-tauri/Cargo.toml first.'
    }
    if (-not $SkipTests) {
        & pnpm test
        if ($LASTEXITCODE -ne 0) { throw 'Unit tests failed.' }
    }
    & pnpm prepare:pdf
    if ($LASTEXITCODE -ne 0) { throw 'PDF resource preparation failed.' }

    & pnpm tauri build --ci --bundles nsis --target x86_64-pc-windows-msvc -- --locked
    if ($LASTEXITCODE -ne 0) { throw 'Windows build failed.' }

    $version = (Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json).version
    $name = "Paperead_${version}_x64-setup.exe"
    $source = Join-Path $projectRoot "src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\$name"
    if (-not (Test-Path -LiteralPath $source)) { throw "Installer not found: $source" }
    $releaseDirectory = Join-Path $projectRoot 'release'
    New-Item -ItemType Directory -Force -Path $releaseDirectory | Out-Null
    $destination = Join-Path $releaseDirectory $name
    Copy-Item -LiteralPath $source -Destination $destination -Force
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $releaseDirectory "$name.sha256"), "$hash  $name`n", [Text.UTF8Encoding]::new($false))
    Write-Output "Installer: $destination"
    Write-Output "SHA256: $hash"
}
finally {
    Pop-Location
}
