$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    $nativeOutput = Join-Path $projectRoot 'src-tauri/target/x86_64-pc-windows-msvc/release/paperead.exe'
    $versionCode = (Get-Content -Raw package.json | ConvertFrom-Json).version.Replace('.','')
    $validationDirectory = Join-Path $projectRoot ".tmp/validation-$versionCode"
    $productionDirectory = Join-Path $projectRoot ".tmp/production-$versionCode"
    New-Item -ItemType Directory -Force -Path $validationDirectory, $productionDirectory | Out-Null
    $productionCopy = Join-Path $productionDirectory 'paperead.exe'
    Copy-Item -LiteralPath $nativeOutput -Destination $productionCopy -Force
    $configPath = Join-Path $validationDirectory 'tauri-config.json'
    [IO.File]::WriteAllText($configPath, ('{"identifier":"app.paperead.validation' + $versionCode + '"}'), [Text.UTF8Encoding]::new($false))
    $env:CARGO_HOME = Join-Path $projectRoot '.tools/cargo'
    $env:RUSTUP_HOME = Join-Path $projectRoot '.tools/rustup'
    $env:PATH = (Join-Path $env:CARGO_HOME 'bin') + ';' + $env:PATH
    try {
        & pnpm tauri build --ci --no-bundle --config $configPath --target x86_64-pc-windows-msvc -- --locked
        if ($LASTEXITCODE -ne 0) { throw 'Validation build failed.' }
        Copy-Item -LiteralPath $nativeOutput -Destination (Join-Path $validationDirectory 'paperead.exe') -Force
    }
    finally {
        Copy-Item -LiteralPath $productionCopy -Destination $nativeOutput -Force
    }
    Write-Output "Validation executable: $(Join-Path $validationDirectory 'paperead.exe')"
}
finally { Pop-Location }
