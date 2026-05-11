#Requires -Version 5.1
Set-StrictMode -Version Latest

# ============================================================
#  Move-SQLCompanyFiles.ps1
#  Production Tool - SQL Company File Mover
#  Environment : Windows Server / Accounting System (Chashbashevet)
#  Purpose     : Safely MOVE company SQL files to archive folder
#  NEVER deletes files - only moves them
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

# Case-insensitive extension matching (covers .BAK .bak .mdf .ldf)
$ValidExtensions = @(".BAK", ".bak", ".mdf", ".ldf")

$DesktopPath = [Environment]::GetFolderPath("Desktop")
$RunTimestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$LogFilePath  = Join-Path $DesktopPath "SQLMove_Log_$RunTimestamp.txt"
$CsvFilePath  = Join-Path $DesktopPath "SQLMove_Report_$RunTimestamp.csv"

# ============================================================
#  COUNTERS
# ============================================================

$Stats = [ordered]@{
    TotalRequested       = 0
    TotalMatched         = 0
    TotalMoved           = 0
    TotalFailed          = 0
    TotalNotFound        = 0
    TotalRenamedDup      = 0
}

# ============================================================
#  LOG BUFFER  (written to file at the end)
# ============================================================

$LogLines = [System.Collections.Generic.List[string]]::new()
$CsvRows  = [System.Collections.Generic.List[PSCustomObject]]::new()

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
#  HELPER : Write-Section  (visual separator)
# ============================================================

function Write-Section {
    param([string]$Title)
    $sep = "=" * 65
    $script:LogLines.Add("")
    $script:LogLines.Add($sep)
    $script:LogLines.Add("   $Title")
    $script:LogLines.Add($sep)
    Write-Host ""
    Write-Host $sep -ForegroundColor DarkGray
    Write-Host "   $Title" -ForegroundColor White
    Write-Host $sep -ForegroundColor DarkGray
}

# ============================================================
#  HELPER : Save-Log  (flush buffer to disk)
# ============================================================

function Save-Log {
    try {
        $script:LogLines | Out-File -FilePath $script:LogFilePath -Encoding UTF8 -Force
    }
    catch {
        Write-Host "WARNING: Could not save log file: $_" -ForegroundColor Yellow
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
#  HELPER : Test-FileMatch
#
#  Rules:
#    "ABC" matches  -> ABC.bak  ABC.mdf  ABC_log.ldf  ABC_Data.mdf
#    "ABC" does NOT -> ABC123.bak  MYABC.bak  TEST_ABC.bak
#
#  Logic: baseName == searchTerm  OR  baseName starts with searchTerm + "_"
# ============================================================

function Test-FileMatch {
    param(
        [string]$BaseName,    # filename WITHOUT extension
        [string]$SearchTerm
    )
    # Use OrdinalIgnoreCase so ABC matches Abc etc.
    $cmp = [System.StringComparer]::OrdinalIgnoreCase
    return (
        $cmp.Equals($BaseName, $SearchTerm) -or
        $BaseName.StartsWith($SearchTerm + "_", [System.StringComparison]::OrdinalIgnoreCase)
    )
}

# ============================================================
#  HELPER : Get-TimestampedDestPath
#  If destination already exists, inject timestamp before extension
#  e.g.  ABC.bak  ->  ABC_2026-05-11_14-30-22.bak
# ============================================================

function Get-TimestampedDestPath {
    param([string]$DestPath)
    $dir  = [System.IO.Path]::GetDirectoryName($DestPath)
    $name = [System.IO.Path]::GetFileNameWithoutExtension($DestPath)
    $ext  = [System.IO.Path]::GetExtension($DestPath)
    $ts   = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
    return Join-Path $dir "${name}_${ts}${ext}"
}

# ============================================================
#  MAIN
# ============================================================

# Force UTF-8 so Hebrew displays correctly in console
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8

Clear-Host
Write-Host ("=" * 65) -ForegroundColor DarkCyan
Write-Host "   SQL Company File Mover  -  Production Tool" -ForegroundColor Cyan
Write-Host "   $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host ("=" * 65) -ForegroundColor DarkCyan
Write-Host ""

$StartTime = Get-Date
Write-Log "Script started"
Write-Log "Log  : $LogFilePath"
Write-Log "CSV  : $CsvFilePath"

# ----------------------------------------------------------
#  STEP 1 : DRY-RUN SELECTION
# ----------------------------------------------------------

Write-Section "SELECT RUN MODE"
Write-Host ""
Write-Host "  [Y] DRY-RUN  - Simulation only. No files will be moved." -ForegroundColor Yellow
Write-Host "  [N] LIVE     - Files WILL be moved for real."            -ForegroundColor Red
Write-Host ""

$dryInput = Read-Host "  Enter Y for Dry-Run, N for Live move"
$IsDryRun = ($dryInput.Trim().ToUpper() -eq "Y")

if ($IsDryRun) {
    Write-Log "MODE: DRY-RUN  (simulation - nothing will be moved)" "WARNING"
} else {
    Write-Log "MODE: LIVE  (files WILL be physically moved)" "WARNING"
}

# ----------------------------------------------------------
#  STEP 2 : COLLECT COMPANY / FILE NAMES
# ----------------------------------------------------------

Write-Section "ENTER COMPANY / FILE NAMES"
Write-Host ""
Write-Host "  Enter one name per line." -ForegroundColor White
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
        Write-Host "  -> Duplicate, skipped: $trimmed" -ForegroundColor Yellow
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

# ----------------------------------------------------------
#  STEP 3 : VALIDATE SOURCE AND DESTINATION PATHS
# ----------------------------------------------------------

Write-Section "VALIDATING PATHS"

foreach ($folder in $SourceFolders) {
    if (Test-Path -LiteralPath $folder) {
        Write-Log "Source OK   : $folder" "SUCCESS"
    } else {
        Write-Log "Source MISSING (will be skipped): $folder" "WARNING"
    }
}

# Create destination folder if missing
if (-not (Test-Path -LiteralPath $DestinationFolder)) {
    if ($IsDryRun) {
        Write-Log "[DRY-RUN] Would create destination: $DestinationFolder" "WARNING"
    } else {
        try {
            New-Item -ItemType Directory -Path $DestinationFolder -Force | Out-Null
            Write-Log "Created destination folder: $DestinationFolder" "SUCCESS"
        }
        catch {
            Write-Log "FATAL: Cannot create destination folder: $DestinationFolder | $_" "ERROR"
            Save-Log
            exit 1
        }
    }
} else {
    Write-Log "Destination : $DestinationFolder" "SUCCESS"
}

# ----------------------------------------------------------
#  STEP 4 : SCAN ALL SOURCE FOLDERS
# ----------------------------------------------------------

Write-Section "SCANNING SOURCE FOLDERS"

# Initialize match lists per name
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

            # Filter by valid extensions (case-sensitive list covers all cases)
            if ($ValidExtensions -notcontains $file.Extension) { continue }

            $TotalScanned++
            $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)

            foreach ($name in $SearchNames) {
                if (Test-FileMatch -BaseName $baseName -SearchTerm $name) {
                    $MatchedFiles[$name].Add($file)
                    Write-Log "  FOUND [$name]: $($file.FullName)" "SUCCESS"
                    $Stats.TotalMatched++
                }
            }
        }
    }
    catch {
        Write-Log "Error scanning folder '$sourceFolder': $_" "ERROR"
    }
}

Write-Log "Scan complete. Files scanned: $TotalScanned | Matched: $($Stats.TotalMatched)"

# Mark names with zero matches
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
#  STEP 5 : PREVIEW AND CONFIRMATION
# ----------------------------------------------------------

Write-Section "FILES TO BE MOVED - PREVIEW"

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
        Write-Log "Operation cancelled by user (confirmation not received)." "WARNING"
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

        # Progress bar
        $pct = [int](($currentIndex / $totalToMove) * 100)
        Write-Progress `
            -Activity "$(if ($IsDryRun) {'[DRY-RUN] Simulating'} else {'Moving'}) files" `
            -Status   "$currentIndex of $totalToMove : $($file.Name)" `
            -PercentComplete $pct

        $destPath       = Join-Path $DestinationFolder $file.Name
        $renamedDup     = $false

        # Handle duplicate destination filename
        if (Test-Path -LiteralPath $destPath) {
            $destPath   = Get-TimestampedDestPath -DestPath $destPath
            $renamedDup = $true
            $Stats.TotalRenamedDup++
            Write-Log "Duplicate handled: '$($file.Name)' -> '$(Split-Path $destPath -Leaf)'" "WARNING"
        }

        $dupNote = if ($renamedDup) { "Renamed - duplicate existed in destination" } else { "" }

        if ($IsDryRun) {
            # Simulate only
            Write-Log "[DRY-RUN] WOULD MOVE: $($file.FullName)  ->  $destPath" "SUCCESS"
            Add-CsvRow -SearchName $name -FileName $file.Name `
                       -SourcePath $file.FullName -DestinationPath $destPath `
                       -Status "DRY_RUN" -Notes $dupNote
            $Stats.TotalMoved++

        } else {
            try {
                Move-Item -LiteralPath $file.FullName -Destination $destPath -ErrorAction Stop
                Write-Log "MOVED: $($file.FullName)  ->  $destPath" "SUCCESS"
                Add-CsvRow -SearchName $name -FileName $file.Name `
                           -SourcePath $file.FullName -DestinationPath $destPath `
                           -Status "MOVED" -Notes $dupNote
                $Stats.TotalMoved++
            }
            catch [System.IO.IOException] {
                # File is likely locked by SQL Server
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

Write-Progress -Activity "Moving files" -Completed

# ----------------------------------------------------------
#  STEP 7 : SUMMARY
# ----------------------------------------------------------

$EndTime  = Get-Date
$Duration = $EndTime - $StartTime

Write-Section "SUMMARY"

$summaryBlock = @"

  Run mode            : $(if ($IsDryRun) { 'DRY-RUN (simulation)' } else { 'LIVE' })
  Start time          : $($StartTime.ToString('yyyy-MM-dd HH:mm:ss'))
  End time            : $($EndTime.ToString('yyyy-MM-dd HH:mm:ss'))
  Duration            : $([int]$Duration.TotalSeconds) second(s)

  Names requested     : $($Stats.TotalRequested)
  Files matched       : $($Stats.TotalMatched)
  Files moved         : $($Stats.TotalMoved)
  Files failed        : $($Stats.TotalFailed)
  Names not found     : $($Stats.TotalNotFound)
  Duplicates renamed  : $($Stats.TotalRenamedDup)

  Destination folder  : $DestinationFolder
  Log file            : $LogFilePath
  CSV report          : $CsvFilePath
"@

$script:LogLines.Add($summaryBlock)
Write-Host $summaryBlock -ForegroundColor White

# Color-coded status line
Write-Host ""
Write-Host "  Moved   : $($Stats.TotalMoved)" -ForegroundColor Green
Write-Host "  Failed  : $($Stats.TotalFailed)"  -ForegroundColor $(if ($Stats.TotalFailed  -gt 0) { "Red"    } else { "Green" })
Write-Host "  Missing : $($Stats.TotalNotFound)" -ForegroundColor $(if ($Stats.TotalNotFound -gt 0) { "Yellow" } else { "Green" })
Write-Host ""

# ----------------------------------------------------------
#  STEP 8 : SAVE LOG + CSV
# ----------------------------------------------------------

Save-Log
Write-Log "Log  saved: $LogFilePath" "SUCCESS"

try {
    $CsvRows | Export-Csv -Path $CsvFilePath -NoTypeInformation -Encoding UTF8
    Write-Log "CSV  saved: $CsvFilePath" "SUCCESS"
}
catch {
    Write-Log "Could not save CSV report: $_" "ERROR"
}

# ----------------------------------------------------------
#  STEP 9 : OFFER TO OPEN LOG
# ----------------------------------------------------------

Write-Host ""
Write-Host "  Open log file in Notepad now? [Y/N]: " -ForegroundColor Yellow -NoNewline
$openLog = Read-Host
if ($openLog.Trim().ToUpper() -eq "Y") {
    try {
        Start-Process notepad.exe -ArgumentList $LogFilePath
    }
    catch {
        Write-Host "  Could not open Notepad: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host ("=" * 65) -ForegroundColor DarkCyan
Write-Host "  Script finished." -ForegroundColor Cyan
Write-Host ("=" * 65) -ForegroundColor DarkCyan
Write-Host ""
