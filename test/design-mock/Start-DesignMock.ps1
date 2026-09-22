# Starts the design mock static server and opens it in the Browser Harness CFT tab (or prints the URL).
[CmdletBinding()]
param(
  [int]$Port = 8766,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$mockDir = $PSScriptRoot
$url = "http://127.0.0.1:$Port/test/design-mock/"

function Test-PortListening {
  param([int]$TestPort)
  try {
    $client = New-Object Net.Sockets.TcpClient
    $client.Connect("127.0.0.1", $TestPort)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-PortListening -TestPort $Port)) {
  $env:DESIGN_MOCK_PORT = "$Port"
  Start-Process -FilePath "node" -ArgumentList @((Join-Path $mockDir "serve.mjs")) -WorkingDirectory $mockDir -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(10)
  while (-not (Test-PortListening -TestPort $Port)) {
    if ((Get-Date) -gt $deadline) { throw "Design mock server did not start on port $Port." }
    Start-Sleep -Milliseconds 200
  }
  Write-Host "[design-mock] server started on port $Port"
} else {
  Write-Host "[design-mock] reusing server on port $Port"
}

Write-Host "[design-mock] $url"
if ($NoBrowser) { return }

$harness = Get-Command browser-harness.exe -ErrorAction SilentlyContinue
if (-not $harness) {
  Write-Host "[design-mock] browser-harness not found; open the URL manually."
  return
}

$env:BU_NAME = "cfttest"
$env:BU_CDP_URL = "http://127.0.0.1:9223"
$code = @"
existing = [t for t in list_tabs() if str(t.get("url", "")).startswith("$url")]
if existing:
    switch_tab(existing[0]["targetId"], activate=True)
    goto_url("$url")
else:
    new_tab("$url")
    activate_tab(current_tab())
wait_for_load()
print(page_info())
"@
$start = New-Object Diagnostics.ProcessStartInfo
$start.FileName = $harness.Source
$start.UseShellExecute = $false
$start.RedirectStandardInput = $true
$start.CreateNoWindow = $true
$process = New-Object Diagnostics.Process
$process.StartInfo = $start
if (-not $process.Start()) { throw "Failed to start browser-harness." }
$bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($code)
$process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
$process.StandardInput.BaseStream.Close()
$process.WaitForExit()
if ($process.ExitCode -ne 0) { throw "browser-harness exited with code $($process.ExitCode)" }
