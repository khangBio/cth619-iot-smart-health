param(
    [ValidatePattern('^dev-hp[0-9]{2,3}$')]
    [string[]]$Devices = @('dev-hp01', 'dev-hp02', 'dev-hp03', 'dev-hp04', 'dev-hp05', 'dev-hp06')
)

$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPio = Join-Path $env:USERPROFILE '.platformio\penv\Scripts\pio.exe'
if (-not (Test-Path -LiteralPath $taskPio)) {
    $taskCommand = Get-Command pio -ErrorAction SilentlyContinue
    if (-not $taskCommand) { throw 'Install PlatformIO IDE in VS Code, then run this script again.' }
    $taskPio = $taskCommand.Source
}

# Build sequentially so six VS Code windows do not install shared packages at once.
foreach ($taskDevice in $Devices) {
    $taskProject = Join-Path $taskRoot "firmware\$taskDevice"
    if (-not (Test-Path -LiteralPath (Join-Path $taskProject 'platformio.ini'))) {
        throw "Missing PlatformIO project: $taskDevice"
    }
    Write-Host "Building $taskDevice with $taskPio"
    & $taskPio run --project-dir $taskProject --environment esp32dev
    if ($LASTEXITCODE -ne 0) { throw "Build failed: $taskDevice (exit $LASTEXITCODE)" }
    foreach ($taskArtifact in @('firmware.bin', 'firmware.elf')) {
        $taskArtifactPath = Join-Path $taskProject ".pio\build\esp32dev\$taskArtifact"
        if (-not (Test-Path -LiteralPath $taskArtifactPath)) { throw "Missing artifact: $taskArtifactPath" }
        Write-Host "Ready: $taskArtifactPath"
    }
}
