#Requires -Version 5.1
# SQLArchiver-GUI.ps1
# WinForms interface for SQL Company File Archiver
# Run: .\SQLArchiver-GUI.ps1  or  double-click Run-GUI.bat
#
# ENCODING: Save as UTF-8 with BOM (Notepad++: Encoding -> UTF-8 with BOM)

param([switch]$WhatIf)

Set-StrictMode -Version Latest
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ============================================================
#  LOAD DEPENDENCIES
# ============================================================

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Dot-source the backend engine
$corePath = Join-Path $PSScriptRoot "SQLArchiver-Core.ps1"
if (-not (Test-Path -LiteralPath $corePath)) {
    [System.Windows.Forms.MessageBox]::Show(
        "Core module not found:`n$corePath`n`nPlace SQLArchiver-Core.ps1 in the same folder.",
        "Startup Error",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 1
}
. $corePath

# ============================================================
#  SESSION STATE
# ============================================================

$state = [PSCustomObject]@{
    ScanResult   = $null
    MoveSummary  = $null
    SearchNames  = @()
    RunTimestamp = $null
    LogPath      = $null
    CsvPath      = $null
    JsonPath     = $null
}

# ============================================================
#  DATA TABLE  (bound to the DataGridView)
# ============================================================

$fileTable = New-Object System.Data.DataTable
foreach ($col in @(
    @{ Name="Company";   Type=[string] },
    @{ Name="FileName";  Type=[string] },
    @{ Name="Ext";       Type=[string] },
    @{ Name="Size";      Type=[string] },
    @{ Name="Source";    Type=[string] },
    @{ Name="Status";    Type=[string] },
    @{ Name="SizeBytes"; Type=[long]   }   # hidden - used for future sorting
)) {
    $null = $fileTable.Columns.Add($col.Name, $col.Type)
}

# ============================================================
#  COLORS
# ============================================================

$clrBlue    = [System.Drawing.Color]::FromArgb(0,  120, 215)
$clrRed     = [System.Drawing.Color]::FromArgb(192,  50,  50)
$clrGray    = [System.Drawing.Color]::FromArgb(240, 240, 240)
$clrHeader  = [System.Drawing.Color]::FromArgb(225, 230, 240)
$clrAltRow  = [System.Drawing.Color]::FromArgb(248, 248, 255)
$clrBorder  = [System.Drawing.Color]::FromArgb(200, 200, 210)
$fontUI     = New-Object System.Drawing.Font("Segoe UI", 9)
$fontBold   = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$fontMono   = New-Object System.Drawing.Font("Consolas", 10)

# ============================================================
#  FORM
# ============================================================

$form = New-Object System.Windows.Forms.Form
$form.Text          = "SQL Company File Archiver  v2.0"
$form.Size          = New-Object System.Drawing.Size(1020, 680)
$form.MinimumSize   = New-Object System.Drawing.Size(780, 520)
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.Font          = $fontUI
$form.BackColor     = [System.Drawing.SystemColors]::Control

# ============================================================
#  MAIN LAYOUT : 4 rows
#   0 = main work area (Fill)
#   1 = options + actions bar (fixed 52px)
#   2 = progress bar (fixed 24px)
#   3 = status strip (fixed 22px)
# ============================================================

$layout = New-Object System.Windows.Forms.TableLayoutPanel
$layout.Dock        = [System.Windows.Forms.DockStyle]::Fill
$layout.ColumnCount = 1
$layout.RowCount    = 4
$layout.Padding     = New-Object System.Windows.Forms.Padding(8, 6, 8, 2)
$null = $layout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent,  100)))
$null = $layout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,  52)))
$null = $layout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,  24)))
$null = $layout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,  22)))
$null = $layout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$form.Controls.Add($layout)

# ============================================================
#  ROW 0 : SplitContainer  (Input | Preview)
# ============================================================

$split = New-Object System.Windows.Forms.SplitContainer
$split.Dock             = [System.Windows.Forms.DockStyle]::Fill
$split.SplitterWidth    = 5
$split.Panel1MinSize    = 200
$split.Panel2MinSize    = 360
$split.SplitterDistance = 270
$layout.Controls.Add($split, 0, 0)

# ------ LEFT PANEL : Company name input ------

$leftLayout = New-Object System.Windows.Forms.TableLayoutPanel
$leftLayout.Dock        = [System.Windows.Forms.DockStyle]::Fill
$leftLayout.ColumnCount = 1
$leftLayout.RowCount    = 3
$null = $leftLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,  22)))
$null = $leftLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$null = $leftLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,  38)))
$null = $leftLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$leftLayout.Padding = New-Object System.Windows.Forms.Padding(0, 0, 4, 0)
$split.Panel1.Controls.Add($leftLayout)

$lblInput = New-Object System.Windows.Forms.Label
$lblInput.Text      = "Company Names"
$lblInput.Dock      = [System.Windows.Forms.DockStyle]::Fill
$lblInput.Font      = $fontBold
$lblInput.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$leftLayout.Controls.Add($lblInput, 0, 0)

$txtNames = New-Object System.Windows.Forms.TextBox
$txtNames.Multiline     = $true
$txtNames.ScrollBars    = [System.Windows.Forms.ScrollBars]::Vertical
$txtNames.AcceptsReturn = $true
$txtNames.Dock          = [System.Windows.Forms.DockStyle]::Fill
$txtNames.Font          = $fontMono
$txtNames.BorderStyle   = [System.Windows.Forms.BorderStyle]::FixedSingle
$leftLayout.Controls.Add($txtNames, 0, 1)

$btnRow = New-Object System.Windows.Forms.FlowLayoutPanel
$btnRow.Dock          = [System.Windows.Forms.DockStyle]::Fill
$btnRow.FlowDirection = [System.Windows.Forms.FlowDirection]::LeftToRight
$btnRow.WrapContents  = $false
$btnRow.Padding       = New-Object System.Windows.Forms.Padding(0, 4, 0, 0)
$leftLayout.Controls.Add($btnRow, 0, 2)

$btnScan = New-Object System.Windows.Forms.Button
$btnScan.Text      = "Scan"
$btnScan.Size      = New-Object System.Drawing.Size(88, 28)
$btnScan.BackColor = $clrBlue
$btnScan.ForeColor = [System.Drawing.Color]::White
$btnScan.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnScan.FlatAppearance.BorderSize = 0
$btnRow.Controls.Add($btnScan)

$btnClear = New-Object System.Windows.Forms.Button
$btnClear.Text      = "Clear"
$btnClear.Size      = New-Object System.Drawing.Size(60, 28)
$btnClear.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnRow.Controls.Add($btnClear)

# ------ RIGHT PANEL : File preview grid ------

$rightLayout = New-Object System.Windows.Forms.TableLayoutPanel
$rightLayout.Dock        = [System.Windows.Forms.DockStyle]::Fill
$rightLayout.ColumnCount = 1
$rightLayout.RowCount    = 2
$null = $rightLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,  22)))
$null = $rightLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$null = $rightLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$rightLayout.Padding = New-Object System.Windows.Forms.Padding(4, 0, 0, 0)
$split.Panel2.Controls.Add($rightLayout)

$lblFiles = New-Object System.Windows.Forms.Label
$lblFiles.Text      = "Files Found"
$lblFiles.Dock      = [System.Windows.Forms.DockStyle]::Fill
$lblFiles.Font      = $fontBold
$lblFiles.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$rightLayout.Controls.Add($lblFiles, 0, 0)

$grid = New-Object System.Windows.Forms.DataGridView
$grid.Dock                        = [System.Windows.Forms.DockStyle]::Fill
$grid.ReadOnly                    = $true
$grid.AllowUserToAddRows          = $false
$grid.AllowUserToDeleteRows       = $false
$grid.SelectionMode               = [System.Windows.Forms.DataGridViewSelectionMode]::FullRowSelect
$grid.AutoSizeColumnsMode         = [System.Windows.Forms.DataGridViewAutoSizeColumnsMode]::Fill
$grid.BackgroundColor             = [System.Drawing.SystemColors]::Window
$grid.BorderStyle                 = [System.Windows.Forms.BorderStyle]::FixedSingle
$grid.RowHeadersVisible           = $false
$grid.EnableHeadersVisualStyles   = $false
$grid.ColumnHeadersDefaultCellStyle.BackColor  = $clrHeader
$grid.ColumnHeadersDefaultCellStyle.Font       = $fontBold
$grid.ColumnHeadersDefaultCellStyle.ForeColor  = [System.Drawing.Color]::FromArgb(40, 40, 80)
$grid.ColumnHeadersBorderStyle    = [System.Windows.Forms.DataGridViewHeaderBorderStyle]::Single
$grid.DefaultCellStyle.Font       = $fontUI
$grid.AlternatingRowsDefaultCellStyle.BackColor = $clrAltRow
$grid.GridColor                   = $clrBorder
$grid.DataSource                  = $fileTable
$rightLayout.Controls.Add($grid, 0, 1)

# Column configuration after data binding
$grid.add_DataBindingComplete({
    if ($grid.Columns["SizeBytes"]) { $grid.Columns["SizeBytes"].Visible = $false }
    if ($grid.Columns["Company"])   { $grid.Columns["Company"].FillWeight   = 14 }
    if ($grid.Columns["FileName"])  { $grid.Columns["FileName"].FillWeight  = 28 }
    if ($grid.Columns["Ext"])       { $grid.Columns["Ext"].FillWeight       = 7  }
    if ($grid.Columns["Size"])      { $grid.Columns["Size"].FillWeight      = 10 }
    if ($grid.Columns["Source"])    { $grid.Columns["Source"].FillWeight    = 26 }
    if ($grid.Columns["Status"])    { $grid.Columns["Status"].FillWeight    = 15 }
})

# Color-code the Status column
$grid.add_CellFormatting({
    param($sender, $e)
    if ($e.RowIndex -lt 0) { return }
    if ($grid.Columns[$e.ColumnIndex].Name -ne "Status") { return }
    switch ([string]$e.Value) {
        "MOVED"              { $e.CellStyle.ForeColor = [System.Drawing.Color]::DarkGreen   }
        "DRY_RUN"            { $e.CellStyle.ForeColor = [System.Drawing.Color]::DarkMagenta }
        "FAILED_LOCKED"      { $e.CellStyle.ForeColor = [System.Drawing.Color]::Red         }
        "FAILED_PERMISSION"  { $e.CellStyle.ForeColor = [System.Drawing.Color]::Red         }
        "FAILED"             { $e.CellStyle.ForeColor = [System.Drawing.Color]::Red         }
        "SKIPPED_SELF"       { $e.CellStyle.ForeColor = [System.Drawing.Color]::OrangeRed   }
        "Found"              { $e.CellStyle.ForeColor = [System.Drawing.Color]::DarkBlue    }
    }
})

# ============================================================
#  ROW 1 : Options + Action buttons
# ============================================================

$actionsBar = New-Object System.Windows.Forms.Panel
$actionsBar.Dock      = [System.Windows.Forms.DockStyle]::Fill
$actionsBar.BackColor = $clrGray
$actionsBar.Padding   = New-Object System.Windows.Forms.Padding(2, 6, 2, 2)
$layout.Controls.Add($actionsBar, 0, 1)

# Separator line at top of bar
$sep = New-Object System.Windows.Forms.Label
$sep.Dock      = [System.Windows.Forms.DockStyle]::Top
$sep.Height    = 1
$sep.BackColor = $clrBorder
$actionsBar.Controls.Add($sep)

$tooltip = New-Object System.Windows.Forms.ToolTip

$chkDryRun = New-Object System.Windows.Forms.CheckBox
$chkDryRun.Text      = "Dry-Run  (simulate, do not move)"
$chkDryRun.Checked   = $WhatIf.IsPresent
$chkDryRun.Location  = New-Object System.Drawing.Point(4, 14)
$chkDryRun.AutoSize  = $true
$tooltip.SetToolTip($chkDryRun, "Shows what WOULD happen without moving any files")
$actionsBar.Controls.Add($chkDryRun)

$btnMove = New-Object System.Windows.Forms.Button
$btnMove.Text      = "Move Files"
$btnMove.Size      = New-Object System.Drawing.Size(106, 30)
$btnMove.Location  = New-Object System.Drawing.Point(320, 10)
$btnMove.BackColor = $clrRed
$btnMove.ForeColor = [System.Drawing.Color]::White
$btnMove.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnMove.FlatAppearance.BorderSize = 0
$btnMove.Enabled   = $false
$tooltip.SetToolTip($btnMove, "Move matched files to the archive folder")
$actionsBar.Controls.Add($btnMove)

$btnExport = New-Object System.Windows.Forms.Button
$btnExport.Text      = "Export Log"
$btnExport.Size      = New-Object System.Drawing.Size(90, 30)
$btnExport.Location  = New-Object System.Drawing.Point(432, 10)
$btnExport.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnExport.Enabled   = $false
$tooltip.SetToolTip($btnExport, "Save the run log to a file")
$actionsBar.Controls.Add($btnExport)

$btnOpenFolder = New-Object System.Windows.Forms.Button
$btnOpenFolder.Text      = "Open Archive Folder"
$btnOpenFolder.Size      = New-Object System.Drawing.Size(148, 30)
$btnOpenFolder.Location  = New-Object System.Drawing.Point(528, 10)
$btnOpenFolder.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$tooltip.SetToolTip($btnOpenFolder, "Open the destination archive folder in Explorer")
$actionsBar.Controls.Add($btnOpenFolder)

# ============================================================
#  ROW 2 : Progress bar
# ============================================================

$progressBar = New-Object System.Windows.Forms.ProgressBar
$progressBar.Dock    = [System.Windows.Forms.DockStyle]::Fill
$progressBar.Minimum = 0
$progressBar.Maximum = 100
$progressBar.Value   = 0
$progressBar.Style   = [System.Windows.Forms.ProgressBarStyle]::Continuous
$layout.Controls.Add($progressBar, 0, 2)

# ============================================================
#  ROW 3 : Status strip
# ============================================================

$statusStrip = New-Object System.Windows.Forms.StatusStrip
$statusStrip.Dock        = [System.Windows.Forms.DockStyle]::Fill
$statusStrip.SizingGrip  = $false
$layout.Controls.Add($statusStrip, 0, 3)

$statusMain = New-Object System.Windows.Forms.ToolStripStatusLabel
$statusMain.Text      = "Ready.  Enter company names on the left and click Scan."
$statusMain.Spring    = $true
$statusMain.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$null = $statusStrip.Items.Add($statusMain)

$statusRight = New-Object System.Windows.Forms.ToolStripStatusLabel
$statusRight.Text      = ""
$statusRight.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$null = $statusStrip.Items.Add($statusRight)

# ============================================================
#  HELPERS
# ============================================================

function Set-Status {
    param([string]$Main, [string]$Right = "")
    $statusMain.Text  = $Main
    $statusRight.Text = $Right
    [System.Windows.Forms.Application]::DoEvents()
}

function Set-Busy {
    param([bool]$Busy)
    $btnScan.Enabled      = -not $Busy
    $btnClear.Enabled     = -not $Busy
    $chkDryRun.Enabled    = -not $Busy
    $btnMove.Enabled      = (-not $Busy -and $null -ne $state.ScanResult -and $state.ScanResult.TotalMatched -gt 0)
    $form.Cursor          = if ($Busy) { [System.Windows.Forms.Cursors]::WaitCursor } else { [System.Windows.Forms.Cursors]::Default }
}

function Add-FileRow {
    param([string]$Company, [string]$FileName, [string]$Ext, [string]$Size,
          [string]$Source, [string]$Status, [long]$Bytes)
    $row = $fileTable.NewRow()
    $row["Company"]   = $Company
    $row["FileName"]  = $FileName
    $row["Ext"]       = $Ext
    $row["Size"]      = $Size
    $row["Source"]    = $Source
    $row["Status"]    = $Status
    $row["SizeBytes"] = $Bytes
    $fileTable.Rows.Add($row)
}

function Update-FileStatus {
    param([string]$FileName, [string]$NewStatus)
    foreach ($row in $fileTable.Rows) {
        if ($row["FileName"] -eq $FileName) {
            $row["Status"] = $NewStatus
            return
        }
    }
}

function Reset-State {
    $fileTable.Rows.Clear()
    $state.ScanResult  = $null
    $state.MoveSummary = $null
    $state.SearchNames = @()
    $btnMove.Enabled   = $false
    $btnExport.Enabled = $false
    $progressBar.Value = 0
    $progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
    $lblFiles.Text     = "Files Found"
}

function Get-NamesFromTextBox {
    return $txtNames.Text -split "`r?`n" |
           ForEach-Object { $_.Trim() } |
           Where-Object   { $_ -ne ""  } |
           Sort-Object -Unique
}

# ============================================================
#  EVENT : Scan
# ============================================================

$btnScan.add_Click({
    $names = Get-NamesFromTextBox
    if ($names.Count -eq 0) {
        Set-Status "Enter at least one company name."
        return
    }

    Reset-State
    $state.SearchNames = $names
    Set-Busy $true
    Set-Status "Scanning..."

    $progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Marquee
    $progressBar.MarqueeAnimationSpeed = 25

    $onProgress = {
        param($scanned, $matched, $fileName)
        Set-Status "Scanning...   Checked: $scanned  |  Matched: $matched" $fileName
    }

    try {
        $state.ScanResult = Invoke-CompanyScan -Names $names -OnProgress $onProgress
    }
    catch {
        Set-Status "Scan failed: $_"
        Set-Busy $false
        $progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
        return
    }

    $progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
    $progressBar.Value = 0

    # Populate grid
    foreach ($name in $names) {
        foreach ($f in $state.ScanResult.MatchedFiles[$name]) {
            Add-FileRow `
                -Company  $name `
                -FileName $f.Name `
                -Ext      $f.Extension `
                -Size     (Format-FileSize -Bytes $f.Length) `
                -Source   (Split-Path $f.DirectoryName -Leaf) `
                -Status   "Found" `
                -Bytes    $f.Length
        }
    }

    $total = $state.ScanResult.TotalMatched
    $size  = Format-FileSize -Bytes $state.ScanResult.TotalBytes

    $nfNote = ""
    if ($state.ScanResult.NotFound.Count -gt 0) {
        $nfNote = "   |   Not found: $($state.ScanResult.NotFound -join ', ')"
    }

    $lblFiles.Text     = "Files Found   ($total files  |  $size)"
    Set-Status "Scan complete.  $total file(s) found  ($size)$nfNote"

    Set-Busy $false
    $btnMove.Enabled = ($total -gt 0)
})

# ============================================================
#  EVENT : Clear
# ============================================================

$btnClear.add_Click({
    $txtNames.Clear()
    Reset-State
    Set-Status "Ready.  Enter company names on the left and click Scan."
})

# ============================================================
#  EVENT : Move Files
# ============================================================

$btnMove.add_Click({
    if ($null -eq $state.ScanResult -or $state.ScanResult.TotalMatched -eq 0) {
        Set-Status "Nothing to move. Scan first."
        return
    }

    $isDryRun  = $chkDryRun.Checked
    $modeLabel = if ($isDryRun) { "DRY-RUN" } else { "LIVE MOVE" }
    $total     = $state.ScanResult.TotalMatched
    $sizeStr   = Format-FileSize -Bytes $state.ScanResult.TotalBytes

    $msg = if ($isDryRun) {
        "DRY-RUN mode`n`nThis is a simulation.`n$total file(s)  ($sizeStr) would be moved.`n`nNo files will be touched.`n`nProceed?"
    } else {
        "LIVE MOVE`n`n$total file(s)  ($sizeStr) will be permanently moved to:`n`n$($script:DestinationFolder)`n`nThis cannot be undone automatically.`n`nProceed?"
    }

    $answer = [System.Windows.Forms.MessageBox]::Show(
        $msg, $modeLabel,
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    )
    if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }

    $runId              = New-RunId
    $state.RunTimestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
    $desktop            = [Environment]::GetFolderPath("Desktop")
    $state.LogPath      = Join-Path $desktop "SQLMove_Log_$($state.RunTimestamp).txt"
    $state.CsvPath      = Join-Path $desktop "SQLMove_Report_$($state.RunTimestamp).csv"
    $state.JsonPath     = Join-Path $desktop "SQLMove_Log_$($state.RunTimestamp).json"

    Set-Busy $true
    $progressBar.Value   = 0
    $progressBar.Maximum = $total
    Set-Status "$modeLabel in progress..."

    $onProgress = {
        param($current, $tot, $fileName)
        $progressBar.Value = [Math]::Min($current, $progressBar.Maximum)
        $pct = [int](($current / $tot) * 100)
        Set-Status "$modeLabel :  $current of $tot  |  $fileName" "$pct%"
    }

    $onFileResult = {
        param($r)
        Update-FileStatus -FileName $r.FileName -Status $r.Status
        [System.Windows.Forms.Application]::DoEvents()
    }

    try {
        $state.MoveSummary = Invoke-CompanyMove `
            -ScanResult   $state.ScanResult `
            -SearchNames  $state.SearchNames `
            -IsDryRun     $isDryRun `
            -RunId        $runId `
            -OnProgress   $onProgress `
            -OnFileResult $onFileResult
    }
    catch {
        Set-Status "Move error: $_"
        Set-Busy $false
        return
    }

    Save-RunLogs `
        -MoveSummary $state.MoveSummary `
        -ScanResult  $state.ScanResult `
        -SearchNames $state.SearchNames `
        -LogPath     $state.LogPath `
        -CsvPath     $state.CsvPath `
        -JsonPath    $state.JsonPath

    Write-Manifest -MoveSummary $state.MoveSummary -RunTimestamp $state.RunTimestamp

    $moved  = $state.MoveSummary.TotalMoved
    $sim    = $state.MoveSummary.TotalSimulated
    $failed = $state.MoveSummary.TotalFailed
    $bytes  = Format-FileSize -Bytes $state.MoveSummary.TotalBytesMoved

    $rightSummary = if ($isDryRun) { "Simulated: $sim" } else { "Moved: $moved  |  Failed: $failed  |  $bytes" }
    Set-Status "$modeLabel complete." $rightSummary

    $progressBar.Value = $progressBar.Maximum
    Set-Busy $false
    $btnExport.Enabled = $true

    # Show summary dialog
    $summaryMsg = if ($isDryRun) {
        "DRY-RUN complete`n`nSimulated : $sim`nNot found : $($state.ScanResult.NotFound.Count)"
    } else {
        "Move complete`n`nMoved     : $moved  ($bytes)`nFailed    : $failed`nNot found : $($state.ScanResult.NotFound.Count)`n`nLog saved to Desktop."
    }
    [System.Windows.Forms.MessageBox]::Show(
        $summaryMsg, "$modeLabel Summary",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
})

# ============================================================
#  EVENT : Export Log
# ============================================================

$btnExport.add_Click({
    if (-not $state.LogPath) {
        Set-Status "No log available. Run a move operation first."
        return
    }
    $dlg = New-Object System.Windows.Forms.SaveFileDialog
    $dlg.Title            = "Export Run Log"
    $dlg.Filter           = "Text Log (*.txt)|*.txt|CSV Report (*.csv)|*.csv|JSON Log (*.json)|*.json"
    $dlg.FileName         = [System.IO.Path]::GetFileName($state.LogPath)
    $dlg.InitialDirectory = [Environment]::GetFolderPath("Desktop")

    if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        try {
            $src = switch ([System.IO.Path]::GetExtension($dlg.FileName).ToLower()) {
                ".csv"  { $state.CsvPath  }
                ".json" { $state.JsonPath }
                default { $state.LogPath  }
            }
            Copy-Item -LiteralPath $src -Destination $dlg.FileName -Force
            Set-Status "Exported: $($dlg.FileName)"
        }
        catch { Set-Status "Export failed: $_" }
    }
})

# ============================================================
#  EVENT : Open Archive Folder
# ============================================================

$btnOpenFolder.add_Click({
    if (Test-Path -LiteralPath $script:DestinationFolder) {
        Start-Process explorer.exe -ArgumentList $script:DestinationFolder
    }
    else {
        Set-Status "Archive folder does not exist yet."
        [System.Windows.Forms.MessageBox]::Show(
            "The archive folder does not exist yet:`n$($script:DestinationFolder)`n`nIt will be created automatically when you run a LIVE move.",
            "Folder Not Found",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    }
})

# ============================================================
#  KEYBOARD SHORTCUTS
#  Ctrl+Enter = Scan,  F5 = Scan,  Escape = Clear
# ============================================================

$form.add_KeyDown({
    param($sender, $e)
    if ($e.Control -and $e.KeyCode -eq [System.Windows.Forms.Keys]::Return) {
        $btnScan.PerformClick()
        $e.SuppressKeyPress = $true
    }
    elseif ($e.KeyCode -eq [System.Windows.Forms.Keys]::F5) {
        $btnScan.PerformClick()
        $e.SuppressKeyPress = $true
    }
})
$form.KeyPreview = $true

# ============================================================
#  RUN
# ============================================================

[System.Windows.Forms.Application]::Run($form)
