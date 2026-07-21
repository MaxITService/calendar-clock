# CI-CD.ps1
param (
    [ValidateSet('Prompt', 'Auto', 'VersionOnly', 'BuildOnly')]
    [string]$Mode = 'Prompt'
)

# --------------------------- Configuration --------------------------- #

# Define the source directory as the script directory, not the caller's current directory.
$source = if ($PSScriptRoot) {
    (Resolve-Path -LiteralPath $PSScriptRoot).Path
}
else {
    (Get-Location).Path
}

# Package only files required by the extension. An allowlist prevents tests,
# development scripts, documentation, and design sources from leaking into releases.
$releasePaths = @(
    'manifest.json'
    'LICENSE'
    'icons/icon-16.png'
    'icons/icon-32.png'
    'icons/icon-48.png'
    'icons/icon-128.png'
    'src'
)

# Define the parent directory (one level up from the source)
$parent = Split-Path $source -Parent

# Define the target directory path
$targetFolderName = "Calendar Clock Release"
$destination = Join-Path $parent $targetFolderName

# Define the ZIP file path
$zipFileName = "$targetFolderName.zip"
$zipPath = Join-Path $parent $zipFileName

# Initialize an array to track items that failed to copy
$failedCopies = @()

# --------------------------- Functions --------------------------- #

function Get-ReleaseFiles {
    param (
        [Parameter(Mandatory = $true)]
        [string]$SourceRoot,

        [Parameter(Mandatory = $true)]
        [string[]]$Paths
    )

    $files = foreach ($relativePath in $Paths) {
        $path = Join-Path $SourceRoot $relativePath
        if (-not (Test-Path -LiteralPath $path)) {
            throw "Required release path not found: $relativePath"
        }

        $item = Get-Item -LiteralPath $path -Force
        if ($item.PSIsContainer) {
            Get-ChildItem -LiteralPath $item.FullName -Recurse -File -Force
        }
        else {
            $item
        }
    }

    @($files | Sort-Object -Property FullName -Unique)
}

function Get-ReleaseRelativePath {
    param (
        [Parameter(Mandatory = $true)]
        [string]$SourceRoot,

        [Parameter(Mandatory = $true)]
        [string]$FullName
    )

    $FullName.Substring($SourceRoot.Length).TrimStart('\').Replace('\', '/')
}

function Test-ReleaseArchive {
    param (
        [Parameter(Mandatory = $true)]
        [string]$ArchivePath,

        [Parameter(Mandatory = $true)]
        [string]$SourceRoot,

        [Parameter(Mandatory = $true)]
        [System.IO.FileInfo[]]$SourceFiles
    )

    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $expected = @($SourceFiles | ForEach-Object {
        Get-ReleaseRelativePath -SourceRoot $SourceRoot -FullName $_.FullName
    })

    $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $fileEntries = @($archive.Entries | Where-Object { -not [string]::IsNullOrEmpty($_.Name) })
        $actual = @($fileEntries | ForEach-Object { $_.FullName.Replace('\', '/') })
        $entriesByPath = @{}
        foreach ($entry in $fileEntries) {
            $entriesByPath[$entry.FullName.Replace('\', '/')] = $entry
        }
        $missing = @($expected | Where-Object { $_ -notin $actual })
        $unexpected = @($actual | Where-Object { $_ -notin $expected })
        $duplicates = @($actual | Group-Object | Where-Object { $_.Count -gt 1 } | ForEach-Object { $_.Name })

        if ($missing.Count -gt 0 -or $unexpected.Count -gt 0 -or $duplicates.Count -gt 0) {
            if ($missing.Count -gt 0) {
                Write-Error "Missing files in release archive: $($missing -join ', ')"
            }
            if ($unexpected.Count -gt 0) {
                Write-Error "Unexpected files in release archive: $($unexpected -join ', ')"
            }
            if ($duplicates.Count -gt 0) {
                Write-Error "Duplicate files in release archive: $($duplicates -join ', ')"
            }
            throw 'Release archive content validation failed.'
        }

        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            foreach ($sourceFile in $SourceFiles) {
                $relativePath = Get-ReleaseRelativePath -SourceRoot $SourceRoot -FullName $sourceFile.FullName
                $entry = $entriesByPath[$relativePath]
                $entryStream = $entry.Open()
                try {
                    $archiveHash = [BitConverter]::ToString($sha256.ComputeHash($entryStream)).Replace('-', '')
                }
                finally {
                    $entryStream.Dispose()
                }

                $sourceHash = (Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash
                if ($archiveHash -ne $sourceHash) {
                    throw "Release archive contains a stale or corrupt file: $relativePath"
                }
            }
        }
        finally {
            $sha256.Dispose()
        }
    }
    finally {
        $archive.Dispose()
    }

    Write-Host "Release archive validated: $($expected.Count) required files, no extras." -ForegroundColor Green
}

# --------------------------- Main Script --------------------------- #

try {
    # ------------------- Interaction Prompt ------------------- #
    $doVersionIncrease = $false
    $doCommit = $false

    switch ($Mode) {
        'Auto' {
            $doVersionIncrease = $true
            $doCommit = $true
            Write-Host "Selected: Version Increase + Git Commit" -ForegroundColor Green
        }
        'VersionOnly' {
            $doVersionIncrease = $true
            Write-Host "Selected: Version Increase ONLY" -ForegroundColor Yellow
        }
        'BuildOnly' {
            Write-Host "Selected: No Changes (Build Only)" -ForegroundColor Gray
        }
        default {
            Write-Host "--------------------------------------------------------" -ForegroundColor Cyan
            Write-Host "Select mode:" -ForegroundColor Cyan
            Write-Host " [ENTER]  Automatic Version Increase + Git Commit" -ForegroundColor Green
            Write-Host " [c]      Increase Version ONLY (No Commit)" -ForegroundColor Yellow
            Write-Host " [v]      Proceed with NO changes (Build only)" -ForegroundColor Gray
            Write-Host "--------------------------------------------------------" -ForegroundColor Cyan

            while ($true) {
                $keyInfo = $host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
                if ($keyInfo.VirtualKeyCode -eq 13) {
                    # Enter
                    $doVersionIncrease = $true
                    $doCommit = $true
                    Write-Host "Selected: Version Increase + Git Commit" -ForegroundColor Green
                    break
                }
                elseif ($keyInfo.Character -eq 'c') {
                    $doVersionIncrease = $true
                    Write-Host "Selected: Version Increase ONLY" -ForegroundColor Yellow
                    break
                }
                elseif ($keyInfo.Character -eq 'v') {
                    Write-Host "Selected: No Changes (Build Only)" -ForegroundColor Gray
                    break
                }
            }
        }
    }

    # ------------------- Version Management ------------------- #
    $manifestPath = Join-Path $source "manifest.json"
    $newVersion = $null 

    if ($doVersionIncrease) {
        Write-Host "Proceeding with version increase..."
        if (Test-Path $manifestPath) {
            $manifestContent = Get-Content $manifestPath -Raw
            # Regex for "version": "X.Y.Z" or "X.Y.Z.W"
            $versionPattern = '"version":\s*"(\d+\.\d+\.\d+(?:\.\d+)?)"'
            if ($manifestContent -match $versionPattern) {
                $currentVersion = $matches[1]
                Write-Host "Current Version: $currentVersion"
                
                $parts = $currentVersion.Split('.') | ForEach-Object { [int]$_ }
                if ($parts.Count -eq 3 -or $parts.Count -eq 4) {
                    $parts[$parts.Count - 1]++
                    
                    # Handle decimal carry-over only if it is a 4-part version (retaining original project's behavior)
                    if ($parts.Count -eq 4) {
                        for ($i = 3; $i -gt 0; $i--) {
                            if ($parts[$i] -gt 9) {
                                $parts[$i] = 0
                                $parts[$i - 1]++
                            }
                        }
                    }

                    $newVersion = $parts -join '.'
                    
                    # Update Manifest
                    $manifestContent = $manifestContent -replace $versionPattern, "`"version`": `"$newVersion`""
                    [System.IO.File]::WriteAllText(
                        $manifestPath,
                        $manifestContent,
                        [System.Text.UTF8Encoding]::new($false)
                    )
                    Write-Host "Updated manifest.json to $newVersion"
                }
                else {
                    throw "Version format in manifest is not supported (Found: $currentVersion)"
                }
            }
            else {
                throw "Could not find version pattern in manifest.json"
            }
        }
        else {
            throw "manifest.json not found at $manifestPath"
        }
    }

    Write-Host "Starting the copy and archive process..."

    # ------------------- Purge Existing Destination Directory ------------------- #
    if (Test-Path -Path $destination) {
        Write-Host "Purging existing destination directory: $destination"
        try {
            Remove-Item -Path $destination -Recurse -Force -ErrorAction Stop
            Write-Host "Successfully purged the destination directory."
        }
        catch {
            Write-Error "Failed to purge the destination directory: $destination"
            throw $_  # Exit the script if purge fails
        }
    }

    # Create the destination directory
    Write-Host "Creating destination directory: $destination"
    New-Item -ItemType Directory -Path $destination -Force | Out-Null

    # ------------------- Gather Items to Copy ------------------- #
    Write-Host "Retrieving items to copy..."
    $itemsToCopy = Get-ReleaseFiles -SourceRoot $source -Paths $releasePaths

    # Report the found items to copy
    Write-Host "Found $($itemsToCopy.Count) items to copy:"
    foreach ($item in $itemsToCopy) {
        $relativePath = Get-ReleaseRelativePath -SourceRoot $source -FullName $item.FullName
        Write-Host " - $relativePath"
    }

    # ------------------- Copy Items ------------------- #
    Write-Host "Starting copy process..."
    foreach ($item in $itemsToCopy) {
        # Determine the relative path and destination path for the current item
        $relativePath = Get-ReleaseRelativePath -SourceRoot $source -FullName $item.FullName
        $destPath = Join-Path $destination $relativePath

        # Ensure the destination directory exists, then copy the file.
        $destDir = Split-Path $destPath
        if (-not (Test-Path -LiteralPath $destDir)) {
            try {
                New-Item -ItemType Directory -Path $destDir -Force | Out-Null
                Write-Verbose "Created directory for file: $destDir"
            }
            catch {
                Write-Warning "Failed to create directory: $destDir"
                $failedCopies += $destDir
                continue
            }
        }

        try {
            Copy-Item -LiteralPath $item.FullName -Destination $destPath -Force -ErrorAction Stop
        }
        catch {
            Write-Warning "Failed to copy file: $relativePath"
            $failedCopies += $item.FullName
        }
    }

    # ------------------- Copy Errors Report ------------------- #
    if ($failedCopies.Count -gt 0) {
        Write-Host "`nCopy process completed with errors."
        Write-Host "The following items were not copied successfully:"
        foreach ($failed in $failedCopies) {
            Write-Host " - $failed"
        }
        throw "Release packaging aborted: $($failedCopies.Count) item(s) could not be copied."
    }
    else {
        Write-Host "`nAll items copied successfully."
    }

    # ------------------- Create ZIP Archive ------------------- #
    Write-Host "`nCreating ZIP archive..."
    Compress-Archive -Path "$destination\*" -DestinationPath $zipPath -Force
    Write-Host "ZIP archive created at: $zipPath"
    Test-ReleaseArchive -ArchivePath $zipPath -SourceRoot $source -SourceFiles $itemsToCopy

    # ------------------- Git Commit ------------------- #
    
    if ($doCommit -and $newVersion) {
        $commitMsg = "Version $newVersion"
        Write-Host "Committing changes with message: '$commitMsg'..."
        
        # Execute Git commands
        try {
            git -C $source add -- manifest.json
            if ($LASTEXITCODE -eq 0) {
                git -C $source commit -m "$commitMsg"
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "Git commit successful." -ForegroundColor Green
                }
                else {
                    Write-Warning "Git commit failed (perhaps nothing to commit?)"
                }
            }
            else {
                Write-Error "Git add failed."
            }
        }
        catch {
            Write-Warning "Git command execution failed. Ensure git is installed and available."
        }
    }
    elseif ($doCommit -and -not $newVersion) {
        Write-Warning "Commit was requested but new version was not generated. Skipping commit."
    }
}
catch {
    Write-Error "An unexpected error occurred: $_"
    exit 1  # Exit the script with an error code
}

# ------------------- Final Report and Exit ------------------- #
Write-Host "`nProcess completed."
Write-Host "Exiting in 2 seconds..."
Start-Sleep -Seconds 2
