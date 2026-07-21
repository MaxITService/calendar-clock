# Uses the logged-in CFT Calendar page and test-only MAIN-world hooks to manage today's fixtures.
[CmdletBinding()]
param(
  [ValidateSet("Add", "List", "Remove", "Reset")]
  [string]$Action = "List",

  [string]$ConfigPath = ""
)

$ErrorActionPreference = "Stop"
$scriptRoot = $PSScriptRoot
$driverPath = Join-Path $scriptRoot "fixture-driver.py"
$hookPath = Join-Path $scriptRoot "page-owned-fixture-hook.js"
$configPath = if ($ConfigPath) {
  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "Calendar fixture config is missing: $ConfigPath"
  }
  (Resolve-Path -LiteralPath $ConfigPath).Path
} else {
  Join-Path $scriptRoot "fixtures.json"
}

foreach ($path in @($driverPath, $hookPath, $configPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Calendar fixture component is missing: $path"
  }
}

$env:BU_NAME = "cfttest"
$env:BU_CDP_URL = "http://127.0.0.1:9223"
$env:CC_FIXTURE_ACTION = $Action
$env:CC_FIXTURE_HOOK_B64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content -Raw -LiteralPath $hookPath)))
$env:CC_FIXTURE_CONFIG_B64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content -Raw -LiteralPath $configPath)))

try {
  Get-Content -Raw -LiteralPath $driverPath | browser-harness
  if ($LASTEXITCODE -ne 0) { throw "Browser Harness fixture driver failed with exit code $LASTEXITCODE" }
} finally {
  Remove-Item Env:CC_FIXTURE_ACTION, Env:CC_FIXTURE_HOOK_B64, Env:CC_FIXTURE_CONFIG_B64 -ErrorAction SilentlyContinue
}
