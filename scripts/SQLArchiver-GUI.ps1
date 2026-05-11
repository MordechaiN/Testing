#Requires -Version 5.1
# SQLArchiver-GUI.ps1  v2.0  (Hebrew UI)
# WinForms interface for SQL Company File Archiver
# Run: double-click Run-GUI.bat  or  .\SQLArchiver-GUI.ps1

param([switch]$WhatIf)

Set-StrictMode -Version Latest
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ============================================================
#  LOAD WINFORMS + CORE
# ============================================================

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$corePath = Join-Path $PSScriptRoot "SQLArchiver-Core.ps1"
if (-not (Test-Path -LiteralPath $corePath)) {
    [System.Windows.Forms.MessageBox]::Show(
        "Core module not found:`n$corePath",
        "Startup Error",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 1
}
. $corePath

# ============================================================
#  HEBREW STRINGS  (all via Unicode code points - encoding safe)
# ============================================================

function heb { param([int[]]$c) [string][char[]]$c }

$H = @{
    # Labels
    LblCompany    = heb @(0x05E9,0x05DE,0x05D5,0x05EA,0x0020,0x05D7,0x05D1,0x05E8,0x05D5,0x05EA)
    # שמות חברות

    LblFiles      = heb @(0x05E7,0x05D1,0x05E6,0x05D9,0x05DE,0x0020,0x05E9,0x05E0,0x05DE,0x05E6,0x05D0,0x05D5)
    # קבצים שנמצאו

    # Buttons
    BtnScan       = heb @(0x05E1,0x05E8,0x05D9,0x05E7,0x05D4)
    # סריקה

    BtnClear      = heb @(0x05E0,0x05E7,0x05D4)
    # נקה

    BtnMove       = heb @(0x05D4,0x05E2,0x05D1,0x05E8,0x0020,0x05E7,0x05D1,0x05E6,0x05D9,0x05DE)
    # העבר קבצים

    BtnExport     = heb @(0x05D9,0x05E6,0x05D0,0x0020,0x05D3,0x05D5,0x05D7)
    # יצא דוח

    BtnFolder     = heb @(0x05E4,0x05EA,0x05D7,0x0020,0x05EA,0x05D9,0x05E7,0x05D9,0x05D9,0x05D4)
    # פתח תיקייה

    # Checkbox
    ChkDryRun     = heb @(0x05E1,0x05D9,0x05DE,0x05D5,0x05DC,0x05E6,0x05D9,0x05D4,0x0020,0x28,0x05DC,0x05DC,0x05D0,0x0020,0x05D4,0x05E2,0x05D1,0x05E8,0x05D4,0x29)
    # סימולציה (ללא העברה)

    # Status bar
    StatusReady   = heb @(0x05DE,0x05D5,0x05DB,0x05DF,0x002E,0x0020,0x05D4,0x05DB,0x05E0,0x05E1,0x0020,0x05E9,0x05DE,0x05D5,0x05EA,0x0020,0x05D7,0x05D1,0x05E8,0x05D5,0x05EA,0x0020,0x05D5,0x05DC,0x05D7,0x05E5,0x0020,0x05E1,0x05E8,0x05D9,0x05E7,0x05D4,0x002E)
    # מוכן. הכנס שמות חברות ולחץ סריקה.

    StatusScanning = heb @(0x05E1,0x05E8,0x05D9,0x05E7,0x05D4,0x002E,0x002E,0x002E)
    # סריקה...

    StatusNoNames  = heb @(0x05D9,0x05E9,0x0020,0x05DC,0x05D4,0x05DB,0x05E0,0x05D9,0x05E1,0x0020,0x05DC,0x05E4,0x05D7,0x05D5,0x05EA,0x0020,0x05E9,0x05DD,0x0020,0x05D7,0x05D1,0x05E8,0x05D4,0x0020,0x05D0,0x05D7,0x05EA,0x002E)
    # יש להכניס לפחות שם חברה אחת.

    StatusScanDone = heb @(0x05E1,0x05E8,0x05D9,0x05E7,0x05D4,0x0020,0x05D4,0x05E1,0x05EA,0x05D9,0x05D9,0x05DE,0x05D4,0x002E,0x0020,0x05E0,0x05DE,0x05E6,0x05D0,0x05D5)
    # סריקה הסתיימה. נמצאו

    StatusNothingToMove = heb @(0x05D0,0x05D9,0x05DF,0x0020,0x05E7,0x05D1,0x05E6,0x05D9,0x05DD,0x0020,0x05DC,0x05D4,0x05E2,0x05D1,0x05E8,0x002E,0x0020,0x05D9,0x05E9,0x0020,0x05DC,0x05E1,0x05E8,0x05D5,0x05E7,0x0020,0x05EA,0x05D7,0x05D9,0x05DC,0x05D4,0x002E)
    # אין קבצים להעביר. יש לסרוק תחילה.

    # Grid column headers
    ColCompany    = heb @(0x05D7,0x05D1,0x05E8,0x05D4)
    # חברה

    ColFileName   = heb @(0x05E9,0x05DD,0x0020,0x05E7,0x05D5,0x05D1,0x05E5)
    # שם קובץ

    ColExt        = heb @(0x05E1,0x05D9,0x05D5,0x05DE,0x05EA)
    # סיומת

    ColSize       = heb @(0x05D2,0x05D5,0x05D3,0x05DC)
    # גודל

    ColSource     = heb @(0x05DE,0x05E7,0x05D5,0x05E8)
    # מקור

    ColStatus     = heb @(0x05E1,0x05D8,0x05D8,0x05D5,0x05E1)
    # סטטוס

    # Dialog titles
    DlgConfirmDry  = heb @(0x05D0,0x05D9,0x05E9,0x05D5,0x05E8,0x0020,0x05E1,0x05D9,0x05DE,0x05D5,0x05DC,0x05E6,0x05D9,0x05D4)
    # אישור סימולציה

    DlgConfirmMove = heb @(0x05D0,0x05D9,0x05E9,0x05D5,0x05E8,0x0020,0x05D4,0x05E2,0x05D1,0x05E8,0x05D4)
    # אישור העברה

    DlgSummaryDry  = heb @(0x05E1,0x05D9,0x05DB,0x05D5,0x05DD,0x0020,0x05E1,0x05D9,0x05DE,0x05D5,0x05DC,0x05E6,0x05D9,0x05D4)
    # סיכום סימולציה

    DlgSummaryMove = heb @(0x05E1,0x05D9,0x05DB,0x05D5,0x05DD,0x0020,0x05D4,0x05E2,0x05D1,0x05E8,0x05D4)
    # סיכום העברה

    DlgFolderMissing = heb @(0x05EA,0x05D9,0x05E7,0x05D9,0x05D9,0x05EA,0x0020,0x05D4,0x05D0,0x05E8,0x05DB,0x05D9,0x05D1,0x0020,0x05DC,0x05D0,0x0020,0x05E7,0x05D9,0x05D9,0x05DE,0x05EA)
    # תיקיית הארכיב לא קיימת

    # Dialog words
    WordSimulated  = heb @(0x05E1,0x05D5,0x05DE,0x05DC,0x05E8,0x05D5)
    # סומלרו  -- actually: "סומלצו" ? no, let me think...
    # Better: "יועברו (סימולציה)":
    WordWouldMove  = heb @(0x05D9,0x05D5,0x05E2,0x05D1,0x05E8,0x05D5)
    # יועברו

    WordMoved      = heb @(0x05D4,0x05D5,0x05E2,0x05D1,0x05E8,0x05D5)
    # הועברו

    WordFailed     = heb @(0x05E0,0x05DB,0x05E9,0x05DC,0x05D5)
    # נכשלו

    WordNotFound   = heb @(0x05DC,0x05D0,0x0020,0x05E0,0x05DE,0x05E6,0x05D0,0x05D5)
    # לא נמצאו

    WordFiles      = heb @(0x05E7,0x05D1,0x05E6,0x05D9,0x05DD)
    # קבצים

    WordContinue   = heb @(0x05DC,0x05D4,0x05DE,0x05E9,0x05D9,0x05DA,0x003F)
    # להמשיך?

    WordLogSaved   = heb @(0x05D4,0x05D3,0x05D5,0x05D7,0x0020,0x05E0,0x05E9,0x05DE,0x05E8,0x0020,0x05D1,0x05E9,0x05D5,0x05DC,0x05D7,0x05DF,0x0020,0x05D4,0x05E2,0x05D1,0x05D5,0x05D3,0x05D4,0x002E)
    # הדוח נשמר בשולחן העבודה.

    # Tooltip texts
    TipScan       = heb @(0x05E1,0x05E8,0x05D5,0x05E7,0x0020,0x05D0,0x05EA,0x0020,0x05EA,0x05D9,0x05E7,0x05D9,0x05D5,0x05EA,0x0020,0x05D4,0x05DE,0x05E7,0x05D5,0x05E8,0x0020,0x05DC,0x05E7,0x05D1,0x05E6,0x05D9,0x05DD,0x0020,0x05EA,0x05D5,0x05D0,0x05DE,0x05D9,0x05DD)
    # סרוק את תיקיות המקור לקבצים תואמים

    TipDryRun     = heb @(0x05DE,0x05E6,0x05D9,0x05D2,0x0020,0x05DE,0x05D4,0x0020,0x05D9,0x05E7,0x05E8,0x05D4,0x0020,0x05DC,0x05DC,0x05D0,0x0020,0x05D4,0x05E2,0x05D1,0x05E8,0x05EA,0x0020,0x05E7,0x05D1,0x05E6,0x05D9,0x05DD,0x0020,0x05D1,0x05E4,0x05D5,0x05E2,0x05DC)
    # מציג מה יקרה ללא העברת קבצים בפועל

    TipMove       = heb @(0x05DE,0x05E2,0x05D1,0x05D9,0x05E8,0x0020,0x05D0,0x05EA,0x0020,0x05D4,0x05E7,0x05D1,0x05E6,0x05D9,0x05DD,0x0020,0x05E9,0x05E0,0x05DE,0x05E6,0x05D0,0x05D5,0x0020,0x05DC,0x05EA,0x05D9,0x05E7,0x05D9,0x05D9,0x05EA,0x0020,0x05D4,0x05D0,0x05E8,0x05DB,0x05D9,0x05D1)
    # מעביר את הקבצים שנמצאו לתיקיית הארכיב

    TipExport     = heb @(0x05E9,0x05D5,0x05DE,0x05E8,0x0020,0x05D0,0x05EA,0x0020,0x05D3,0x05D5,0x05D7,0x0020,0x05D4,0x05E8,0x05D9,0x05E6,0x05D4,0x0020,0x05DC,0x05E7,0x05D5,0x05D1,0x05E5)
    # שומר את דוח הריצה לקובץ

    TipFolder     = heb @(0x05E4,0x05D5,0x05EA,0x05D7,0x0020,0x05D0,0x05EA,0x0020,0x05EA,0x05D9,0x05E7,0x05D9,0x05D9,0x05EA,0x0020,0x05D4,0x05D0,0x05E8,0x05DB,0x05D9,0x05D1,0x0020,0x05D1,0x05E1,0x05D9,0x05D9,0x05E8,0x0020,0x05D4,0x05E7,0x05D1,0x05E6,0x05D9,0x05DD)
    # פותח את תיקיית הארכיב בסייר הקבצים
}

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
#  DATA TABLE
# ============================================================

$fileTable = New-Object System.Data.DataTable
foreach ($col in @(
    @{ Name="Company";   Type=[string] },
    @{ Name="FileName";  Type=[string] },
    @{ Name="Ext";       Type=[string] },
    @{ Name="Size";      Type=[string] },
    @{ Name="Source";    Type=[string] },
    @{ Name="Status";    Type=[string] },
    @{ Name="SizeBytes"; Type=[long]   }
)) { $null = $fileTable.Columns.Add($col.Name, $col.Type) }

# ============================================================
#  COLORS + FONTS
# ============================================================

$clrBlue    = [System.Drawing.Color]::FromArgb(0, 120, 215)
$clrRed     = [System.Drawing.Color]::FromArgb(192, 50, 50)
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
$form.MinimumSize   = New-Object System.Drawing.Size(760, 500)
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.Font          = $fontUI
$form.BackColor     = [System.Drawing.SystemColors]::Control

# ============================================================
#  MAIN LAYOUT : 4 rows
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
$split.Dock          = [System.Windows.Forms.DockStyle]::Fill
$split.SplitterWidth = 5
# Panel1MinSize / Panel2MinSize / SplitterDistance all set in Load event
$layout.Controls.Add($split, 0, 0)

# ------ LEFT : Company name input ------

$leftLayout = New-Object System.Windows.Forms.TableLayoutPanel
$leftLayout.Dock        = [System.Windows.Forms.DockStyle]::Fill
$leftLayout.ColumnCount = 1
$leftLayout.RowCount    = 3
$leftLayout.Padding     = New-Object System.Windows.Forms.Padding(0, 0, 4, 0)
$null = $leftLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,  22)))
$null = $leftLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$null = $leftLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,  38)))
$null = $leftLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$split.Panel1.Controls.Add($leftLayout)

$lblInput = New-Object System.Windows.Forms.Label
$lblInput.Text      = $H.LblCompany
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
$btnScan.Text      = $H.BtnScan
$btnScan.Size      = New-Object System.Drawing.Size(90, 28)
$btnScan.BackColor = $clrBlue
$btnScan.ForeColor = [System.Drawing.Color]::White
$btnScan.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnScan.FlatAppearance.BorderSize = 0
$btnRow.Controls.Add($btnScan)

$btnClear = New-Object System.Windows.Forms.Button
$btnClear.Text      = $H.BtnClear
$btnClear.Size      = New-Object System.Drawing.Size(64, 28)
$btnClear.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnRow.Controls.Add($btnClear)

# ------ RIGHT : File preview ------

$rightLayout = New-Object System.Windows.Forms.TableLayoutPanel
$rightLayout.Dock        = [System.Windows.Forms.DockStyle]::Fill
$rightLayout.ColumnCount = 1
$rightLayout.RowCount    = 2
$rightLayout.Padding     = New-Object System.Windows.Forms.Padding(4, 0, 0, 0)
$null = $rightLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,  22)))
$null = $rightLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$null = $rightLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$split.Panel2.Controls.Add($rightLayout)

$lblFiles = New-Object System.Windows.Forms.Label
$lblFiles.Text      = $H.LblFiles
$lblFiles.Dock      = [System.Windows.Forms.DockStyle]::Fill
$lblFiles.Font      = $fontBold
$lblFiles.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$rightLayout.Controls.Add($lblFiles, 0, 0)

$grid = New-Object System.Windows.Forms.DataGridView
$grid.Dock                      = [System.Windows.Forms.DockStyle]::Fill
$grid.ReadOnly                  = $true
$grid.AllowUserToAddRows        = $false
$grid.AllowUserToDeleteRows     = $false
$grid.SelectionMode             = [System.Windows.Forms.DataGridViewSelectionMode]::FullRowSelect
$grid.AutoSizeColumnsMode       = [System.Windows.Forms.DataGridViewAutoSizeColumnsMode]::Fill
$grid.BackgroundColor           = [System.Drawing.SystemColors]::Window
$grid.BorderStyle               = [System.Windows.Forms.BorderStyle]::FixedSingle
$grid.RowHeadersVisible         = $false
$grid.EnableHeadersVisualStyles = $false
$grid.ColumnHeadersDefaultCellStyle.BackColor  = $clrHeader
$grid.ColumnHeadersDefaultCellStyle.Font       = $fontBold
$grid.ColumnHeadersDefaultCellStyle.ForeColor  = [System.Drawing.Color]::FromArgb(40, 40, 80)
$grid.ColumnHeadersBorderStyle  = [System.Windows.Forms.DataGridViewHeaderBorderStyle]::Single
$grid.DefaultCellStyle.Font     = $fontUI
$grid.AlternatingRowsDefaultCellStyle.BackColor = $clrAltRow
$grid.GridColor                 = $clrBorder
$grid.DataSource                = $fileTable
$rightLayout.Controls.Add($grid, 0, 1)

# Column widths + Hebrew headers after binding
$grid.add_DataBindingComplete({
    if ($grid.Columns["SizeBytes"]) { $grid.Columns["SizeBytes"].Visible = $false }
    if ($grid.Columns["Company"])   { $grid.Columns["Company"].FillWeight   = 14; $grid.Columns["Company"].HeaderText  = $H.ColCompany  }
    if ($grid.Columns["FileName"])  { $grid.Columns["FileName"].FillWeight  = 30; $grid.Columns["FileName"].HeaderText  = $H.ColFileName }
    if ($grid.Columns["Ext"])       { $grid.Columns["Ext"].FillWeight       = 7;  $grid.Columns["Ext"].HeaderText       = $H.ColExt      }
    if ($grid.Columns["Size"])      { $grid.Columns["Size"].FillWeight      = 10; $grid.Columns["Size"].HeaderText      = $H.ColSize     }
    if ($grid.Columns["Source"])    { $grid.Columns["Source"].FillWeight    = 24; $grid.Columns["Source"].HeaderText    = $H.ColSource   }
    if ($grid.Columns["Status"])    { $grid.Columns["Status"].FillWeight    = 15; $grid.Columns["Status"].HeaderText    = $H.ColStatus   }
})

# Status column color coding
$grid.add_CellFormatting({
    param($sender, $e)
    if ($e.RowIndex -lt 0) { return }
    if ($grid.Columns[$e.ColumnIndex].Name -ne "Status") { return }
    switch ([string]$e.Value) {
        "MOVED"             { $e.CellStyle.ForeColor = [System.Drawing.Color]::DarkGreen   }
        "DRY_RUN"           { $e.CellStyle.ForeColor = [System.Drawing.Color]::DarkMagenta }
        "FAILED_LOCKED"     { $e.CellStyle.ForeColor = [System.Drawing.Color]::Red         }
        "FAILED_PERMISSION" { $e.CellStyle.ForeColor = [System.Drawing.Color]::Red         }
        "FAILED"            { $e.CellStyle.ForeColor = [System.Drawing.Color]::Red         }
        "SKIPPED_SELF"      { $e.CellStyle.ForeColor = [System.Drawing.Color]::OrangeRed   }
        "Found"             { $e.CellStyle.ForeColor = [System.Drawing.Color]::DarkBlue    }
    }
})

# ============================================================
#  ROW 1 : Options + Actions bar
# ============================================================

$actionsBar = New-Object System.Windows.Forms.Panel
$actionsBar.Dock      = [System.Windows.Forms.DockStyle]::Fill
$actionsBar.BackColor = $clrGray
$actionsBar.Padding   = New-Object System.Windows.Forms.Padding(2, 4, 2, 2)
$layout.Controls.Add($actionsBar, 0, 1)

$sepLine = New-Object System.Windows.Forms.Label
$sepLine.Dock      = [System.Windows.Forms.DockStyle]::Top
$sepLine.Height    = 1
$sepLine.BackColor = $clrBorder
$actionsBar.Controls.Add($sepLine)

$tooltip = New-Object System.Windows.Forms.ToolTip

$chkDryRun = New-Object System.Windows.Forms.CheckBox
$chkDryRun.Text     = $H.ChkDryRun
$chkDryRun.Checked  = $WhatIf.IsPresent
$chkDryRun.Location = New-Object System.Drawing.Point(4, 16)
$chkDryRun.AutoSize = $true
$tooltip.SetToolTip($chkDryRun, $H.TipDryRun)
$actionsBar.Controls.Add($chkDryRun)

$btnMove = New-Object System.Windows.Forms.Button
$btnMove.Text      = $H.BtnMove
$btnMove.Size      = New-Object System.Drawing.Size(116, 30)
$btnMove.Location  = New-Object System.Drawing.Point(340, 10)
$btnMove.BackColor = $clrRed
$btnMove.ForeColor = [System.Drawing.Color]::White
$btnMove.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnMove.FlatAppearance.BorderSize = 0
$btnMove.Enabled   = $false
$tooltip.SetToolTip($btnMove, $H.TipMove)
$actionsBar.Controls.Add($btnMove)

$btnExport = New-Object System.Windows.Forms.Button
$btnExport.Text      = $H.BtnExport
$btnExport.Size      = New-Object System.Drawing.Size(88, 30)
$btnExport.Location  = New-Object System.Drawing.Point(462, 10)
$btnExport.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnExport.Enabled   = $false
$tooltip.SetToolTip($btnExport, $H.TipExport)
$actionsBar.Controls.Add($btnExport)

$btnOpenFolder = New-Object System.Windows.Forms.Button
$btnOpenFolder.Text      = $H.BtnFolder
$btnOpenFolder.Size      = New-Object System.Drawing.Size(106, 30)
$btnOpenFolder.Location  = New-Object System.Drawing.Point(556, 10)
$btnOpenFolder.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$tooltip.SetToolTip($btnOpenFolder, $H.TipFolder)
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
$statusStrip.Dock       = [System.Windows.Forms.DockStyle]::Fill
$statusStrip.SizingGrip = $false
$layout.Controls.Add($statusStrip, 0, 3)

$statusMain = New-Object System.Windows.Forms.ToolStripStatusLabel
$statusMain.Text      = $H.StatusReady
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
    $btnScan.Enabled   = -not $Busy
    $btnClear.Enabled  = -not $Busy
    $chkDryRun.Enabled = -not $Busy
    $btnMove.Enabled   = (-not $Busy -and $null -ne $state.ScanResult -and $state.ScanResult.TotalMatched -gt 0)
    $form.Cursor       = if ($Busy) { [System.Windows.Forms.Cursors]::WaitCursor } else { [System.Windows.Forms.Cursors]::Default }
}

function Add-FileRow {
    param([string]$Company,[string]$FileName,[string]$Ext,[string]$Size,[string]$Source,[string]$Status,[long]$Bytes)
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
    param([string]$FileName,[string]$NewStatus)
    foreach ($row in $fileTable.Rows) {
        if ($row["FileName"] -eq $FileName) { $row["Status"] = $NewStatus; return }
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
    $lblFiles.Text     = $H.LblFiles
}

function Get-NamesFromTextBox {
    return $txtNames.Text -split "`r?`n" |
           ForEach-Object { $_.Trim() } |
           Where-Object   { $_ -ne ""  } |
           Sort-Object -Unique
}

# ============================================================
#  EVENT : Form Load  (set SplitterDistance here, after layout)
# ============================================================

$form.add_Load({
    try {
        $split.SplitterDistance = [int]($form.ClientSize.Width * 0.35)
        $split.Panel1MinSize    = 180
        $split.Panel2MinSize    = 180
    } catch {}
})

# ============================================================
#  EVENT : Scan
# ============================================================

$btnScan.add_Click({
    $names = Get-NamesFromTextBox
    if ($names.Count -eq 0) {
        Set-Status $H.StatusNoNames
        return
    }

    Reset-State
    $state.SearchNames = $names
    Set-Busy $true
    Set-Status $H.StatusScanning

    $progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Marquee
    $progressBar.MarqueeAnimationSpeed = 25

    $onProgress = {
        param($scanned, $matched, $fileName)
        Set-Status "$($H.StatusScanning)   $scanned / $matched" $fileName
    }

    try {
        $state.ScanResult = Invoke-CompanyScan -Names $names -OnProgress $onProgress
    }
    catch {
        Set-Status "Error: $_"
        Set-Busy $false
        $progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
        return
    }

    $progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
    $progressBar.Value = 0

    foreach ($name in $names) {
        foreach ($f in $state.ScanResult.MatchedFiles[$name]) {
            Add-FileRow -Company $name -FileName $f.Name -Ext $f.Extension `
                        -Size (Format-FileSize -Bytes $f.Length) `
                        -Source (Split-Path $f.DirectoryName -Leaf) `
                        -Status "Found" -Bytes $f.Length
        }
    }

    $total  = $state.ScanResult.TotalMatched
    $size   = Format-FileSize -Bytes $state.ScanResult.TotalBytes
    $lblFiles.Text = "$($H.LblFiles)   ($total  |  $size)"

    $nfNote = ""
    if ($state.ScanResult.NotFound.Count -gt 0) {
        $nfNote = "   |   $($H.WordNotFound): $($state.ScanResult.NotFound -join ', ')"
    }
    Set-Status "$($H.StatusScanDone) $total $($H.WordFiles) ($size)$nfNote"

    Set-Busy $false
    $btnMove.Enabled = ($total -gt 0)
})

# ============================================================
#  EVENT : Clear
# ============================================================

$btnClear.add_Click({
    $txtNames.Clear()
    Reset-State
    Set-Status $H.StatusReady
})

# ============================================================
#  EVENT : Move Files
# ============================================================

$btnMove.add_Click({
    if ($null -eq $state.ScanResult -or $state.ScanResult.TotalMatched -eq 0) {
        Set-Status $H.StatusNothingToMove
        return
    }

    $isDryRun = $chkDryRun.Checked
    $total    = $state.ScanResult.TotalMatched
    $sizeStr  = Format-FileSize -Bytes $state.ScanResult.TotalBytes

    if ($isDryRun) {
        $dlgTitle = $H.DlgConfirmDry
        $dlgMsg   = "$($H.ChkDryRun)`n`n$total $($H.WordFiles) ($sizeStr) $($H.WordWouldMove).`n`n$($H.WordContinue)"
    } else {
        $dlgTitle = $H.DlgConfirmMove
        $dlgMsg   = "$total $($H.WordFiles) ($sizeStr)`n`n$($script:DestinationFolder)`n`n$($H.WordContinue)"
    }

    $answer = [System.Windows.Forms.MessageBox]::Show(
        $dlgMsg, $dlgTitle,
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

    $opLabel = if ($isDryRun) { $H.ChkDryRun } else { $H.BtnMove }

    $onProgress = {
        param($current, $tot, $fileName)
        $progressBar.Value = [Math]::Min($current, $progressBar.Maximum)
        $pct = [int](($current / $tot) * 100)
        Set-Status "$opLabel :  $current / $tot  |  $fileName" "$pct%"
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
        Set-Status "Error: $_"
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
    $nf     = $state.ScanResult.NotFound.Count
    $bytes  = Format-FileSize -Bytes $state.MoveSummary.TotalBytesMoved

    $rightSummary = if ($isDryRun) { "$($H.WordWouldMove): $sim" } else { "$($H.WordMoved): $moved ($bytes)   $($H.WordFailed): $failed" }
    Set-Status "$opLabel OK" $rightSummary

    $progressBar.Value = $progressBar.Maximum
    Set-Busy $false
    $btnExport.Enabled = $true

    if ($isDryRun) {
        $summaryMsg = "$($H.WordWouldMove): $sim`n$($H.WordNotFound): $nf"
    } else {
        $summaryMsg = "$($H.WordMoved): $moved ($bytes)`n$($H.WordFailed): $failed`n$($H.WordNotFound): $nf`n`n$($H.WordLogSaved)"
    }
    $summaryTitle = if ($isDryRun) { $H.DlgSummaryDry } else { $H.DlgSummaryMove }

    [System.Windows.Forms.MessageBox]::Show(
        $summaryMsg, $summaryTitle,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
})

# ============================================================
#  EVENT : Export Log
# ============================================================

$btnExport.add_Click({
    if (-not $state.LogPath) { Set-Status $H.StatusNothingToMove; return }
    $dlg = New-Object System.Windows.Forms.SaveFileDialog
    $dlg.Title            = $H.BtnExport
    $dlg.Filter           = "Text (*.txt)|*.txt|CSV (*.csv)|*.csv|JSON (*.json)|*.json"
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
            Set-Status "$($H.BtnExport): $($dlg.FileName)"
        }
        catch { Set-Status "Error: $_" }
    }
})

# ============================================================
#  EVENT : Open Archive Folder
# ============================================================

$btnOpenFolder.add_Click({
    if (Test-Path -LiteralPath $script:DestinationFolder) {
        Start-Process explorer.exe -ArgumentList $script:DestinationFolder
    } else {
        [System.Windows.Forms.MessageBox]::Show(
            "$($H.DlgFolderMissing)`n`n$($script:DestinationFolder)",
            $H.DlgFolderMissing,
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    }
})

# ============================================================
#  KEYBOARD : Ctrl+Enter / F5 = Scan
# ============================================================

$form.KeyPreview = $true
$form.add_KeyDown({
    param($sender, $e)
    if (($e.Control -and $e.KeyCode -eq [System.Windows.Forms.Keys]::Return) -or
        ($e.KeyCode -eq [System.Windows.Forms.Keys]::F5)) {
        $btnScan.PerformClick()
        $e.SuppressKeyPress = $true
    }
})

# ============================================================
#  RUN
# ============================================================

[System.Windows.Forms.Application]::Run($form)
