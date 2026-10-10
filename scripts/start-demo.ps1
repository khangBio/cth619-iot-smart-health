$ErrorActionPreference = 'Stop'
$taskNode = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($taskNode) { $taskMajor = [int]((& $taskNode --version).TrimStart('v').Split('.')[0]) }
if (-not $taskNode -or $taskMajor -lt 22) {
    $taskBundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $taskBundled) { $taskNode = $taskBundled }
    else { throw 'Cần Node.js 22.13+ (khuyến nghị Node 24). Cài Node rồi chạy npm run demo.' }
}
Set-Location (Split-Path -Parent $PSScriptRoot)
& $taskNode --env-file-if-exists=.env server/index.js --demo
