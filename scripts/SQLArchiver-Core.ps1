#Requires -Version 5.1
# SQLArchiver-Core.ps1
# Backend engine for SQL Company File Archiver
# Dot-source this file: . .\SQLArchiver-Core.ps1
# GUI and CLI both call the same functions defined here.

$script:SourceFolders = @(
    "C:\Program Files\Microsoft SQL Server\MSSQL16.WIZSOFT\MSSQL\DATA",
    "C:\DatakeepSQLBackup\MNDC\WIZSOFT",
    "C:\hash\rep\BACKUP"
)

$_h = [char[]]@(0x05D7,0x05D1,0x05E8,0x05D5,0x05EA,0x0020,
                0x05E9,0x05E0,0x05DE,0x05D7,0x05E7,0x05D5)
$script:DestinationFolder = "C:\Users\administrator.MN\Desktop\$([string]$_h)"

$script:ValidExtensions = @(".BAK", ".bak", ".mdf", ".ldf")

function Format-FileSize {
    param([long]$Bytes)
    if ($Bytes -ge 1GB) { return "{0:N2} GB" -f ($Bytes / 1GB) }
    if ($Bytes -ge 1MB) { return "{0:N2} MB" -f ($Bytes / 1MB) }
    if ($Bytes -ge 1KB) { return "{0:N2} KB" -f ($Bytes / 1KB) }
    return "$Bytes B"
}

function Build-MatchRegex {
    param([string[]]$Names)
    $combined = (@($Names) | ForEach-Object { [regex]::Escape($_) }) -join "|"
    return [regex]::new(
        "^($combined)$",
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor
        [System.Text.RegularExpressions.RegexOptions]::Compiled
    )
}

function Get-MatchedSearchName {
    param([string]$BaseName, [string[]]$SearchNames)
    $cmp = [System.StringComparer]::OrdinalIgnoreCase
    foreach ($n in @($SearchNames)) {
        if ($cmp.Equals($BaseName, $n)) { return $n }
    }
    return $null
}

function Get-TimestampedDestPath {
    param([string]$DestPath)
    $dir  = [System.IO.Path]::GetDirectoryName($DestPath)
    $name = [System.IO.Path]::GetFileNameWithoutExtension($DestPath)
    $ext  = [System.IO.Path]::GetExtension($DestPath)
    $ts   = Get-Date -Format "yyyy-MM-dd_HH-mm-ss-fff"
    return Join-Path $dir "${name}_${ts}${ext}"
}

function Test-DestinationInsideSource {
    param([string]$Destination, [string[]]$Sources)
    $d = $Destination.TrimEnd('\').ToLower()
    foreach ($s in $Sources) {
        if ($d.StartsWith($s.TrimEnd('\').ToLower())) { return $true }
    }
    return $false
}

function New-RunId {
    $ts   = Get-Date -Format "yyyyMMdd-HHmmss"
    $rand = [System.Guid]::NewGuid().ToString().Substring(0,4).ToUpper()
    return "RUN-$ts-$rand"
}

function Invoke-CompanyScan {
    param(
        [string[]]$Names,
        [scriptblock]$OnProgress = $null
    )

    $result = [PSCustomObject]@{
        MatchedFiles = @{}
        NotFound     = [System.Collections.Generic.List[string]]::new()
        TotalScanned = 0
        TotalMatched = 0
        TotalBytes   = 0L
        ScanErrors   = [System.Collections.Generic.List[string]]::new()
    }

    foreach ($n in $Names) {
        $result.MatchedFiles[$n] = [System.Collections.Generic.List[System.IO.FileInfo]]::new()
    }

    $seen       = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $matchRegex = Build-MatchRegex -Names $Names

    foreach ($folder in $script:SourceFolders) {
        if (-not (Test-Path -LiteralPath $folder)) { continue }
        try {
            $files = Get-ChildItem -LiteralPath $folder -Recurse -File -ErrorAction SilentlyContinue
            foreach ($file in $files) {
                if ($script:ValidExtensions -notcontains $file.Extension) { continue }
                $result.TotalScanned++
                if ($null -ne $OnProgress -and ($result.TotalScanned % 50 -eq 0)) {
                    & $OnProgress $result.TotalScanned $result.TotalMatched $file.Name
                }
                if ($seen.Contains($file.FullName)) { continue }
                $base = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
                if ($matchRegex.IsMatch($base)) {
                    $matched = Get-MatchedSearchName -BaseName $base -SearchNames $Names
                    if ($null -ne $matched) {
                        $null = $seen.Add($file.FullName)
                        $result.MatchedFiles[$matched].Add($file)
                        $result.TotalMatched++
                        $result.TotalBytes += $file.Length
                    }
                }
            }
        }
        catch {
            $result.ScanErrors.Add("$folder : $_")
        }
    }

    foreach ($n in $Names) {
        if ($result.MatchedFiles[$n].Count -eq 0) {
            $result.NotFound.Add($n)
        }
    }

    return $result
}

function Invoke-CompanyMove {
    param(
        [PSCustomObject]$ScanResult,
        [string[]]$SearchNames,
        [bool]$IsDryRun,
        [string]$RunId,
        [scriptblock]$OnProgress   = $null,
        [scriptblock]$OnFileResult = $null
    )

    $summary = [PSCustomObject]@{
        RunId           = $RunId
        IsDryRun        = $IsDryRun
        StartTime       = Get-Date
        EndTime         = $null
        TotalMoved      = 0
        TotalSimulated  = 0
        TotalFailed     = 0
        TotalBytesMoved = 0L
        FileResults     = [System.Collections.Generic.List[PSCustomObject]]::new()
    }

    if (-not $IsDryRun -and -not (Test-Path -LiteralPath $script:DestinationFolder)) {
        try {
            New-Item -ItemType Directory -Path $script:DestinationFolder -Force | Out-Null
        }
        catch {
            $summary.FileResults.Add([PSCustomObject]@{
                SearchName = ""
                FileName   = ""
                SourcePath = ""
                DestPath   = $script:DestinationFolder
                Status     = "FAILED_CREATE_DEST"
                SizeBytes  = 0L
                SizeHuman  = "0 B"
                Notes      = $_.Exception.Message
            })
            $summary.EndTime = Get-Date
            return $summary
        }
    }

    $total   = $ScanResult.TotalMatched
    $current = 0

    foreach ($name in $SearchNames) {
        foreach ($file in $ScanResult.MatchedFiles[$name]) {
            $current++
            if ($null -ne $OnProgress) { & $OnProgress $current $total $file.Name }

            $destPath   = Join-Path $script:DestinationFolder $file.Name
            $renamedDup = $false

            if ($destPath -eq $file.FullName) {
                $r = New-FileResult -Name $name -File $file -Dest $destPath `
                                    -Status "SKIPPED_SELF" -Notes "Source equals destination"
                $summary.FileResults.Add($r)
                $summary.TotalFailed++
                if ($null -ne $OnFileResult) { & $OnFileResult $r }
                continue
            }

            if (Test-Path -LiteralPath $destPath) {
                $destPath   = Get-TimestampedDestPath -DestPath $destPath
                $renamedDup = $true
            }

            $dupNote = if ($renamedDup) { "Renamed - duplicate in destination" } else { "" }

            if ($IsDryRun) {
                $r = New-FileResult -Name $name -File $file -Dest $destPath `
                                    -Status "DRY_RUN" -Notes $dupNote
                $summary.FileResults.Add($r)
                $summary.TotalSimulated++
                if ($null -ne $OnFileResult) { & $OnFileResult $r }
                continue
            }

            try {
                Move-Item -LiteralPath $file.FullName -Destination $destPath -ErrorAction Stop
                $r = New-FileResult -Name $name -File $file -Dest $destPath `
                                    -Status "MOVED" -Notes $dupNote
                $summary.TotalMoved++
                $summary.TotalBytesMoved += $file.Length
            }
            catch [System.IO.IOException] {
                $r = New-FileResult -Name $name -File $file -Dest $destPath `
                                    -Status "FAILED_LOCKED" -Notes $_.Exception.Message
                $summary.TotalFailed++
            }
            catch [System.UnauthorizedAccessException] {
                $r = New-FileResult -Name $name -File $file -Dest $destPath `
                                    -Status "FAILED_PERMISSION" -Notes $_.Exception.Message
                $summary.TotalFailed++
            }
            catch {
                $r = New-FileResult -Name $name -File $file -Dest $destPath `
                                    -Status "FAILED" -Notes $_.Exception.Message
                $summary.TotalFailed++
            }

            $summary.FileResults.Add($r)
            if ($null -ne $OnFileResult) { & $OnFileResult $r }
        }
    }

    $summary.EndTime = Get-Date
    return $summary
}

function New-FileResult {
    param(
        [string]$Name,
        [System.IO.FileInfo]$File,
        [string]$Dest,
        [string]$Status,
        [string]$Notes = ""
    )
    return [PSCustomObject]@{
        SearchName = $Name
        FileName   = $File.Name
        SourcePath = $File.FullName
        DestPath   = $Dest
        Status     = $Status
        SizeBytes  = $File.Length
        SizeHuman  = Format-FileSize -Bytes $File.Length
        Notes      = $Notes
        Timestamp  = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    }
}

function Save-RunLogs {
    param(
        [PSCustomObject]$MoveSummary,
        [PSCustomObject]$ScanResult,
        [string[]]$SearchNames,
        [string]$LogPath,
        [string]$CsvPath,
        [string]$JsonPath
    )

    $dur = $MoveSummary.EndTime - $MoveSummary.StartTime

    try {
        $lines = [System.Collections.Generic.List[string]]::new()
        $lines.Add("SQL Company File Archiver - Run Log")
        $lines.Add("=" * 60)
        $lines.Add("Run ID    : $($MoveSummary.RunId)")
        $lines.Add("Mode      : $(if ($MoveSummary.IsDryRun) { 'DRY-RUN' } else { 'LIVE' })")
        $lines.Add("Server    : $env:COMPUTERNAME")
        $lines.Add("Operator  : $env:USERNAME")
        $lines.Add("Start     : $($MoveSummary.StartTime.ToString('yyyy-MM-dd HH:mm:ss'))")
        $lines.Add("End       : $($MoveSummary.EndTime.ToString('yyyy-MM-dd HH:mm:ss'))")
        $lines.Add("Duration  : $([int]$dur.TotalSeconds)s")
        $lines.Add("Names     : $($SearchNames -join ', ')")
        $lines.Add("")
        $lines.Add("Matched   : $($ScanResult.TotalMatched)")
        $lines.Add("Moved     : $($MoveSummary.TotalMoved)  ($(Format-FileSize -Bytes $MoveSummary.TotalBytesMoved))")
        $lines.Add("Simulated : $($MoveSummary.TotalSimulated)")
        $lines.Add("Failed    : $($MoveSummary.TotalFailed)")
        $lines.Add("Not found : $($ScanResult.NotFound.Count)$(if ($ScanResult.NotFound.Count -gt 0){ ': ' + ($ScanResult.NotFound -join ', ') })")
        $lines.Add("")
        $lines.Add("FILE RESULTS")
        $lines.Add("-" * 60)
        foreach ($f in $MoveSummary.FileResults) {
            $lines.Add("[$($f.Status)] $($f.FileName)  ($($f.SizeHuman))")
            $lines.Add("  FROM : $($f.SourcePath)")
            $lines.Add("  TO   : $($f.DestPath)")
            if ($f.Notes) { $lines.Add("  NOTE : $($f.Notes)") }
            $lines.Add("")
        }
        $lines | Out-File -FilePath $LogPath -Encoding UTF8 -Force
    }
    catch {}

    try {
        $MoveSummary.FileResults | Export-Csv -Path $CsvPath -NoTypeInformation -Encoding UTF8
    }
    catch {}

    try {
        [PSCustomObject]@{
            RunInfo = [PSCustomObject]@{
                RunId         = $MoveSummary.RunId
                Mode          = if ($MoveSummary.IsDryRun) { "DRY-RUN" } else { "LIVE" }
                Server        = $env:COMPUTERNAME
                Operator      = $env:USERNAME
                StartTime     = $MoveSummary.StartTime.ToString("yyyy-MM-dd HH:mm:ss")
                EndTime       = $MoveSummary.EndTime.ToString("yyyy-MM-dd HH:mm:ss")
                DurationSec   = [int]$dur.TotalSeconds
                Destination   = $script:DestinationFolder
                SourceFolders = $script:SourceFolders
            }
            SearchNames = $SearchNames
            Summary     = [PSCustomObject]@{
                TotalMatched    = $ScanResult.TotalMatched
                TotalMoved      = $MoveSummary.TotalMoved
                TotalSimulated  = $MoveSummary.TotalSimulated
                TotalFailed     = $MoveSummary.TotalFailed
                TotalNotFound   = $ScanResult.NotFound.Count
                TotalBytesMoved = $MoveSummary.TotalBytesMoved
            }
            Files = $MoveSummary.FileResults
        } | ConvertTo-Json -Depth 5 | Out-File -FilePath $JsonPath -Encoding UTF8 -Force
    }
    catch {}
}

function Write-Manifest {
    param(
        [PSCustomObject]$MoveSummary,
        [string]$RunTimestamp
    )

    if ($MoveSummary.IsDryRun -or $MoveSummary.TotalMoved -eq 0) { return }

    try {
        $path  = Join-Path $script:DestinationFolder "_manifest_$RunTimestamp.json"
        $moved = @($MoveSummary.FileResults | Where-Object { $_.Status -eq "MOVED" })
        [PSCustomObject]@{
            RunId          = $MoveSummary.RunId
            MoveDate       = $MoveSummary.EndTime.ToString("yyyy-MM-dd HH:mm:ss")
            Server         = $env:COMPUTERNAME
            Operator       = $env:USERNAME
            TotalFiles     = $MoveSummary.TotalMoved
            TotalSizeMoved = Format-FileSize -Bytes $MoveSummary.TotalBytesMoved
            Files          = $moved
        } | ConvertTo-Json -Depth 5 | Out-File -FilePath $path -Encoding UTF8 -Force
    }
    catch {}
}
