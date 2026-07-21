# Restarts the dedicated Browser Harness Chrome for Testing instance on port 9223.
# This helper is project-local for Calendar Clock extension testing.
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$SkipHarnessReload,
  [switch]$SkipExtensionReload,
  [switch]$SkipCleanExitRepair,
  [switch]$SkipDoctor,
  [switch]$NoCalendarTab,
  [string]$ChromePath = "",
  [string]$CalendarUrl = "https://calendar.google.com/calendar/u/0/r/week"
)

$ErrorActionPreference = "Stop"

$ChromeInstallRoot = "C:\PS\chrome-for-testing"
$ProfilePath = "C:\PS\browser-harness-cft-profile"
$Port = 9223
$HarnessName = "cfttest"
$CdpUrl = "http://127.0.0.1:$Port"

function Resolve-CftChromePath {
  param([string]$RequestedPath)

  if ($RequestedPath) {
    return [IO.Path]::GetFullPath($RequestedPath)
  }

  if (-not (Test-Path -LiteralPath $ChromeInstallRoot -PathType Container)) {
    throw "Chrome for Testing install root is missing: $ChromeInstallRoot"
  }

  $candidates = @(Get-ChildItem -LiteralPath $ChromeInstallRoot -Directory -ErrorAction Stop | ForEach-Object {
    $executable = Join-Path $_.FullName "chrome-win64\chrome.exe"
    if (Test-Path -LiteralPath $executable -PathType Leaf) {
      try { $version = [version]$_.Name } catch { $version = [version]"0.0" }
      [pscustomobject]@{ Path = $executable; Version = $version }
    }
  })

  if (-not $candidates.Count) {
    throw "No Chrome for Testing executable found under $ChromeInstallRoot"
  }

  return ($candidates | Sort-Object Version -Descending | Select-Object -First 1 -ExpandProperty Path)
}

$ChromePath = Resolve-CftChromePath -RequestedPath $ChromePath

function Write-Step {
  param([string]$Message)
  Write-Host "[calendar-clock-cft] $Message"
}

function Get-ProcessCommandLine {
  param([int]$ProcessId)
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $processInfo) { return "" }
  return [string]$processInfo.CommandLine
}

function Assert-PortIsSafeToUse {
  $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $connection) { return }

  $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
  if (-not $process) {
    throw "Port $Port is occupied by process $($connection.OwningProcess), but the process cannot be inspected."
  }

  if ($process.Path -ne $ChromePath) {
    throw "Port $Port is in use by '$($process.Path)', not the CFT Chrome executable. Refusing to touch it."
  }

  $commandLine = Get-ProcessCommandLine -ProcessId $process.Id
  if ($commandLine -notlike "*--user-data-dir=$ProfilePath*") {
    throw "Port $Port is owned by CFT Chrome, but not the expected profile '$ProfilePath'. Refusing to touch it."
  }
}

function Get-CftChromeProcesses {
  Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ExecutablePath -eq $ChromePath -and
      ([string]$_.CommandLine) -like "*--user-data-dir=$ProfilePath*"
    }
}

function Wait-ForCftChromeExit {
  param([int]$TimeoutSeconds)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 250
    $remaining = @(Get-CftChromeProcesses)
  } while ($remaining.Count -gt 0 -and (Get-Date) -lt $deadline)

  return $remaining
}

function Request-CftChromeBrowserClose {
  $versionUrl = "$CdpUrl/json/version"

  try {
    $version = Invoke-RestMethod -Uri $versionUrl -TimeoutSec 2
  } catch {
    Write-Step "Could not reach CFT Chrome CDP endpoint for graceful shutdown: $($_.Exception.Message)"
    return $false
  }

  if (-not $version.webSocketDebuggerUrl) {
    Write-Step "CFT Chrome CDP endpoint did not report a browser websocket; skipping CDP shutdown."
    return $false
  }

  $client = [System.Net.WebSockets.ClientWebSocket]::new()
  try {
    $client.ConnectAsync([Uri]$version.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $payload = [Text.Encoding]::UTF8.GetBytes('{"id":1,"method":"Browser.close"}')
    $segment = [ArraySegment[byte]]::new($payload)
    $client.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    Write-Step "Requested graceful CFT Chrome shutdown through CDP."
    return $true
  } catch {
    Write-Step "CDP graceful shutdown request failed: $($_.Exception.Message)"
    return $false
  } finally {
    $client.Dispose()
  }
}

function Close-CftChromeWindows {
  param([int[]]$ProcessIds)

  $closedAny = $false
  foreach ($id in $ProcessIds) {
    $process = Get-Process -Id $id -ErrorAction SilentlyContinue
    if (-not $process -or $process.MainWindowHandle -eq 0) { continue }

    if ($process.CloseMainWindow()) {
      $closedAny = $true
    }
  }

  if ($closedAny) {
    Write-Step "Requested graceful CFT Chrome shutdown through window close."
  }

  return $closedAny
}

function Repair-CftProfileCleanExitState {
  if ($SkipCleanExitRepair) { return }

  $preferencesPath = Join-Path $ProfilePath "Default\Preferences"
  if (-not (Test-Path -LiteralPath $preferencesPath)) { return }

  try {
    $preferences = Get-Content -Raw -LiteralPath $preferencesPath | ConvertFrom-Json
    if (-not $preferences.profile) {
      $preferences | Add-Member -MemberType NoteProperty -Name profile -Value ([pscustomobject]@{})
    }

    $profileProperties = @($preferences.profile.PSObject.Properties.Name)
    $changed = $false
    if ($preferences.profile.exit_type -ne "Normal" -or $profileProperties -notcontains "exit_type") {
      if ($profileProperties -contains "exit_type") {
        $preferences.profile.exit_type = "Normal"
      } else {
        $preferences.profile | Add-Member -MemberType NoteProperty -Name exit_type -Value "Normal"
      }
      $changed = $true
    }

    if ($preferences.profile.exited_cleanly -ne $true -or $profileProperties -notcontains "exited_cleanly") {
      if ($profileProperties -contains "exited_cleanly") {
        $preferences.profile.exited_cleanly = $true
      } else {
        $preferences.profile | Add-Member -MemberType NoteProperty -Name exited_cleanly -Value $true
      }
      $changed = $true
    }

    if (-not $changed) { return }

    $json = $preferences | ConvertTo-Json -Depth 100 -Compress
    $utf8WithoutBom = [Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllText($preferencesPath, $json, $utf8WithoutBom)
    Write-Step "Repaired CFT Chrome profile clean-exit state."
  } catch {
    Write-Step "Could not repair CFT Chrome profile clean-exit state: $($_.Exception.Message)"
  }
}

function Stop-CftChrome {
  $processes = @(Get-CftChromeProcesses)
  if (-not $processes.Count) {
    Write-Step "No CFT Chrome processes found."
    return
  }

  $ids = $processes | Select-Object -ExpandProperty ProcessId -Unique
  Write-Step "Stopping CFT Chrome processes gracefully: $($ids -join ', ')"

  if ($PSCmdlet.ShouldProcess("CFT Chrome", "Request graceful browser shutdown")) {
    Request-CftChromeBrowserClose | Out-Null
  }

  $remaining = @(Wait-ForCftChromeExit -TimeoutSeconds 10)

  if ($remaining.Count -gt 0 -and $PSCmdlet.ShouldProcess("CFT Chrome", "Request window close")) {
    $remainingIds = $remaining | Select-Object -ExpandProperty ProcessId -Unique
    Close-CftChromeWindows -ProcessIds $remainingIds | Out-Null
    $remaining = @(Wait-ForCftChromeExit -TimeoutSeconds 5)
  }

  if ($remaining.Count -gt 0) {
    $remainingIds = $remaining | Select-Object -ExpandProperty ProcessId -Unique
    Write-Step "Force-stopping unresponsive CFT Chrome processes: $($remainingIds -join ', ')"
    foreach ($id in $remainingIds) {
      if ($PSCmdlet.ShouldProcess("process $id", "Force-stop CFT Chrome process")) {
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
      }
    }
  }

  $remaining = @(Wait-ForCftChromeExit -TimeoutSeconds 10)

  if ($remaining.Count -gt 0) {
    throw "Timed out waiting for CFT Chrome processes to stop: $(($remaining | Select-Object -ExpandProperty ProcessId) -join ', ')"
  }

  Repair-CftProfileCleanExitState
}

function Start-CftChrome {
  if (-not (Test-Path -LiteralPath $ChromePath)) {
    throw "Chrome for Testing executable missing: $ChromePath"
  }

  New-Item -ItemType Directory -Force -Path $ProfilePath | Out-Null

  $arguments = @(
    "--remote-debugging-port=$Port",
    "--remote-debugging-address=127.0.0.1",
    "--user-data-dir=$ProfilePath",
    "--no-first-run",
    "--disable-default-apps",
    "about:blank"
  )

  Write-Step "Starting CFT Chrome on $CdpUrl"
  if ($PSCmdlet.ShouldProcess($ChromePath, "Start CFT Chrome")) {
    Start-Process -FilePath $ChromePath -ArgumentList $arguments -WindowStyle Hidden | Out-Null
  }

  $deadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 500
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  } while (-not $connection -and (Get-Date) -lt $deadline)

  if (-not $connection) {
    throw "CFT Chrome did not start listening on $CdpUrl."
  }
}

function Invoke-BrowserHarness {
  param(
    [string[]]$Arguments,
    [string]$InputText = $null
  )

  $env:BU_NAME = $HarnessName
  $env:BU_CDP_URL = $CdpUrl

  if ($null -eq $InputText) {
    & browser-harness @Arguments
    return
  }

  $InputText | & browser-harness @Arguments
}

function Reset-BrowserHarnessDaemon {
  $env:BU_NAME = $HarnessName
  $env:BU_CDP_URL = $CdpUrl

  $output = @(& browser-harness --reload 2>&1)
  if ($LASTEXITCODE -eq 0) {
    $output
    return
  }

  $summary = ($output | Select-Object -Last 1)
  Write-Step "Browser Harness daemon reload failed; continuing with CFT Chrome restart. Last error: $summary"
}

function Open-CalendarTab {
  Write-Step "Opening Google Calendar in CFT."
  $script = @"
new_tab("$CalendarUrl")
wait_for_load()
print(page_info())
"@
  Invoke-BrowserHarness -InputText $script -Arguments @()
}

function Get-CalendarClockExtensionId {
  $script = @'
wait(2)
print(js("""(() => {
  const src = document.querySelector('#calendar-clock-root iframe')?.src || '';
  const match = src.match(new RegExp('^chrome-extension://([^/]+)/'));
  return match ? match[1] : '';
})()"""))
'@
  $output = @(Invoke-BrowserHarness -InputText $script -Arguments @())
  return ($output | Where-Object { $_ -match '^[a-z]{32}$' } | Select-Object -Last 1)
}

function Reload-CalendarClockExtension {
  if ($NoCalendarTab -or $SkipExtensionReload) { return }

  $extensionId = Get-CalendarClockExtensionId
  if (-not $extensionId) {
    Write-Step "Could not find Calendar Clock extension id from Calendar iframe; skipping extension reload."
    return
  }

  Write-Step "Reloading extension $extensionId."
  $extensionPage = "chrome-extension://$extensionId/src/clock/popup.html"
  $script = @"
new_tab("$extensionPage")
wait_for_load()
print(js("""(() => {
  const version = chrome.runtime.getManifest().version;
  chrome.runtime.reload();
  return 'extension reload requested from version ' + version;
})()"""))
"@
  Invoke-BrowserHarness -InputText $script -Arguments @()
  Start-Sleep -Seconds 2
  Open-CalendarTab
}

Assert-PortIsSafeToUse

if (-not $SkipHarnessReload) {
  Write-Step "Resetting Browser Harness daemon."
  Reset-BrowserHarnessDaemon
}

Stop-CftChrome
Start-CftChrome

if (-not $SkipDoctor) {
  Write-Step "Running Browser Harness doctor."
  Invoke-BrowserHarness -Arguments @("--doctor")
}

if (-not $NoCalendarTab) {
  Open-CalendarTab
  Reload-CalendarClockExtension
}

Write-Step "Done."
