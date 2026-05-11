#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess = $true)]
param()

Set-StrictMode -Version Latest

# ============================================================
#  Move-SQLCompanyFiles.ps1  v1.5
#  SQL Company File Archiver
#  Safe Move Utility for WIZSOFT Environments
#  NEVER deletes files - only moves them
#
#  ENCODING: Save this file as UTF-8 WITH BOM
#  Notepad++  : Encoding -> "Encode in UTF-8 with BOM"
#  Notepad    : File -> Save As -> Encoding: "UTF-8 with BOM"
#  VS Code    : Ctrl+Shift+P -> "Change File Encoding" -> "UTF-8 with BOM"
#
#  CLI usage:
#    .\Move-SQLCompanyFiles.ps1            (interactive)
#    .\Move-SQLCompanyFiles.ps1 -WhatIf   (forces DRY-RUN)
#    .\Move-SQLCompanyFiles.ps1 -Confirm  (asks per-file)
# ============================================================

# ============================================================
#  CONFIGURATION
# ============================================================

$SourceFolders = @(
    "C:\Program Files\Microsoft SQL Server\MSSQL16.WIZSOFT\MSSQL\DATA",
    "C:\DatakeepSQLBackup\MNDC\WIZSOFT",
    "C:\hash\rep\BACKUP"
)

# Hebrew folder name built from Unicode code points so it is never
# corrupted by encoding mismatches when the script file is read.
# Unicode: chet(05D7) bet(05D1) resh(05E8) vav(05D5) tav(05EA)
#          shin(05E9) nun(05E0) mem(05DE) chet(05D7) qof(05E7) vav(05D5)
$_heb = [string][char[]]@(0x05D7,0x05D1,0x05E8,0x05D5,0x05EA,' ',
                           0x05E9,0x05E0,0x05DE,0x05D7,0x05E7,0x05D5)
$DestinationFolder = "C:\Users\administrator.MN\Desktop\$_heb"

$ValidExtensions = @(".BAK", ".bak", ".mdf", ".ldf")

$DesktopPath  = [Environment]::GetFolderPath("Desktop")
$RunTimestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"

# Unique run ID for auditing and cross-referencing logs
$RunId        = "RUN-" + (Get-Date -Format "yyyyMMdd-HHmmss") + "-" + `
                ([System.Guid]::NewGuid().ToString().Substring(0,4).ToUpper())

$LogFilePath  = Join-Path $DesktopPath "SQLMove_Log_$RunTimestamp.txt"
$CsvFilePath  = Join-Path $DesktopPath "SQLMove_Report_$RunTimestamp.csv"
$JsonFilePath = Join-Path $DesktopPath "SQLMove_Log_$RunTimestamp.json"

# Manifest written inside the destination folder after a live move
$ManifestPath = Join-Path $DestinationFolder "_manifest_$RunTimestamp.json"

# ============================================================
#  COUNTERS
# ============================================================

$Stats = [ordered]@{
    TotalRequested    = 0
    TotalMatched      = 0
    TotalMoved        = 0
    TotalSimulated    = 0
    TotalFailed       = 0
    TotalNotFound     = 0
    TotalRenamedDup   = 0
    TotalBytesMatched = 0L
    TotalBytesMoved   = 0L
}

# ============================================================
#  BUFFERS
# ============================================================

$LogLines = [System.Collections.Generic.List[string]]::new()
$CsvRows  = [System.Collections.Generic.List[PSCustomObject]]::new()
$JsonRows = [System.Collections.Generic.List[PSCustomObject]]::new()

$ProcessedPaths = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
)

# ============================================================
#  HELPER : Format-FileSize
# ============================================================

function Format-FileSize {
    param([long]$Bytes)
    if ($Bytes -ge 1GB) { return "{0:N2} GB" -f ($Bytes / 1GB) }
    if ($Bytes -ge 1MB) { return "{0:N2} MB" -f ($Bytes / 1MB) }
    if ($Bytes -ge 1KB) { return "{0:N2} KB" -f ($Bytes / 1KB) }
    return "$Bytes B"
}

# ============================================================
#  HELPER : Write-Log
#  Levels: INFO(Cyan)  SUCCESS(Green)  WARNING(Yellow)
#          ERROR(Red)  DRYRUN(Magenta)
# ============================================================

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet("INFO","SUCCESS","WARNING","ERROR","DRYRUN")]
        [string]$Level = "INFO"
    )
    $ts   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts][$Level] $Message"
    $script:LogLines.Add($line)
    switch ($Level) {
        "SUCCESS" { Write-Host $line -ForegroundColor Green   }
        "WARNING" { Write-Host $line -ForegroundColor Yellow  }
        "ERROR"   { Write-Host $line -ForegroundColor Red     }
        "DRYRUN"  { Write-Host $line -ForegroundColor Magenta }
        default   { Write-Host $line -ForegroundColor Cyan    }
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
    Write-Host $sep        -ForegroundColor DarkGray
    Write-Host "   $Title" -ForegroundColor White
    Write-Host $sep        -ForegroundColor DarkGray
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
        [long]$SizeBytes   = 0,
        [string]$Notes     = ""
    )
    $row = [PSCustomObject]@{
        Timestamp       = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        SearchName      = $SearchName
        FileName        = $FileName
        SourcePath      = $SourcePath
        DestinationPath = $DestinationPath
        Status          = $Status
        SizeBytes       = $SizeBytes
        SizeHuman       = Format-FileSize -Bytes $SizeBytes
        Notes           = $Notes
    }
    $script:CsvRows.Add($row)
    $script:JsonRows.Add($row)
}

# ============================================================
#  HELPER : Show-Header
#  Professional header shown after mode is selected.
# ============================================================

function Show-Header {
    param([bool]$IsDryRun)
    $mode      = if ($IsDryRun) { "DRY-RUN" } else { "LIVE" }
    $modeColor = if ($IsDryRun) { "Magenta" } else { "Red" }

    Clear-Host
    Write-Host ("=" * 55) -ForegroundColor DarkCyan
    Write-Host "  SQL COMPANY FILE ARCHIVER  v1.5" -ForegroundColor Cyan
    Write-Host ("=" * 55) -ForegroundColor DarkCyan
    Write-Host "  $script:RunId  |  $env:COMPUTERNAME  |  $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -ForegroundColor DarkGray
    Write-Host ("  Mode: " + $mode) -ForegroundColor $modeColor
    Write-Host ("=" * 55) -ForegroundColor DarkCyan
    Write-Host ""
}

# ============================================================
#  HELPER : Show-FileTable
#  Renders a preview table of all matched files.
#  Returns total bytes found.
# ============================================================

function Show-FileTable {
    param(
        [hashtable]$MatchedFiles,
        [string[]]$SearchNames
    )

    $divider = "-" * 76
    $header  = "  {0,-4} {1,-18} {2,-6} {3,-12} {4}" -f "#", "Company", "Ext", "Size", "Source folder"

    Write-Host ""
    Write-Host "  Found Files" -ForegroundColor White
    Write-Host "  $divider"   -ForegroundColor DarkGray
    Write-Host $header        -ForegroundColor White
    Write-Host "  $divider"   -ForegroundColor DarkGray

    $idx        = 0
    $totalBytes = 0L

    foreach ($name in $SearchNames) {
        foreach ($f in $MatchedFiles[$name]) {
            $idx++
            $totalBytes += $f.Length
            $size        = Format-FileSize -Bytes $f.Length
            $shortSrc    = Split-Path $f.DirectoryName -Leaf
            $row         = "  {0,-4} {1,-18} {2,-6} {3,-12} {4}" -f $idx, $name, $f.Extension, $size, $shortSrc
            Write-Host $row -ForegroundColor Cyan
        }
    }

    Write-Host "  $divider" -ForegroundColor DarkGray
    $totalLabel = "  Total Files : $idx    Total Size : $(Format-FileSize -Bytes $totalBytes)"
    Write-Host $totalLabel  -ForegroundColor White
    Write-Host "  $divider" -ForegroundColor DarkGray
    Write-Host ""

    return $totalBytes
}

# ============================================================
#  HELPER : Build-MatchRegex
#  Exact match: ^(NAME1|NAME2)$   (case-insensitive, compiled)
#  "ABC" matches ABC.bak / ABC.mdf  but NOT ABC_log.ldf
# ============================================================

function Build-MatchRegex {
    param([string[]]$Names)
    $escaped  = $Names | ForEach-Object { [regex]::Escape($_) }
    $combined = $escaped -join "|"
    return [regex]::new(
        "^($combined)$",
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor
        [System.Text.RegularExpressions.RegexOptions]::Compiled
    )
}

# ============================================================
#  HELPER : Get-MatchedName
# ============================================================

function Get-MatchedName {
    param([string]$BaseName, [string[]]$SearchNames)
    $cmp = [System.StringComparer]::OrdinalIgnoreCase
    foreach ($name in $SearchNames) {
        if ($cmp.Equals($BaseName, $name)) { return $name }
    }
    return $null
}

# ============================================================
#  HELPER : Get-TimestampedDestPath
#  ABC.bak -> ABC_2026-05-11_14-30-22-347.bak
# ============================================================

function Get-TimestampedDestPath {
    param([string]$DestPath)
    $dir  = [System.IO.Path]::GetDirectoryName($DestPath)
    $name = [System.IO.Path]::GetFileNameWithoutExtension($DestPath)
    $ext  = [System.IO.Path]::GetExtension($DestPath)
    $ts   = Get-Date -Format "yyyy-MM-dd_HH-mm-ss-fff"
    return Join-Path $dir "${name}_${ts}${ext}"
}

# ============================================================
#  HELPER : Test-DestinationInsideSource
# ============================================================

function Test-DestinationInsideSource {
    param([string]$Destination, [string[]]$Sources)
    $destNorm = $Destination.TrimEnd('\').ToLower()
    foreach ($src in $Sources) {
        if ($destNorm.StartsWith($src.TrimEnd('\').ToLower())) { return $true }
    }
    return $false
}

# ============================================================
#  MAIN
# ============================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8

# ----------------------------------------------------------
#  STEP 1 : MODE SELECTION  (before header so header shows mode)
# ----------------------------------------------------------

Clear-Host
Write-Host ("=" * 55) -ForegroundColor DarkCyan
Write-Host "  SQL COMPANY FILE ARCHIVER  v1.5" -ForegroundColor Cyan
Write-Host ("=" * 55) -ForegroundColor DarkCyan
Write-Host ""

$StartTime = Get-Date

if ($WhatIfPreference) {
    $IsDryRun = $true
} else {
    Write-Host "  [Y]  DRY-RUN  -  Simulation only. Nothing will move." -ForegroundColor Magenta
    Write-Host "  [N]  LIVE     -  Files WILL be moved for real."       -ForegroundColor Red
    Write-Host ""
    $dryInput = Read-Host "  Select mode (Y/N)"
    $IsDryRun = ($dryInput.Trim().ToUpper() -eq "Y")
}

# Now draw the full professional header
Show-Header -IsDryRun $IsDryRun

$modeLog = if ($IsDryRun) { "DRY-RUN" } else { "LIVE" }
Write-Log "Script started | Run ID: $RunId | Mode: $modeLog | Server: $env:COMPUTERNAME"
Write-Log "Log  : $LogFilePath"
Write-Log "CSV  : $CsvFilePath"
Write-Log "JSON : $JsonFilePath"

# ----------------------------------------------------------
#  STEP 2 : NUMBERED NAME INPUT
# ----------------------------------------------------------

Write-Section "ENTER COMPANY NAMES"
Write-Host ""
Write-Host "  Enter one company name per line." -ForegroundColor White
Write-Host "  Press ENTER on an empty line to start scanning." -ForegroundColor White
Write-Host ""
Write-Host "  Examples:" -ForegroundColor DarkGray
Write-Host "    RAWDA2020" -ForegroundColor DarkGray
Write-Host "    ABC" -ForegroundColor DarkGray
Write-Host "    MOSHE" -ForegroundColor DarkGray
Write-Host ""

$SearchNames = [System.Collections.Generic.List[string]]::new()

while ($true) {
    $idx = $SearchNames.Count + 1
    $raw = Read-Host "  Company Name [$idx]"
    if ([string]::IsNullOrWhiteSpace($raw)) { break }
    $trimmed = $raw.Trim()
    if ($SearchNames.Contains($trimmed)) {
        Write-Host "  [SKIP] Already added: $trimmed" -ForegroundColor Yellow
    } else {
        $SearchNames.Add($trimmed)
        Write-Host "  [OK] Added: $trimmed" -ForegroundColor Green
    }
}

if ($SearchNames.Count -eq 0) {
    Write-Log "No names entered. Exiting." "ERROR"
    Save-Log
    exit 1
}

Write-Host ""
Write-Host "  Starting scan..." -ForegroundColor Cyan

$Stats.TotalRequested = $SearchNames.Count
Write-Log "Names entered ($($Stats.TotalRequested)): $($SearchNames -join ' | ')"

$MatchRegex = Build-MatchRegex -Names $SearchNames.ToArray()

# ----------------------------------------------------------
#  STEP 3 : VALIDATE PATHS
# ----------------------------------------------------------

Write-Section "VALIDATING PATHS"

if (Test-DestinationInsideSource -Destination $DestinationFolder -Sources $SourceFolders) {
    Write-Log "FATAL: Destination is inside a source folder. Aborting." "ERROR"
    Save-Log
    exit 1
}

foreach ($folder in $SourceFolders) {
    if (Test-Path -LiteralPath $folder) {
        Write-Log "Source OK      : $folder" "SUCCESS"
    } else {
        Write-Log "Source MISSING : $folder (will be skipped)" "WARNING"
    }
}

if (-not (Test-Path -LiteralPath $DestinationFolder)) {
    if ($IsDryRun) {
        Write-Log "[DRY-RUN] Would create destination: $DestinationFolder" "DRYRUN"
    } else {
        try {
            New-Item -ItemType Directory -Path $DestinationFolder -Force | Out-Null
            Write-Log "Created destination: $DestinationFolder" "SUCCESS"
        }
        catch {
            Write-Log "FATAL: Cannot create destination folder: $_" "ERROR"
            Save-Log
            exit 1
        }
    }
} else {
    Write-Log "Destination OK : $DestinationFolder" "SUCCESS"
}

# ----------------------------------------------------------
#  STEP 4 : SCAN
# ----------------------------------------------------------

Write-Section "SCANNING SOURCE FOLDERS"

$MatchedFiles = @{}
foreach ($name in $SearchNames) {
    $MatchedFiles[$name] = [System.Collections.Generic.List[System.IO.FileInfo]]::new()
}

$TotalScanned = 0

foreach ($sourceFolder in $SourceFolders) {

    if (-not (Test-Path -LiteralPath $sourceFolder)) {
        Write-Host "  [SKIP] Folder not found: $sourceFolder" -ForegroundColor Yellow
        Write-Log "Skipping missing folder: $sourceFolder" "WARNING"
        continue
    }

    Write-Host "  [>>] $sourceFolder" -ForegroundColor Cyan
    Write-Log "Scanning: $sourceFolder"

    try {
        $allFiles = Get-ChildItem -LiteralPath $sourceFolder -Recurse -File -ErrorAction SilentlyContinue

        foreach ($file in $allFiles) {

            if ($ValidExtensions -notcontains $file.Extension) { continue }

            $TotalScanned++

            # Update progress bar every 50 files so user sees activity, not a freeze
            if ($TotalScanned % 50 -eq 0) {
                Write-Progress `
                    -Activity "Scanning..." `
                    -Status   "Checked: $TotalScanned  |  Matched: $($Stats.TotalMatched)  |  $($file.Name)" `
                    -CurrentOperation $file.FullName
            }

            if ($ProcessedPaths.Contains($file.FullName)) {
                Write-Log "Duplicate path skipped: $($file.FullName)" "WARNING"
                continue
            }

            $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)

            if ($MatchRegex.IsMatch($baseName)) {
                $matchedName = Get-MatchedName -BaseName $baseName -SearchNames $SearchNames.ToArray()
                if ($null -ne $matchedName) {
                    $null = $ProcessedPaths.Add($file.FullName)
                    $MatchedFiles[$matchedName].Add($file)
                    $Stats.TotalBytesMatched += $file.Length
                    Write-Log "  FOUND [$matchedName]: $($file.FullName)  ($(Format-FileSize -Bytes $file.Length))" "SUCCESS"
                    $Stats.TotalMatched++
                }
            }
        }
    }
    catch {
        Write-Log "Error scanning '$sourceFolder': $_" "ERROR"
    }
}

Write-Progress -Activity "Scanning folders..." -Completed
Write-Log "Scan complete. Scanned: $TotalScanned | Matched: $($Stats.TotalMatched) | Size: $(Format-FileSize -Bytes $Stats.TotalBytesMatched)"

foreach ($name in $SearchNames) {
    if ($MatchedFiles[$name].Count -eq 0) {
        Write-Log "NOT FOUND: '$name'" "WARNING"
        $Stats.TotalNotFound++
        Add-CsvRow -SearchName $name -FileName "" -SourcePath "" `
                   -DestinationPath "" -Status "NOT_FOUND" `
                   -Notes "No matching files in any source folder"
    }
}

# ----------------------------------------------------------
#  STEP 5 : PREVIEW TABLE + CONFIRMATION
# ----------------------------------------------------------

Write-Section "PREVIEW"

if ($Stats.TotalMatched -eq 0) {
    Write-Log "No files found. Nothing to move." "WARNING"
    Save-Log
    exit 0
}

$previewBytes = Show-FileTable -MatchedFiles $MatchedFiles -SearchNames $SearchNames.ToArray()

if ($IsDryRun) {
    Write-Host "  [DRY-RUN] The above files WOULD be moved to:" -ForegroundColor Magenta
    Write-Host "  $DestinationFolder" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "  No confirmation needed in DRY-RUN mode." -ForegroundColor DarkGray
} else {
    Write-Host "  Destination: $DestinationFolder" -ForegroundColor White
    Write-Host ""
    Write-Host ("  " + ("!" * 60)) -ForegroundColor Red
    Write-Host "  $($Stats.TotalMatched) files ($(Format-FileSize -Bytes $previewBytes)) will be MOVED." -ForegroundColor Yellow
    Write-Host "  Type  MOVE  to confirm, or press ENTER to cancel:" -ForegroundColor Yellow
    Write-Host ("  " + ("!" * 60)) -ForegroundColor Red
    Write-Host ""
    $confirm = Read-Host "  Confirm"
    if ($confirm.Trim().ToUpper() -ne "MOVE") {
        Write-Log "Operation cancelled by user (typed: '$confirm')." "WARNING"
        Save-Log
        exit 0
    }
    Write-Log "User confirmed with MOVE." "SUCCESS"
}

# ----------------------------------------------------------
#  STEP 6 : MOVE FILES
# ----------------------------------------------------------

$sectionLabel = if ($IsDryRun) { "[DRY-RUN] SIMULATING MOVE" } else { "MOVING FILES" }
Write-Section $sectionLabel

$totalToMove  = $Stats.TotalMatched
$currentIndex = 0

foreach ($name in $SearchNames) {
    foreach ($file in $MatchedFiles[$name]) {

        $currentIndex++
        $pct           = [int](($currentIndex / $totalToMove) * 100)
        $progressLabel = if ($IsDryRun) { "[DRY-RUN] Simulating" } else { "Moving" }
        Write-Progress `
            -Activity "$progressLabel files" `
            -Status   "$currentIndex of $totalToMove : $($file.Name)  ($(Format-FileSize -Bytes $file.Length))" `
            -PercentComplete $pct

        $destPath   = Join-Path $DestinationFolder $file.Name
        $renamedDup = $false

        # Safety: never move a file onto itself
        if ($destPath -eq $file.FullName) {
            Write-Log "SKIPPED (source = destination): $($file.FullName)" "WARNING"
            Add-CsvRow -SearchName $name -FileName $file.Name `
                       -SourcePath $file.FullName -DestinationPath $destPath `
                       -Status "SKIPPED_SELF" -SizeBytes $file.Length `
                       -Notes "Source and destination are identical"
            $Stats.TotalFailed++
            continue
        }

        # Duplicate handling
        if (Test-Path -LiteralPath $destPath) {
            $destPath   = Get-TimestampedDestPath -DestPath $destPath
            $renamedDup = $true
            $Stats.TotalRenamedDup++
            Write-Log "Duplicate -> renamed to: $(Split-Path $destPath -Leaf)" "WARNING"
        }

        $dupNote = if ($renamedDup) { "Renamed - duplicate existed in destination" } else { "" }

        if ($IsDryRun) {
            Write-Log "[DRY-RUN] WOULD MOVE: $($file.FullName)  ->  $destPath  ($(Format-FileSize -Bytes $file.Length))" "DRYRUN"
            Add-CsvRow -SearchName $name -FileName $file.Name `
                       -SourcePath $file.FullName -DestinationPath $destPath `
                       -Status "DRY_RUN" -SizeBytes $file.Length -Notes $dupNote
            $Stats.TotalSimulated++

        } else {
            if ($PSCmdlet.ShouldProcess($file.FullName, "Move to $destPath")) {
                try {
                    Move-Item -LiteralPath $file.FullName -Destination $destPath -ErrorAction Stop
                    Write-Log "MOVED: $($file.FullName)  ->  $destPath" "SUCCESS"
                    Add-CsvRow -SearchName $name -FileName $file.Name `
                               -SourcePath $file.FullName -DestinationPath $destPath `
                               -Status "MOVED" -SizeBytes $file.Length -Notes $dupNote
                    $Stats.TotalMoved++
                    $Stats.TotalBytesMoved += $file.Length
                }
                catch [System.IO.IOException] {
                    $errMsg = $_.Exception.Message
                    Write-Log "LOCKED/IO: $($file.FullName) | $errMsg" "ERROR"
                    Add-CsvRow -SearchName $name -FileName $file.Name `
                               -SourcePath $file.FullName -DestinationPath $destPath `
                               -Status "FAILED_LOCKED" -SizeBytes $file.Length -Notes $errMsg
                    $Stats.TotalFailed++
                }
                catch [System.UnauthorizedAccessException] {
                    $errMsg = $_.Exception.Message
                    Write-Log "PERMISSION: $($file.FullName) | $errMsg" "ERROR"
                    Add-CsvRow -SearchName $name -FileName $file.Name `
                               -SourcePath $file.FullName -DestinationPath $destPath `
                               -Status "FAILED_PERMISSION" -SizeBytes $file.Length -Notes $errMsg
                    $Stats.TotalFailed++
                }
                catch {
                    $errMsg = $_.Exception.Message
                    Write-Log "ERROR: $($file.FullName) | $errMsg" "ERROR"
                    Add-CsvRow -SearchName $name -FileName $file.Name `
                               -SourcePath $file.FullName -DestinationPath $destPath `
                               -Status "FAILED_UNKNOWN" -SizeBytes $file.Length -Notes $errMsg
                    $Stats.TotalFailed++
                }
            }
        }
    }
}

Write-Progress -Activity "Moving files" -Completed

# ----------------------------------------------------------
#  STEP 7 : SUMMARY BOX
# ----------------------------------------------------------

$EndTime   = Get-Date
$Duration  = $EndTime - $StartTime
$modeLabel = if ($IsDryRun) { "DRY-RUN (simulation - nothing was moved)" } else { "LIVE" }

$sep = "=" * 65
$script:LogLines.Add("")
$script:LogLines.Add($sep)
$script:LogLines.Add("   OPERATION SUMMARY")
$script:LogLines.Add($sep)

Write-Host ""
Write-Host $sep                    -ForegroundColor DarkCyan
Write-Host "   OPERATION SUMMARY"  -ForegroundColor Cyan
Write-Host $sep                    -ForegroundColor DarkCyan

$summaryLines = @(
    "  Run ID              : $RunId",
    "  Run mode            : $modeLabel",
    "  Server              : $env:COMPUTERNAME",
    "  Operator            : $env:USERNAME",
    "  Start time          : $($StartTime.ToString('yyyy-MM-dd HH:mm:ss'))",
    "  End time            : $($EndTime.ToString('yyyy-MM-dd HH:mm:ss'))",
    "  Duration            : $([int]$Duration.TotalSeconds) second(s)",
    "",
    "  Requested companies : $($Stats.TotalRequested)",
    "  Matched files       : $($Stats.TotalMatched)  ($(Format-FileSize -Bytes $Stats.TotalBytesMatched))",
    "  Moved successfully  : $($Stats.TotalMoved)  ($(Format-FileSize -Bytes $Stats.TotalBytesMoved))",
    "  Simulated (dry-run) : $($Stats.TotalSimulated)",
    "  Failed              : $($Stats.TotalFailed)",
    "  Not found           : $($Stats.TotalNotFound)",
    "  Duplicates renamed  : $($Stats.TotalRenamedDup)",
    "",
    "  Log  : $LogFilePath",
    "  CSV  : $CsvFilePath",
    "  JSON : $JsonFilePath"
)

foreach ($line in $summaryLines) {
    $script:LogLines.Add($line)
    Write-Host $line -ForegroundColor White
}

Write-Host $sep -ForegroundColor DarkCyan
Write-Host ""

# Color-coded totals
$movedColor   = if ($Stats.TotalMoved   -gt 0 -or $Stats.TotalSimulated -gt 0) { "Green"  } else { "White" }
$failColor    = if ($Stats.TotalFailed   -gt 0) { "Red"    } else { "Green" }
$missingColor = if ($Stats.TotalNotFound -gt 0) { "Yellow" } else { "Green" }

if ($IsDryRun) {
    Write-Host "  Simulated   : $($Stats.TotalSimulated)" -ForegroundColor Magenta
} else {
    Write-Host "  Moved       : $($Stats.TotalMoved)  ($(Format-FileSize -Bytes $Stats.TotalBytesMoved))" -ForegroundColor $movedColor
}
Write-Host "  Failed      : $($Stats.TotalFailed)"   -ForegroundColor $failColor
Write-Host "  Not found   : $($Stats.TotalNotFound)" -ForegroundColor $missingColor
Write-Host ""

# ----------------------------------------------------------
#  STEP 8 : SAVE TXT + CSV + JSON
# ----------------------------------------------------------

Save-Log
Write-Log "Log  saved : $LogFilePath" "SUCCESS"

try {
    $CsvRows | Export-Csv -Path $CsvFilePath -NoTypeInformation -Encoding UTF8
    Write-Log "CSV  saved : $CsvFilePath" "SUCCESS"
}
catch {
    Write-Log "Could not save CSV: $_" "ERROR"
}

$runInfo = [PSCustomObject]@{
    ScriptVersion = "1.4"
    RunId         = $RunId
    Server        = $env:COMPUTERNAME
    Operator      = $env:USERNAME
    Mode          = $modeLabel
    StartTime     = $StartTime.ToString("yyyy-MM-dd HH:mm:ss")
    EndTime       = $EndTime.ToString("yyyy-MM-dd HH:mm:ss")
    DurationSec   = [int]$Duration.TotalSeconds
    Destination   = $DestinationFolder
    SourceFolders = $SourceFolders
}

try {
    $jsonPayload = [PSCustomObject]@{
        RunInfo     = $runInfo
        SearchNames = $SearchNames.ToArray()
        Summary     = $Stats
        Files       = $JsonRows.ToArray()
    }
    $jsonPayload | ConvertTo-Json -Depth 5 |
        Out-File -FilePath $JsonFilePath -Encoding UTF8 -Force
    Write-Log "JSON saved : $JsonFilePath" "SUCCESS"
}
catch {
    Write-Log "Could not save JSON: $_" "ERROR"
}

# Write manifest.json inside the destination folder (only after a live move with results)
if (-not $IsDryRun -and $Stats.TotalMoved -gt 0) {
    try {
        $movedFiles = $JsonRows | Where-Object { $_.Status -eq "MOVED" }
        $manifest = [PSCustomObject]@{
            RunId         = $RunId
            MoveDate      = $EndTime.ToString("yyyy-MM-dd HH:mm:ss")
            Server        = $env:COMPUTERNAME
            Operator      = $env:USERNAME
            TotalFiles    = $Stats.TotalMoved
            TotalSizeMoved = Format-FileSize -Bytes $Stats.TotalBytesMoved
            Files         = $movedFiles
        }
        $manifest | ConvertTo-Json -Depth 5 |
            Out-File -FilePath $ManifestPath -Encoding UTF8 -Force
        Write-Log "Manifest   : $ManifestPath" "SUCCESS"
    }
    catch {
        Write-Log "Could not save manifest: $_" "ERROR"
    }
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
Write-Host "  Done." -ForegroundColor Cyan
Write-Host ("=" * 65) -ForegroundColor DarkCyan
Write-Host ""
