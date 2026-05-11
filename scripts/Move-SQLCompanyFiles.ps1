#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess = $true)]   # enables native -WhatIf and -Confirm
param()

Set-StrictMode -Version Latest

# ============================================================
#  Move-SQLCompanyFiles.ps1  v1.1
#  Production Tool - SQL Company File Mover
#  Environment : Windows Server / Accounting System (Chashbashevet)
#  NEVER deletes files — only moves them
#
#  CLI usage:
#    .\Move-SQLCompanyFiles.ps1              # interactive (asks DRY-RUN or LIVE)
#    .\Move-SQLCompanyFiles.ps1 -WhatIf     # forces DRY-RUN without prompt
#    .\Move-SQLCompanyFiles.ps1 -Confirm    # asks per-file confirmation
# ============================================================

# ============================================================
#  CONFIGURATION
# ============================================================

$SourceFolders = @(
    "C:\Program Files\Microsoft SQL Server\MSSQL16.WIZSOFT\MSSQL\DATA",
    "C:\DatakeepSQLBackup\MNDC\WIZSOFT",
    "C:\hash\rep\BACKUP"
)

$DestinationFolder = "C:\Users\administrator.MN\Desktop\חברות שנמחקו"

# Case-insensitive extension matching (.BAK .bak .mdf .ldf)
$ValidExtensions = @(".BAK", ".bak", ".mdf", ".ldf")

$DesktopPath  = [Environment]::GetFolderPath("Desktop")
$RunTimestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$LogFilePath  = Join-Path $DesktopPath "SQLMove_Log_$RunTimestamp.txt"
$CsvFilePath  = Join-Path $DesktopPath "SQLMove_Report_$RunTimestamp.csv"

# ============================================================
#  COUNTERS
#  TotalMoved     = files physically moved (LIVE only)
#  TotalSimulated = files that would move  (DRY-RUN only)
# ============================================================

$Stats = [ordered]@{
    TotalRequested   = 0
    TotalMatched     = 0
    TotalMoved       = 0
    TotalSimulated   = 0
    TotalFailed      = 0
    TotalNotFound    = 0
    TotalRenamedDup  = 0
}

# ============================================================
#  BUFFERS
# ============================================================

$LogLines = [System.Collections.Generic.List[string]]::new()
$CsvRows  = [System.Collections.Generic.List[PSCustomObject]]::new()

# Track already-processed absolute paths to prevent double-move
# when the same file appears reachable from multiple source folders
$ProcessedPaths = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
)

# ============================================================
#  HELPER : Write-Log
# ============================================================

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet("INFO","SUCCESS","WARNING","ERROR")]
        [string]$Level = "INFO"
    )
    $ts   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts][$Level] $Message"
    $script:LogLines.Add($line)
    switch ($Level) {
        "SUCCESS" { Write-Host $line -ForegroundColor Green  }
        "WARNING" { Write-Host $line -ForegroundColor Yellow }
        "ERROR"   { Write-Host $line -ForegroundColor Red    }
        default   { Write-Host $line -ForegroundColor Cyan   }
    }
}

# ============================================================
#  HELPER : Write-Section
# ============================================================

function Write-Section {
    param([string]$Title)
    $sep = "=" * 65
    $script:LogLines.Add("")
    $script:LogLines.Add($sep)
    $script:LogLines.Add("   $Title")
    $script:LogLines.Add($sep)
    Write-Host ""
    Write-Host $sep            -ForegroundColor DarkGray
    Write-Host "   $Title"    -ForegroundColor White
    Write-Host $sep            -ForegroundColor DarkGray
}

# ============================================================
#  HELPER : Save-Log
# ============================================================

function Save-Log {
    try {
        $script:LogLines | Out-File -FilePath $script:LogFilePath -Encoding UTF8 -Force
    }
    catch {
        Write-Host "WARNING: Could not save log: $_" -ForegroundColor Yellow
    }
}

# ============================================================
#  HELPER : Add-CsvRow
# ============================================================

function Add-CsvRow {
    param(
        [string]$SearchName,
        [string]$FileName,
        [string]$SourcePath,
        [string]$DestinationPath,
        [string]$Status,
        [string]$Notes = ""
    )
    $script:CsvRows.Add([PSCustomObject]@{
        Timestamp       = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        SearchName      = $SearchName
        FileName        = $FileName
        SourcePath      = $SourcePath
        DestinationPath = $DestinationPath
        Status          = $Status
        Notes           = $Notes
    })
}

# ============================================================
#  HELPER : Build-MatchRegex
#
#  Creates ONE compiled regex that matches all search names at once.
#  Pattern per name:  ^NAME(_.*)?$   (case-insensitive)
#
#  Examples for name "ABC":
#    ABC        → match  (exact)
#    ABC_log    → match  (starts with ABC_)
#    ABC_Data   → match
#    ABC123     → no match
#    MYABC      → no match
#    TEST_ABC   → no match
#
#  NOTE: "ABC" will also match "ABC_DEF" — this is by design.
#  The rule is: files that BELONG to a company start with CompanyName
#  optionally followed by underscore. If you need stricter matching,
#  provide full prefixes (e.g. "ABC_DEF" instead of "ABC").
# ============================================================

function Build-MatchRegex {
    param([string[]]$Names)
    $escaped  = $Names | ForEach-Object { [regex]::Escape($_) }
    $combined = $escaped -join "|"
    # ^(NAME1|NAME2|NAME3)(_.*)?$
    return [regex]::new(
        "^($combined)(_.*)?$",
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor
        [System.Text.RegularExpressions.RegexOptions]::Compiled
    )
}

# ============================================================
#  HELPER : Get-MatchedName
#  Returns which search name matched the given baseName, or $null
# ============================================================

function Get-MatchedName {
    param(
        [string]$BaseName,
        [string[]]$SearchNames
    )
    foreach ($name in $SearchNames) {
        $cmp = [System.StringComparer]::OrdinalIgnoreCase
        if ($cmp.Equals($BaseName, $name) -or
            $BaseName.StartsWith($name + "_", [System.StringComparison]::OrdinalIgnoreCase)) {
            return $name
        }
    }
    return $null
}

# ============================================================
#  HELPER : Get-TimestampedDestPath
#  Injects timestamp + milliseconds before extension to prevent
#  any collision, even if two duplicates arrive in the same second.
#  e.g. ABC.bak  ->  ABC_2026-05-11_14-30-22-347.bak
# ============================================================

function Get-TimestampedDestPath {
    param([string]$DestPath)
    $dir  = [System.IO.Path]::GetDirectoryName($DestPath)
    $name = [System.IO.Path]::GetFileNameWithoutExtension($DestPath)
    $ext  = [System.IO.Path]::GetExtension($DestPath)
    $ts   = Get-Date -Format "yyyy-MM-dd_HH-mm-ss-fff"   # milliseconds prevent collision
    return Join-Path $dir "${name}_${ts}${ext}"
}

# ============================================================
#  HELPER : Test-DestinationInsideSource
#  Safety: prevent destination being a sub-path of any source
# ============================================================

function Test-DestinationInsideSource {
    param(
        [string]$Destination,
        [string[]]$Sources
    )
    $destNorm = $Destination.TrimEnd('\').ToLower()
    foreach ($src in $Sources) {
        $srcNorm = $src.TrimEnd('\').ToLower()
        if ($destNorm.StartsWith($srcNorm)) {
            return $true
        }
    }
    return $false
}

# ============================================================
#  MAIN
# ============================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8

Clear-Host
Write-Host ("=" * 65) -ForegroundColor DarkCyan
Write-Host "   SQL Company File Mover  —  Production Tool  v1.1" -ForegroundColor Cyan
Write-Host "   $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host ("=" * 65) -ForegroundColor DarkCyan
Write-Host ""

$StartTime = Get-Date
Write-Log "Script started"
Write-Log "Log  : $LogFilePath"
Write-Log "CSV  : $CsvFilePath"

# ----------------------------------------------------------
#  STEP 1 : DRY-RUN SELECTION
#  -WhatIf on the command line forces dry-run automatically.
# ----------------------------------------------------------

Write-Section "SELECT RUN MODE"

# $WhatIfPreference is set to $true when -WhatIf is passed on the CLI
if ($WhatIfPreference) {
    $IsDryRun = $true
    Write-Log "MODE: DRY-RUN  (forced by -WhatIf parameter)" "WARNING"
} else {
    Write-Host ""
    Write-Host "  [Y] DRY-RUN  — Simulation only. No files will be moved." -ForegroundColor Yellow
    Write-Host "  [N] LIVE     — Files WILL be moved for real."             -ForegroundColor Red
    Write-Host ""
    $dryInput = Read-Host "  Enter Y for Dry-Run, N for Live move"
    $IsDryRun = ($dryInput.Trim().ToUpper() -eq "Y")

    if ($IsDryRun) {
        Write-Log "MODE: DRY-RUN  (simulation — nothing will be moved)" "WARNING"
    } else {
        Write-Log "MODE: LIVE  (files WILL be physically moved)" "WARNING"
    }
}

# ----------------------------------------------------------
#  STEP 2 : COLLECT COMPANY / FILE NAMES
# ----------------------------------------------------------

Write-Section "ENTER COMPANY / FILE NAMES"
Write-Host ""
Write-Host "  Enter one name per line (the base file name, no extension)." -ForegroundColor White
Write-Host "  Press ENTER on an empty line when finished." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Example:" -ForegroundColor DarkGray
Write-Host "    ABC" -ForegroundColor DarkGray
Write-Host "    MOSHE" -ForegroundColor DarkGray
Write-Host "    TEST123" -ForegroundColor DarkGray
Write-Host "    <ENTER>" -ForegroundColor DarkGray
Write-Host ""

$SearchNames = [System.Collections.Generic.List[string]]::new()

while ($true) {
    $raw = Read-Host "  Name"
    if ([string]::IsNullOrWhiteSpace($raw)) { break }
    $trimmed = $raw.Trim()
    if ($SearchNames.Contains($trimmed)) {
        Write-Host "  -> Duplicate entry, skipped: $trimmed" -ForegroundColor Yellow
    } else {
        $SearchNames.Add($trimmed)
        Write-Host "  -> Added: $trimmed" -ForegroundColor Green
    }
}

if ($SearchNames.Count -eq 0) {
    Write-Log "No names entered. Exiting." "ERROR"
    Save-Log
    exit 1
}

$Stats.TotalRequested = $SearchNames.Count
Write-Log "Names entered ($($Stats.TotalRequested)): $($SearchNames -join ' | ')"

# Build ONE compiled regex for all names (O(files) scan instead of O(files × names))
$MatchRegex = Build-MatchRegex -Names $SearchNames.ToArray()

# ----------------------------------------------------------
#  STEP 3 : VALIDATE PATHS
# ----------------------------------------------------------

Write-Section "VALIDATING PATHS"

# Safety: destination must not be inside any source folder
if (Test-DestinationInsideSource -Destination $DestinationFolder -Sources $SourceFolders) {
    Write-Log "FATAL: Destination folder is inside a source folder. Aborting." "ERROR"
    Save-Log
    exit 1
}

foreach ($folder in $SourceFolders) {
    if (Test-Path -LiteralPath $folder) {
        Write-Log "Source OK   : $folder" "SUCCESS"
    } else {
        Write-Log "Source MISSING (will be skipped): $folder" "WARNING"
    }
}

if (-not (Test-Path -LiteralPath $DestinationFolder)) {
    if ($IsDryRun) {
        Write-Log "[DRY-RUN] Would create destination: $DestinationFolder" "WARNING"
    } else {
        try {
            New-Item -ItemType Directory -Path $DestinationFolder -Force | Out-Null
            Write-Log "Created destination folder: $DestinationFolder" "SUCCESS"
        }
        catch {
            Write-Log "FATAL: Cannot create destination folder: $_" "ERROR"
            Save-Log
            exit 1
        }
    }
} else {
    Write-Log "Destination : $DestinationFolder" "SUCCESS"
}

# ----------------------------------------------------------
#  STEP 4 : SCAN SOURCE FOLDERS
#  Uses the combined regex for a single O(files) pass.
#  HashSet prevents double-processing files reachable via
#  multiple overlapping source paths.
# ----------------------------------------------------------

Write-Section "SCANNING SOURCE FOLDERS"

# name → list of matching FileInfo objects
$MatchedFiles = @{}
foreach ($name in $SearchNames) {
    $MatchedFiles[$name] = [System.Collections.Generic.List[System.IO.FileInfo]]::new()
}

$TotalScanned = 0

foreach ($sourceFolder in $SourceFolders) {

    if (-not (Test-Path -LiteralPath $sourceFolder)) {
        Write-Log "Skipping missing folder: $sourceFolder" "WARNING"
        continue
    }

    Write-Log "Scanning: $sourceFolder"

    try {
        $allFiles = Get-ChildItem -LiteralPath $sourceFolder -Recurse -File -ErrorAction SilentlyContinue

        foreach ($file in $allFiles) {

            if ($ValidExtensions -notcontains $file.Extension) { continue }

            $TotalScanned++

            # Skip if already matched from another source path
            if ($ProcessedPaths.Contains($file.FullName)) {
                Write-Log "Skipping duplicate path (already queued): $($file.FullName)" "WARNING"
                continue
            }

            $baseName    = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
            $regexMatch  = $MatchRegex.IsMatch($baseName)

            if ($regexMatch) {
                # Find exact name responsible for this match
                $matchedName = Get-MatchedName -BaseName $baseName -SearchNames $SearchNames.ToArray()
                if ($null -ne $matchedName) {
                    $null = $ProcessedPaths.Add($file.FullName)
                    $MatchedFiles[$matchedName].Add($file)
                    Write-Log "  FOUND [$matchedName]: $($file.FullName)" "SUCCESS"
                    $Stats.TotalMatched++
                }
            }
        }
    }
    catch {
        Write-Log "Error scanning '$sourceFolder': $_" "ERROR"
    }
}

Write-Log "Scan complete. Scanned: $TotalScanned | Matched: $($Stats.TotalMatched)"

foreach ($name in $SearchNames) {
    if ($MatchedFiles[$name].Count -eq 0) {
        Write-Log "NOT FOUND: No files matched for '$name'" "WARNING"
        $Stats.TotalNotFound++
        Add-CsvRow -SearchName $name -FileName "" -SourcePath "" `
                   -DestinationPath "" -Status "NOT_FOUND" `
                   -Notes "No matching files in any source folder"
    }
}

# ----------------------------------------------------------
#  STEP 5 : PREVIEW + CONFIRMATION
# ----------------------------------------------------------

Write-Section "FILES TO BE MOVED — PREVIEW"

if ($Stats.TotalMatched -eq 0) {
    Write-Log "No files found. Nothing to move." "WARNING"
    Save-Log
    exit 0
}

foreach ($name in $SearchNames) {
    if ($MatchedFiles[$name].Count -gt 0) {
        Write-Host ""
        Write-Host "  [$name]  ($($MatchedFiles[$name].Count) file(s))" -ForegroundColor White
        foreach ($f in $MatchedFiles[$name]) {
            Write-Host "    $($f.FullName)" -ForegroundColor Cyan
        }
    }
}

Write-Host ""

if ($IsDryRun) {
    Write-Host "  [DRY-RUN] These files WOULD be moved to:" -ForegroundColor Yellow
    Write-Host "  $DestinationFolder" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  No confirmation needed in Dry-Run mode." -ForegroundColor DarkGray
} else {
    Write-Host "  The above $($Stats.TotalMatched) file(s) will be MOVED to:" -ForegroundColor White
    Write-Host "  $DestinationFolder" -ForegroundColor Cyan
    Write-Host ""
    Write-Host ("  " + ("!" * 55)) -ForegroundColor Red
    Write-Host "  Type  YES  (all caps) to confirm the move:" -ForegroundColor Yellow
    Write-Host ("  " + ("!" * 55)) -ForegroundColor Red
    Write-Host ""
    $confirm = Read-Host "  Confirm"
    if ($confirm.Trim() -ne "YES") {
        Write-Log "Operation cancelled by user (typed: '$confirm')." "WARNING"
        Save-Log
        exit 0
    }
    Write-Log "User confirmed the move operation." "SUCCESS"
}

# ----------------------------------------------------------
#  STEP 6 : MOVE FILES
# ----------------------------------------------------------

Write-Section "$(if ($IsDryRun) {'[DRY-RUN] SIMULATING MOVE'} else {'MOVING FILES'})"

$totalToMove  = $Stats.TotalMatched
$currentIndex = 0

foreach ($name in $SearchNames) {
    foreach ($file in $MatchedFiles[$name]) {

        $currentIndex++
        $pct = [int](($currentIndex / $totalToMove) * 100)
        Write-Progress `
            -Activity "$(if ($IsDryRun) {'[DRY-RUN] Simulating'} else {'Moving'}) files" `
            -Status   "$currentIndex of $totalToMove : $($file.Name)" `
            -PercentComplete $pct

        $destPath   = Join-Path $DestinationFolder $file.Name
        $renamedDup = $false

        # Safety: never move a file onto itself
        if ($destPath -eq $file.FullName) {
            Write-Log "SKIPPED (source equals destination): $($file.FullName)" "WARNING"
            Add-CsvRow -SearchName $name -FileName $file.Name `
                       -SourcePath $file.FullName -DestinationPath $destPath `
                       -Status "SKIPPED_SELF" -Notes "Source and destination are identical"
            $Stats.TotalFailed++
            continue
        }

        # Handle duplicate at destination — add timestamp+ms to avoid any collision
        if (Test-Path -LiteralPath $destPath) {
            $destPath   = Get-TimestampedDestPath -DestPath $destPath
            $renamedDup = $true
            $Stats.TotalRenamedDup++
            Write-Log "Duplicate handled: '$($file.Name)' -> '$(Split-Path $destPath -Leaf)'" "WARNING"
        }

        $dupNote = if ($renamedDup) { "Renamed — duplicate existed in destination" } else { "" }

        if ($IsDryRun) {
            # DRY-RUN: simulate only, count separately from TotalMoved
            Write-Log "[DRY-RUN] WOULD MOVE: $($file.FullName)  ->  $destPath" "SUCCESS"
            Add-CsvRow -SearchName $name -FileName $file.Name `
                       -SourcePath $file.FullName -DestinationPath $destPath `
                       -Status "DRY_RUN" -Notes $dupNote
            $Stats.TotalSimulated++

        } else {
            # LIVE: use ShouldProcess so -WhatIf / -Confirm CLI flags work at file level
            if ($PSCmdlet.ShouldProcess($file.FullName, "Move to $destPath")) {
                try {
                    Move-Item -LiteralPath $file.FullName -Destination $destPath -ErrorAction Stop
                    Write-Log "MOVED: $($file.FullName)  ->  $destPath" "SUCCESS"
                    Add-CsvRow -SearchName $name -FileName $file.Name `
                               -SourcePath $file.FullName -DestinationPath $destPath `
                               -Status "MOVED" -Notes $dupNote
                    $Stats.TotalMoved++
                }
                catch [System.IO.IOException] {
                    # File locked by SQL Server or another process
                    $errMsg = $_.Exception.Message
                    Write-Log "LOCKED/IO ERROR: $($file.FullName) | $errMsg" "ERROR"
                    Add-CsvRow -SearchName $name -FileName $file.Name `
                               -SourcePath $file.FullName -DestinationPath $destPath `
                               -Status "FAILED_LOCKED" -Notes $errMsg
                    $Stats.TotalFailed++
                }
                catch [System.UnauthorizedAccessException] {
                    $errMsg = $_.Exception.Message
                    Write-Log "PERMISSION ERROR: $($file.FullName) | $errMsg" "ERROR"
                    Add-CsvRow -SearchName $name -FileName $file.Name `
                               -SourcePath $file.FullName -DestinationPath $destPath `
                               -Status "FAILED_PERMISSION" -Notes $errMsg
                    $Stats.TotalFailed++
                }
                catch {
                    $errMsg = $_.Exception.Message
                    Write-Log "UNEXPECTED ERROR: $($file.FullName) | $errMsg" "ERROR"
                    Add-CsvRow -SearchName $name -FileName $file.Name `
                               -SourcePath $file.FullName -DestinationPath $destPath `
                               -Status "FAILED_UNKNOWN" -Notes $errMsg
                    $Stats.TotalFailed++
                }
            }
        }
    }
}

Write-Progress -Activity "Moving files" -Completed

# ----------------------------------------------------------
#  STEP 7 : SUMMARY
# ----------------------------------------------------------

$EndTime  = Get-Date
$Duration = $EndTime - $StartTime

Write-Section "SUMMARY"

$modeLabel = if ($IsDryRun) { 'DRY-RUN (simulation — nothing was moved)' } else { 'LIVE' }

$summaryBlock = @"

  Run mode            : $modeLabel
  Start time          : $($StartTime.ToString('yyyy-MM-dd HH:mm:ss'))
  End time            : $($EndTime.ToString('yyyy-MM-dd HH:mm:ss'))
  Duration            : $([int]$Duration.TotalSeconds) second(s)

  Names requested     : $($Stats.TotalRequested)
  Files matched       : $($Stats.TotalMatched)
  Files moved (live)  : $($Stats.TotalMoved)
  Files simulated     : $($Stats.TotalSimulated)
  Files failed        : $($Stats.TotalFailed)
  Names not found     : $($Stats.TotalNotFound)
  Duplicates renamed  : $($Stats.TotalRenamedDup)

  Destination folder  : $DestinationFolder
  Log file            : $LogFilePath
  CSV report          : $CsvFilePath
"@

$script:LogLines.Add($summaryBlock)
Write-Host $summaryBlock -ForegroundColor White

Write-Host ""
Write-Host ("  " + ("-" * 40)) -ForegroundColor DarkGray
if ($IsDryRun) {
    Write-Host "  Simulated : $($Stats.TotalSimulated)" -ForegroundColor Yellow
} else {
    Write-Host "  Moved     : $($Stats.TotalMoved)"     -ForegroundColor Green
}
Write-Host "  Failed    : $($Stats.TotalFailed)"   -ForegroundColor $(if ($Stats.TotalFailed   -gt 0) { "Red"    } else { "Green" })
Write-Host "  Missing   : $($Stats.TotalNotFound)" -ForegroundColor $(if ($Stats.TotalNotFound -gt 0) { "Yellow" } else { "Green" })
Write-Host ""

# ----------------------------------------------------------
#  STEP 8 : SAVE LOG + CSV
# ----------------------------------------------------------

Save-Log
Write-Log "Log  saved : $LogFilePath" "SUCCESS"

try {
    $CsvRows | Export-Csv -Path $CsvFilePath -NoTypeInformation -Encoding UTF8
    Write-Log "CSV  saved : $CsvFilePath" "SUCCESS"
}
catch {
    Write-Log "Could not save CSV report: $_" "ERROR"
}

# ----------------------------------------------------------
#  STEP 9 : OPEN LOG
# ----------------------------------------------------------

Write-Host ""
Write-Host "  Open log file in Notepad now? [Y/N]: " -ForegroundColor Yellow -NoNewline
$openLog = Read-Host
if ($openLog.Trim().ToUpper() -eq "Y") {
    try { Start-Process notepad.exe -ArgumentList $LogFilePath }
    catch { Write-Host "  Could not open Notepad: $_" -ForegroundColor Red }
}

Write-Host ""
Write-Host ("=" * 65) -ForegroundColor DarkCyan
Write-Host "  Script finished." -ForegroundColor Cyan
Write-Host ("=" * 65) -ForegroundColor DarkCyan
Write-Host ""
