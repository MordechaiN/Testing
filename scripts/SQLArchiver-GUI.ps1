#Requires -Version 5.1
# SQLArchiver-GUI.ps1  v3.0  -- Modern Dark UI
# WinForms frontend for SQL Company File Archiver
# Run via Run-GUI.bat  or  .\SQLArchiver-GUI.ps1

param([switch]$WhatIf)

Set-StrictMode -Version Latest
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# --- Assemblies ---

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# --- Core ---

$corePath = Join-Path $PSScriptRoot 'SQLArchiver-Core.ps1'
if (-not (Test-Path -LiteralPath $corePath)) {
    [System.Windows.Forms.MessageBox]::Show(
        "Core module not found:`n$corePath", 'Startup Error',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 1
}
. $corePath

# --- Custom Controls ---
# RoundButton: owner-drawn button with rounded corners, hover, disabled states

if (-not ([System.Management.Automation.PSTypeName]'RoundButton').Type) {
    Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing `
             -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Windows.Forms;

public class RoundButton : Button {
    public int   Radius      { get; set; } = 8;
    public Color HoverBack   { get; set; } = Color.Empty;
    public Color BorderColor { get; set; } = Color.Empty;
    private Color _storedBack;

    protected override void OnMouseEnter(EventArgs e) {
        _storedBack = BackColor;
        if (HoverBack != Color.Empty) BackColor = HoverBack;
        base.OnMouseEnter(e); Invalidate();
    }
    protected override void OnMouseLeave(EventArgs e) {
        if (HoverBack != Color.Empty) BackColor = _storedBack;
        base.OnMouseLeave(e); Invalidate();
    }
    protected override void OnEnabledChanged(EventArgs e) { base.OnEnabledChanged(e); Invalidate(); }
    protected override bool ShowFocusCues { get { return false; } }

    private GraphicsPath MakePath(Rectangle r) {
        int d = Radius * 2;
        var p = new GraphicsPath();
        p.AddArc(r.Left,      r.Top,      d, d, 180, 90);
        p.AddArc(r.Right - d, r.Top,      d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom-d, d, d,   0, 90);
        p.AddArc(r.Left,      r.Bottom-d, d, d,  90, 90);
        p.CloseFigure();
        return p;
    }

    protected override void OnPaint(PaintEventArgs e) {
        var g = e.Graphics;
        g.SmoothingMode     = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        var r  = new Rectangle(0, 0, Width - 1, Height - 1);
        var bg = Enabled ? BackColor   : Color.FromArgb(42, 42, 43);
        var fg = Enabled ? ForeColor   : Color.FromArgb(70, 70, 70);
        var bc = BorderColor;
        using (var path = MakePath(r)) {
            using (var b = new SolidBrush(bg)) g.FillPath(b, path);
            if (bc != Color.Empty && Enabled)
                using (var pen = new Pen(bc, 1)) g.DrawPath(pen, path);
        }
        TextRenderer.DrawText(g, Text, Font, r, fg,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter |
            TextFormatFlags.SingleLine);
    }
}
'@
}

# --- Colors ---

$co = @{
    Bg        = [System.Drawing.Color]::FromArgb(0x1E, 0x1E, 0x1E)
    Panel     = [System.Drawing.Color]::FromArgb(0x25, 0x25, 0x26)
    Header    = [System.Drawing.Color]::FromArgb(0x14, 0x14, 0x15)
    Border    = [System.Drawing.Color]::FromArgb(0x3A, 0x3A, 0x3B)
    Input     = [System.Drawing.Color]::FromArgb(0x19, 0x19, 0x1A)
    Text      = [System.Drawing.Color]::FromArgb(0xEA, 0xEA, 0xEA)
    TextSec   = [System.Drawing.Color]::FromArgb(0x88, 0x88, 0x88)
    TextDim   = [System.Drawing.Color]::FromArgb(0x48, 0x48, 0x48)
    Accent    = [System.Drawing.Color]::FromArgb(0x3B, 0x82, 0xF6)
    AccentHov = [System.Drawing.Color]::FromArgb(0x5A, 0x9A, 0xFF)
    Danger    = [System.Drawing.Color]::FromArgb(0xB9, 0x1C, 0x1C)
    DangerHov = [System.Drawing.Color]::FromArgb(0xDC, 0x26, 0x26)
    Ghost     = [System.Drawing.Color]::FromArgb(0x2E, 0x2E, 0x2F)
    GhostHov  = [System.Drawing.Color]::FromArgb(0x3C, 0x3C, 0x3D)
    GhostBord = [System.Drawing.Color]::FromArgb(0x4A, 0x4A, 0x4B)
    RowEven   = [System.Drawing.Color]::FromArgb(0x25, 0x25, 0x26)
    RowOdd    = [System.Drawing.Color]::FromArgb(0x2B, 0x2B, 0x2C)
    GridHead  = [System.Drawing.Color]::FromArgb(0x1C, 0x1C, 0x1D)
    SelBack   = [System.Drawing.Color]::FromArgb(0x1E, 0x3A, 0x5F)
    SelText   = [System.Drawing.Color]::FromArgb(0xEA, 0xEA, 0xEA)
    Success   = [System.Drawing.Color]::FromArgb(0x16, 0xA3, 0x4A)
    Warning   = [System.Drawing.Color]::FromArgb(0xD9, 0x77, 0x06)
    Error     = [System.Drawing.Color]::FromArgb(0xDC, 0x26, 0x26)
    AccBar    = [System.Drawing.Color]::FromArgb(0x3B, 0x82, 0xF6)
}

# --- Fonts ---

$fUI    = New-Object System.Drawing.Font('Segoe UI', 9)
$fBold  = New-Object System.Drawing.Font('Segoe UI', 9,   [System.Drawing.FontStyle]::Bold)
$fLabel = New-Object System.Drawing.Font('Segoe UI', 7.5, [System.Drawing.FontStyle]::Bold)
$fTitle = New-Object System.Drawing.Font('Segoe UI', 15,  [System.Drawing.FontStyle]::Bold)
$fSub   = New-Object System.Drawing.Font('Segoe UI', 8.5)
$fMono  = New-Object System.Drawing.Font('Consolas', 9.5)
$fBtn   = New-Object System.Drawing.Font('Segoe UI', 9,   [System.Drawing.FontStyle]::Bold)
$fStat  = New-Object System.Drawing.Font('Segoe UI', 8.5)

# --- Hebrew strings (all Unicode code points -- encoding safe) ---

function heb { param([int[]]$codes) [string][char[]]$codes }

$H = @{
    LblCompany       = heb @(0x05E9,0x05DE,0x05D5,0x05EA,0x0020,0x05D7,0x05D1,0x05E8,0x05D5,0x05EA)
    LblFiles         = heb @(0x05E7,0x05D1,0x05E6,0x05D9,0x05DE,0x0020,0x05E9,0x05E0,0x05DE,0x05E6,0x05D0,0x05D5)
    BtnScan          = heb @(0x05E1,0x05E8,0x05D9,0x05E7,0x05D4)
    BtnClear         = heb @(0x05E0,0x05E7,0x05D4)
    BtnMove          = heb @(0x05D4,0x05E2,0x05D1,0x05E8,0x0020,0x05E7,0x05D1,0x05E6,0x05D9,0x05DE)
    BtnExport        = heb @(0x05D9,0x05E6,0x05D0,0x0020,0x05D3,0x05D5,0x05D7)
    BtnFolder        = heb @(0x05E4,0x05EA,0x05D7,0x0020,0x05EA,0x05D9,0x05E7,0x05D9,0x05D9,0x05D4)
    ChkDryRun        = heb @(0x05E1,0x05D9,0x05DE,0x05D5,0x05DC,0x05E6,0x05D9,0x05D4,0x0020,0x28,0x05DC,0x05DC,0x05D0,0x0020,0x05D4,0x05E2,0x05D1,0x05E8,0x05D4,0x29)
    StatusReady      = heb @(0x05DE,0x05D5,0x05DB,0x05DF,0x002E,0x0020,0x05D4,0x05DB,0x05E0,0x05E1,0x0020,0x05E9,0x05DE,0x05D5,0x05EA,0x0020,0x05D7,0x05D1,0x05E8,0x05D5,0x05EA,0x0020,0x05D5,0x05DC,0x05D7,0x05E5,0x0020,0x05E1,0x05E8,0x05D9,0x05E7,0x05D4,0x002E)
    StatusScanning   = heb @(0x05E1,0x05E8,0x05D9,0x05E7,0x05D4,0x002E,0x002E,0x002E)
    StatusNoNames    = heb @(0x05D9,0x05E9,0x0020,0x05DC,0x05D4,0x05DB,0x05E0,0x05D9,0x05E1,0x0020,0x05DC,0x05E4,0x05D7,0x05D5,0x05EA,0x0020,0x05E9,0x05DD,0x0020,0x05D7,0x05D1,0x05E8,0x05D4,0x0020,0x05D0,0x05D7,0x05EA,0x002E)
    StatusScanDone   = heb @(0x05E1,0x05E8,0x05D9,0x05E7,0x05D4,0x0020,0x05D4,0x05E1,0x05EA,0x05D9,0x05D9,0x05DE,0x05D4,0x002E,0x0020,0x05E0,0x05DE,0x05E6,0x05D0,0x05D5)
    StatusNothingToMove = heb @(0x05D0,0x05D9,0x05DF,0x0020,0x05E7,0x05D1,0x05E6,0x05D9,0x05DD,0x0020,0x05DC,0x05D4,0x05E2,0x05D1,0x05E8,0x002E,0x0020,0x05D9,0x05E9,0x0020,0x05DC,0x05E1,0x05E8,0x05D5,0x05E7,0x0020,0x05EA,0x05D7,0x05D9,0x05DC,0x05D4,0x002E)
    ColCompany       = heb @(0x05D7,0x05D1,0x05E8,0x05D4)
    ColFileName      = heb @(0x05E9,0x05DD,0x0020,0x05E7,0x05D5,0x05D1,0x05E5)
    ColExt           = heb @(0x05E1,0x05D9,0x05D5,0x05DE,0x05EA)
    ColSize          = heb @(0x05D2,0x05D5,0x05D3,0x05DC)
    ColSource        = heb @(0x05DE,0x05E7,0x05D5,0x05E8)
    ColStatus        = heb @(0x05E1,0x05D8,0x05D8,0x05D5,0x05E1)
    DlgConfirmDry    = heb @(0x05D0,0x05D9,0x05E9,0x05D5,0x05E8,0x0020,0x05E1,0x05D9,0x05DE,0x05D5,0x05DC,0x05E6,0x05D9,0x05D4)
    DlgConfirmMove   = heb @(0x05D0,0x05D9,0x05E9,0x05D5,0x05E8,0x0020,0x05D4,0x05E2,0x05D1,0x05E8,0x05D4)
    DlgSummaryDry    = heb @(0x05E1,0x05D9,0x05DB,0x05D5,0x05DD,0x0020,0x05E1,0x05D9,0x05DE,0x05D5,0x05DC,0x05E6,0x05D9,0x05D4)
    DlgSummaryMove   = heb @(0x05E1,0x05D9,0x05DB,0x05D5,0x05DD,0x0020,0x05D4,0x05E2,0x05D1,0x05E8,0x05D4)
    DlgFolderMissing = heb @(0x05EA,0x05D9,0x05E7,0x05D9,0x05D9,0x05EA,0x0020,0x05D4,0x05D0,0x05E8,0x05DB,0x05D9,0x05D1,0x0020,0x05DC,0x05D0,0x0020,0x05E7,0x05D9,0x05D9,0x05DE,0x05EA)
    WordWouldMove    = heb @(0x05D9,0x05D5,0x05E2,0x05D1,0x05E8,0x05D5)
    WordMoved        = heb @(0x05D4,0x05D5,0x05E2,0x05D1,0x05E8,0x05D5)
    WordFailed       = heb @(0x05E0,0x05DB,0x05E9,0x05DC,0x05D5)
    WordNotFound     = heb @(0x05DC,0x05D0,0x0020,0x05E0,0x05DE,0x05E6,0x05D0,0x05D5)
    WordFiles        = heb @(0x05E7,0x05D1,0x05E6,0x05D9,0x05DD)
    WordContinue     = heb @(0x05DC,0x05D4,0x05DE,0x05E9,0x05D9,0x05DA,0x003F)
    WordLogSaved     = heb @(0x05D4,0x05D3,0x05D5,0x05D7,0x0020,0x05E0,0x05E9,0x05DE,0x05E8,0x0020,0x05D1,0x05E9,0x05D5,0x05DC,0x05D7,0x05DF,0x0020,0x05D4,0x05E2,0x05D1,0x05D5,0x05D3,0x05D4,0x002E)
    EmptyState       = heb @(0x05D0,0x05D9,0x05DF,0x0020,0x05E7,0x05D1,0x05E6,0x05D9,0x05DD,0x0020,0x05DC,0x05EA,0x05E6,0x05D5,0x05D2,0x05D4)
    TipScan          = heb @(0x05E1,0x05E8,0x05D5,0x05E7,0x0020,0x05D0,0x05EA,0x0020,0x05EA,0x05D9,0x05E7,0x05D9,0x05D5,0x05EA,0x0020,0x05D4,0x05DE,0x05E7,0x05D5,0x05E8)
    TipDryRun        = heb @(0x05DE,0x05E6,0x05D9,0x05D2,0x0020,0x05DE,0x05D4,0x0020,0x05D9,0x05E7,0x05E8,0x05D4,0x0020,0x05DC,0x05DC,0x05D0,0x0020,0x05D4,0x05E2,0x05D1,0x05E8,0x05EA,0x0020,0x05E7,0x05D1,0x05E6,0x05D9,0x05DD,0x0020,0x05D1,0x05E4,0x05D5,0x05E2,0x05DC)
    TipMove          = heb @(0x05DE,0x05E2,0x05D1,0x05D9,0x05E8,0x0020,0x05D0,0x05EA,0x0020,0x05D4,0x05E7,0x05D1,0x05E6,0x05D9,0x05DD,0x0020,0x05E9,0x05E0,0x05DE,0x05E6,0x05D0,0x05D5,0x0020,0x05DC,0x05EA,0x05D9,0x05E7,0x05D9,0x05D9,0x05EA,0x0020,0x05D4,0x05D0,0x05E8,0x05DB,0x05D9,0x05D1)
    TipExport        = heb @(0x05E9,0x05D5,0x05DE,0x05E8,0x0020,0x05D0,0x05EA,0x0020,0x05D3,0x05D5,0x05D7,0x0020,0x05D4,0x05E8,0x05D9,0x05E6,0x05D4,0x0020,0x05DC,0x05E7,0x05D5,0x05D1,0x05E5)
    TipFolder        = heb @(0x05E4,0x05D5,0x05EA,0x05D7,0x0020,0x05D0,0x05EA,0x0020,0x05EA,0x05D9,0x05E7,0x05D9,0x05D9,0x05EA,0x0020,0x05D4,0x05D0,0x05E8,0x05DB,0x05D9,0x05D1,0x0020,0x05D1,0x05E1,0x05D9,0x05D9,0x05E8,0x0020,0x05D4,0x05E7,0x05D1,0x05E6,0x05D9,0x05DD)
}

# --- Session state ---

$state = [PSCustomObject]@{
    ScanResult   = $null
    MoveSummary  = $null
    SearchNames  = [string[]]@()
    RunTimestamp = $null
    LogPath      = $null
    CsvPath      = $null
    JsonPath     = $null
}

# --- DataTable ---

$fileTable = New-Object System.Data.DataTable
foreach ($col in @(
    @{ Name='Company';   Type=[string] },
    @{ Name='FileName';  Type=[string] },
    @{ Name='Ext';       Type=[string] },
    @{ Name='Size';      Type=[string] },
    @{ Name='Source';    Type=[string] },
    @{ Name='Status';    Type=[string] },
    @{ Name='SizeBytes'; Type=[long]   }
)) { $null = $fileTable.Columns.Add($col.Name, $col.Type) }

# --- Form ---

$form = New-Object System.Windows.Forms.Form
$form.Text            = 'SQL Company File Archiver'
$form.Size            = New-Object System.Drawing.Size(1120, 740)
$form.MinimumSize     = New-Object System.Drawing.Size(840, 560)
$form.StartPosition   = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.Font            = $fUI
$form.BackColor       = $co.Bg

# Root layout: 5 rows
# Header | Content | ActionBar | ProgressBar | StatusBar

$root = New-Object System.Windows.Forms.TableLayoutPanel
$root.Dock        = [System.Windows.Forms.DockStyle]::Fill
$root.ColumnCount = 1
$root.RowCount    = 5
$root.Padding     = [System.Windows.Forms.Padding]::Empty
$null = $root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,  74)))
$null = $root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$null = $root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,  58)))
$null = $root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,   4)))
$null = $root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,  30)))
$null = $root.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$form.Controls.Add($root)

# ROW 0 - HEADER

$header = New-Object System.Windows.Forms.Panel
$header.Dock      = [System.Windows.Forms.DockStyle]::Fill
$header.BackColor = $co.Header
$root.Controls.Add($header, 0, 0)

$accentBar = New-Object System.Windows.Forms.Panel
$accentBar.Size      = New-Object System.Drawing.Size(4, 74)
$accentBar.Location  = New-Object System.Drawing.Point(0, 0)
$accentBar.BackColor = $co.AccBar
$header.Controls.Add($accentBar)

$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text      = 'SQL Company File Archiver'
$lblTitle.Font      = $fTitle
$lblTitle.ForeColor = $co.Text
$lblTitle.Location  = New-Object System.Drawing.Point(24, 14)
$lblTitle.AutoSize  = $true
$header.Controls.Add($lblTitle)

$lblSub = New-Object System.Windows.Forms.Label
$lblSub.Text      = 'Safe SQL Archive Management Utility'
$lblSub.Font      = $fSub
$lblSub.ForeColor = $co.TextSec
$lblSub.Location  = New-Object System.Drawing.Point(26, 46)
$lblSub.AutoSize  = $true
$header.Controls.Add($lblSub)

$lblVer = New-Object System.Windows.Forms.Label
$lblVer.Text      = 'v3.0'
$lblVer.Font      = $fLabel
$lblVer.ForeColor = $co.TextDim
$lblVer.AutoSize  = $true
$header.Controls.Add($lblVer)

$hdrBorder = New-Object System.Windows.Forms.Panel
$hdrBorder.Dock      = [System.Windows.Forms.DockStyle]::Bottom
$hdrBorder.Height    = 1
$hdrBorder.BackColor = $co.Border
$header.Controls.Add($hdrBorder)

$header.add_Resize({
    $lblVer.Location = New-Object System.Drawing.Point(($header.Width - $lblVer.Width - 20), 28)
})

# ROW 1 - CONTENT (SplitContainer: Input | Grid)

$split = New-Object System.Windows.Forms.SplitContainer
$split.Dock          = [System.Windows.Forms.DockStyle]::Fill
$split.SplitterWidth = 1
$split.BackColor     = $co.Border
$root.Controls.Add($split, 0, 1)

# LEFT panel

$leftPanel = New-Object System.Windows.Forms.Panel
$leftPanel.Dock      = [System.Windows.Forms.DockStyle]::Fill
$leftPanel.BackColor = $co.Panel
$leftPanel.Padding   = New-Object System.Windows.Forms.Padding(16, 14, 16, 12)
$split.Panel1.BackColor = $co.Panel
$split.Panel1.Controls.Add($leftPanel)

$leftLayout = New-Object System.Windows.Forms.TableLayoutPanel
$leftLayout.Dock        = [System.Windows.Forms.DockStyle]::Fill
$leftLayout.ColumnCount = 1
$leftLayout.RowCount    = 3
$null = $leftLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,  26)))
$null = $leftLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$null = $leftLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,  44)))
$null = $leftLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$leftPanel.Controls.Add($leftLayout)

$lblInputSec = New-Object System.Windows.Forms.Label
$lblInputSec.Text      = $H.LblCompany.ToUpper()
$lblInputSec.Font      = $fLabel
$lblInputSec.ForeColor = $co.TextSec
$lblInputSec.Dock      = [System.Windows.Forms.DockStyle]::Fill
$lblInputSec.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$leftLayout.Controls.Add($lblInputSec, 0, 0)

$txtNames = New-Object System.Windows.Forms.TextBox
$txtNames.Multiline     = $true
$txtNames.ScrollBars    = [System.Windows.Forms.ScrollBars]::Vertical
$txtNames.AcceptsReturn = $true
$txtNames.Dock          = [System.Windows.Forms.DockStyle]::Fill
$txtNames.Font          = $fMono
$txtNames.BackColor     = $co.Input
$txtNames.ForeColor     = $co.TextSec
$txtNames.BorderStyle   = [System.Windows.Forms.BorderStyle]::FixedSingle
$placeholderText        = "Enter company names (one per line):`r`nRAWDA2020`r`nABC_CORP"
$txtNames.Text          = $placeholderText
$leftLayout.Controls.Add($txtNames, 0, 1)

$txtNames.add_Enter({
    if ($txtNames.ForeColor.ToArgb() -eq $co.TextSec.ToArgb()) {
        $txtNames.Text      = ''
        $txtNames.ForeColor = $co.Text
    }
})
$txtNames.add_Leave({
    if ($txtNames.Text.Trim() -eq '') {
        $txtNames.ForeColor = $co.TextSec
        $txtNames.Text      = $placeholderText
    }
})

$btnRowLeft = New-Object System.Windows.Forms.FlowLayoutPanel
$btnRowLeft.Dock          = [System.Windows.Forms.DockStyle]::Fill
$btnRowLeft.FlowDirection = [System.Windows.Forms.FlowDirection]::LeftToRight
$btnRowLeft.WrapContents  = $false
$btnRowLeft.Padding       = New-Object System.Windows.Forms.Padding(0, 8, 0, 0)
$btnRowLeft.BackColor     = $co.Panel
$leftLayout.Controls.Add($btnRowLeft, 0, 2)

$btnScan = New-Object RoundButton
$btnScan.Text      = $H.BtnScan
$btnScan.Size      = New-Object System.Drawing.Size(100, 32)
$btnScan.Font      = $fBtn
$btnScan.BackColor = $co.Accent
$btnScan.HoverBack = $co.AccentHov
$btnScan.ForeColor = [System.Drawing.Color]::White
$btnScan.Cursor    = [System.Windows.Forms.Cursors]::Hand
$btnRowLeft.Controls.Add($btnScan)

$btnClear = New-Object RoundButton
$btnClear.Text        = $H.BtnClear
$btnClear.Size        = New-Object System.Drawing.Size(72, 32)
$btnClear.Font        = $fBtn
$btnClear.BackColor   = $co.Ghost
$btnClear.HoverBack   = $co.GhostHov
$btnClear.ForeColor   = $co.TextSec
$btnClear.BorderColor = $co.GhostBord
$btnClear.Cursor      = [System.Windows.Forms.Cursors]::Hand
$btnClear.Margin      = New-Object System.Windows.Forms.Padding(8, 0, 0, 0)
$btnRowLeft.Controls.Add($btnClear)

# RIGHT panel

$rightPanel = New-Object System.Windows.Forms.Panel
$rightPanel.Dock      = [System.Windows.Forms.DockStyle]::Fill
$rightPanel.BackColor = $co.Bg
$rightPanel.Padding   = New-Object System.Windows.Forms.Padding(16, 14, 16, 12)
$split.Panel2.BackColor = $co.Bg
$split.Panel2.Controls.Add($rightPanel)

$rightLayout = New-Object System.Windows.Forms.TableLayoutPanel
$rightLayout.Dock        = [System.Windows.Forms.DockStyle]::Fill
$rightLayout.ColumnCount = 1
$rightLayout.RowCount    = 2
$null = $rightLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,  26)))
$null = $rightLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$null = $rightLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$rightPanel.Controls.Add($rightLayout)

$lblFilesSec = New-Object System.Windows.Forms.Label
$lblFilesSec.Text      = $H.LblFiles.ToUpper()
$lblFilesSec.Font      = $fLabel
$lblFilesSec.ForeColor = $co.TextSec
$lblFilesSec.Dock      = [System.Windows.Forms.DockStyle]::Fill
$lblFilesSec.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$rightLayout.Controls.Add($lblFilesSec, 0, 0)

$gridContainer = New-Object System.Windows.Forms.Panel
$gridContainer.Dock      = [System.Windows.Forms.DockStyle]::Fill
$gridContainer.BackColor = $co.Panel
$rightLayout.Controls.Add($gridContainer, 0, 1)

$lblEmpty = New-Object System.Windows.Forms.Label
$lblEmpty.Text      = $H.EmptyState
$lblEmpty.Font      = New-Object System.Drawing.Font('Segoe UI', 12)
$lblEmpty.ForeColor = $co.TextDim
$lblEmpty.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$lblEmpty.Dock      = [System.Windows.Forms.DockStyle]::Fill
$lblEmpty.Visible   = $true
$gridContainer.Controls.Add($lblEmpty)

$grid = New-Object System.Windows.Forms.DataGridView
$grid.Dock                        = [System.Windows.Forms.DockStyle]::Fill
$grid.ReadOnly                    = $true
$grid.AllowUserToAddRows          = $false
$grid.AllowUserToDeleteRows       = $false
$grid.SelectionMode               = [System.Windows.Forms.DataGridViewSelectionMode]::FullRowSelect
$grid.MultiSelect                 = $false
$grid.AutoSizeColumnsMode         = [System.Windows.Forms.DataGridViewAutoSizeColumnsMode]::Fill
$grid.BackgroundColor             = $co.Panel
$grid.BorderStyle                 = [System.Windows.Forms.BorderStyle]::None
$grid.CellBorderStyle             = [System.Windows.Forms.DataGridViewCellBorderStyle]::SingleHorizontal
$grid.GridColor                   = $co.Border
$grid.RowHeadersVisible           = $false
$grid.ColumnHeadersHeightSizeMode = [System.Windows.Forms.DataGridViewColumnHeadersHeightSizeMode]::DisableResizing
$grid.ColumnHeadersHeight         = 34
$grid.EnableHeadersVisualStyles   = $false
$grid.ScrollBars                  = [System.Windows.Forms.ScrollBars]::Both
$grid.RowTemplate.Height          = 30
$grid.ColumnHeadersDefaultCellStyle.BackColor  = $co.GridHead
$grid.ColumnHeadersDefaultCellStyle.ForeColor  = $co.TextSec
$grid.ColumnHeadersDefaultCellStyle.Font       = $fLabel
$grid.ColumnHeadersDefaultCellStyle.Padding    = New-Object System.Windows.Forms.Padding(8, 0, 0, 0)
$grid.ColumnHeadersBorderStyle                 = [System.Windows.Forms.DataGridViewHeaderBorderStyle]::Single
$grid.DefaultCellStyle.BackColor               = $co.RowEven
$grid.DefaultCellStyle.ForeColor               = $co.Text
$grid.DefaultCellStyle.Font                    = $fUI
$grid.DefaultCellStyle.SelectionBackColor      = $co.SelBack
$grid.DefaultCellStyle.SelectionForeColor      = $co.SelText
$grid.DefaultCellStyle.Padding                 = New-Object System.Windows.Forms.Padding(8, 0, 0, 0)
$grid.AlternatingRowsDefaultCellStyle.BackColor          = $co.RowOdd
$grid.AlternatingRowsDefaultCellStyle.ForeColor          = $co.Text
$grid.AlternatingRowsDefaultCellStyle.SelectionBackColor = $co.SelBack
$grid.AlternatingRowsDefaultCellStyle.SelectionForeColor = $co.SelText
$grid.DataSource = $fileTable
$gridContainer.Controls.Add($grid)
$grid.BringToFront()

$grid.add_DataBindingComplete({
    if ($grid.Columns['SizeBytes']) { $grid.Columns['SizeBytes'].Visible = $false }
    if ($grid.Columns['Company'])  { $grid.Columns['Company'].FillWeight   = 13; $grid.Columns['Company'].HeaderText  = $H.ColCompany  }
    if ($grid.Columns['FileName']) { $grid.Columns['FileName'].FillWeight  = 33; $grid.Columns['FileName'].HeaderText  = $H.ColFileName }
    if ($grid.Columns['Ext'])      { $grid.Columns['Ext'].FillWeight       =  7; $grid.Columns['Ext'].HeaderText       = $H.ColExt      }
    if ($grid.Columns['Size'])     { $grid.Columns['Size'].FillWeight      =  9; $grid.Columns['Size'].HeaderText      = $H.ColSize     }
    if ($grid.Columns['Source'])   { $grid.Columns['Source'].FillWeight    = 25; $grid.Columns['Source'].HeaderText    = $H.ColSource   }
    if ($grid.Columns['Status'])   { $grid.Columns['Status'].FillWeight    = 13; $grid.Columns['Status'].HeaderText    = $H.ColStatus   }
})

$grid.add_CellFormatting({
    param($sender, $e)
    if ($e.RowIndex -lt 0) { return }
    if ($grid.Columns[$e.ColumnIndex].Name -ne 'Status') { return }
    switch ([string]$e.Value) {
        'MOVED'             { $e.CellStyle.ForeColor = $co.Success  }
        'DRY_RUN'           { $e.CellStyle.ForeColor = $co.Accent   }
        'FAILED_LOCKED'     { $e.CellStyle.ForeColor = $co.Error    }
        'FAILED_PERMISSION' { $e.CellStyle.ForeColor = $co.Error    }
        'FAILED'            { $e.CellStyle.ForeColor = $co.Error    }
        'SKIPPED_SELF'      { $e.CellStyle.ForeColor = $co.Warning  }
        'Found'             { $e.CellStyle.ForeColor = $co.TextSec  }
    }
})

# ROW 2 - ACTION BAR

$actBar = New-Object System.Windows.Forms.Panel
$actBar.Dock      = [System.Windows.Forms.DockStyle]::Fill
$actBar.BackColor = $co.Panel
$root.Controls.Add($actBar, 0, 2)

$actBorder = New-Object System.Windows.Forms.Panel
$actBorder.Dock      = [System.Windows.Forms.DockStyle]::Top
$actBorder.Height    = 1
$actBorder.BackColor = $co.Border
$actBar.Controls.Add($actBorder)

$tooltip = New-Object System.Windows.Forms.ToolTip

$chkDryRun = New-Object System.Windows.Forms.CheckBox
$chkDryRun.Text      = $H.ChkDryRun
$chkDryRun.Checked   = $WhatIf.IsPresent
$chkDryRun.Font      = $fUI
$chkDryRun.ForeColor = $co.TextSec
$chkDryRun.BackColor = $co.Panel
$chkDryRun.AutoSize  = $true
$chkDryRun.Location  = New-Object System.Drawing.Point(18, 17)
$chkDryRun.Cursor    = [System.Windows.Forms.Cursors]::Hand
$tooltip.SetToolTip($chkDryRun, $H.TipDryRun)
$actBar.Controls.Add($chkDryRun)

$btnRowRight = New-Object System.Windows.Forms.FlowLayoutPanel
$btnRowRight.FlowDirection = [System.Windows.Forms.FlowDirection]::RightToLeft
$btnRowRight.WrapContents  = $false
$btnRowRight.AutoSize      = $true
$btnRowRight.BackColor     = $co.Panel
$btnRowRight.Padding       = New-Object System.Windows.Forms.Padding(0, 13, 16, 0)
$actBar.Controls.Add($btnRowRight)

$btnMove = New-Object RoundButton
$btnMove.Text        = $H.BtnMove
$btnMove.Size        = New-Object System.Drawing.Size(128, 32)
$btnMove.Font        = $fBtn
$btnMove.BackColor   = $co.Danger
$btnMove.HoverBack   = $co.DangerHov
$btnMove.ForeColor   = [System.Drawing.Color]::White
$btnMove.Enabled     = $false
$btnMove.Cursor      = [System.Windows.Forms.Cursors]::Hand
$tooltip.SetToolTip($btnMove, $H.TipMove)
$btnRowRight.Controls.Add($btnMove)

$btnExport = New-Object RoundButton
$btnExport.Text        = $H.BtnExport
$btnExport.Size        = New-Object System.Drawing.Size(96, 32)
$btnExport.Font        = $fBtn
$btnExport.BackColor   = $co.Ghost
$btnExport.HoverBack   = $co.GhostHov
$btnExport.ForeColor   = $co.TextSec
$btnExport.BorderColor = $co.GhostBord
$btnExport.Enabled     = $false
$btnExport.Cursor      = [System.Windows.Forms.Cursors]::Hand
$btnExport.Margin      = New-Object System.Windows.Forms.Padding(0, 0, 8, 0)
$tooltip.SetToolTip($btnExport, $H.TipExport)
$btnRowRight.Controls.Add($btnExport)

$btnOpenFolder = New-Object RoundButton
$btnOpenFolder.Text        = $H.BtnFolder
$btnOpenFolder.Size        = New-Object System.Drawing.Size(112, 32)
$btnOpenFolder.Font        = $fBtn
$btnOpenFolder.BackColor   = $co.Ghost
$btnOpenFolder.HoverBack   = $co.GhostHov
$btnOpenFolder.ForeColor   = $co.TextSec
$btnOpenFolder.BorderColor = $co.GhostBord
$btnOpenFolder.Cursor      = [System.Windows.Forms.Cursors]::Hand
$btnOpenFolder.Margin      = New-Object System.Windows.Forms.Padding(0, 0, 8, 0)
$tooltip.SetToolTip($btnOpenFolder, $H.TipFolder)
$btnRowRight.Controls.Add($btnOpenFolder)

$actBar.add_Resize({
    $btnRowRight.Location = New-Object System.Drawing.Point(
        ($actBar.Width - $btnRowRight.Width), 0)
})

# ROW 3 - PROGRESS BAR (thin, modern)

$progressTrack = New-Object System.Windows.Forms.Panel
$progressTrack.Dock      = [System.Windows.Forms.DockStyle]::Fill
$progressTrack.BackColor = $co.Border
$root.Controls.Add($progressTrack, 0, 3)

$progressFill = New-Object System.Windows.Forms.Panel
$progressFill.BackColor = $co.Accent
$progressFill.Location  = [System.Drawing.Point]::Empty
$progressFill.Size      = New-Object System.Drawing.Size(0, 4)
$progressTrack.Controls.Add($progressFill)

$marqTimer = New-Object System.Windows.Forms.Timer
$marqTimer.Interval = 16
$script:marqPos = 0
$marqTimer.add_Tick({
    $w = $progressTrack.Width
    $bw = [int]($w * 0.25)
    $script:marqPos = ($script:marqPos + 8) % ($w + $bw)
    $x = $script:marqPos - $bw
    $progressFill.Location = New-Object System.Drawing.Point($x, 0)
    $progressFill.Width    = $bw
})

function Set-Progress {
    param([int]$Value = -1, [int]$Maximum = 100, [bool]$Marquee = $false)
    if ($Marquee) {
        $marqTimer.Start()
    }
    else {
        $marqTimer.Stop()
        $progressFill.Location = [System.Drawing.Point]::Empty
        if ($Maximum -le 0 -or $Value -le 0) {
            $progressFill.Width = 0
        }
        else {
            $pct = [Math]::Min($Value, $Maximum) / [double]$Maximum
            $progressFill.Width = [int]($progressTrack.Width * $pct)
        }
    }
}

# ROW 4 - STATUS BAR

$statusBar = New-Object System.Windows.Forms.Panel
$statusBar.Dock      = [System.Windows.Forms.DockStyle]::Fill
$statusBar.BackColor = $co.Header
$root.Controls.Add($statusBar, 0, 4)

$statusBorder2 = New-Object System.Windows.Forms.Panel
$statusBorder2.Dock      = [System.Windows.Forms.DockStyle]::Top
$statusBorder2.Height    = 1
$statusBorder2.BackColor = $co.Border
$statusBar.Controls.Add($statusBorder2)

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Text      = $H.StatusReady
$lblStatus.Font      = $fStat
$lblStatus.ForeColor = $co.TextSec
$lblStatus.Location  = New-Object System.Drawing.Point(14, 7)
$lblStatus.AutoSize  = $true
$statusBar.Controls.Add($lblStatus)

$lblStatusRight = New-Object System.Windows.Forms.Label
$lblStatusRight.Text      = ''
$lblStatusRight.Font      = $fStat
$lblStatusRight.ForeColor = $co.TextSec
$lblStatusRight.AutoSize  = $true
$statusBar.Controls.Add($lblStatusRight)

$lblBrand = New-Object System.Windows.Forms.Label
$lblBrand.Text      = 'Built by MordechaiN'
$lblBrand.Font      = $fStat
$lblBrand.ForeColor = $co.TextDim
$lblBrand.AutoSize  = $true
$statusBar.Controls.Add($lblBrand)

$statusBar.add_Resize({
    $lblStatusRight.Location = New-Object System.Drawing.Point(
        ([int](($statusBar.Width - $lblStatusRight.Width) / 2)), 7)
    $lblBrand.Location = New-Object System.Drawing.Point(
        ($statusBar.Width - $lblBrand.Width - 14), 7)
})

# HELPER FUNCTIONS

function Set-Status {
    param([string]$Main, [string]$Right = '')
    $lblStatus.Text      = $Main
    $lblStatusRight.Text = $Right
    $lblStatusRight.Location = New-Object System.Drawing.Point(
        ([int](($statusBar.Width - $lblStatusRight.Width) / 2)), 7)
    [System.Windows.Forms.Application]::DoEvents()
}

function Set-Busy {
    param([bool]$Busy)
    $btnScan.Enabled   = -not $Busy
    $btnClear.Enabled  = -not $Busy
    $chkDryRun.Enabled = -not $Busy
    $btnMove.Enabled   = (-not $Busy -and
                          $null -ne $state.ScanResult -and
                          $state.ScanResult.TotalMatched -gt 0)
    $form.Cursor = if ($Busy) { [System.Windows.Forms.Cursors]::WaitCursor } `
                  else        { [System.Windows.Forms.Cursors]::Default }
}

function Add-FileRow {
    param([string]$Company,[string]$FileName,[string]$Ext,
          [string]$Size,[string]$Source,[string]$Status,[long]$Bytes)
    $row = $fileTable.NewRow()
    $row['Company']   = $Company
    $row['FileName']  = $FileName
    $row['Ext']       = $Ext
    $row['Size']      = $Size
    $row['Source']    = $Source
    $row['Status']    = $Status
    $row['SizeBytes'] = $Bytes
    $fileTable.Rows.Add($row)
}

function Update-FileStatus {
    param([string]$FileName, [string]$NewStatus)
    foreach ($row in $fileTable.Rows) {
        if ($row['FileName'] -eq $FileName) { $row['Status'] = $NewStatus; return }
    }
}

function Reset-State {
    $fileTable.Rows.Clear()
    $state.ScanResult  = $null
    $state.MoveSummary = $null
    $state.SearchNames = [string[]]@()
    $btnMove.Enabled   = $false
    $btnExport.Enabled = $false
    $lblEmpty.Visible  = $true
    $lblFilesSec.Text  = $H.LblFiles.ToUpper()
    Set-Progress -Value 0
}

function Get-NamesFromTextBox {
    if ($txtNames.ForeColor.ToArgb() -eq $co.TextSec.ToArgb()) { return @() }
    return @($txtNames.Text -split "`r?`n" |
             ForEach-Object { $_.Trim() } |
             Where-Object   { $_ -ne ''  } |
             Sort-Object -Unique)
}

# FORM LOAD

$form.add_Load({
    try {
        $split.SplitterDistance = [int]($form.ClientSize.Width * 0.30)
        $split.Panel1MinSize    = 200
        $split.Panel2MinSize    = 300
    } catch {}
    $actBar.Width    = $actBar.Width
    $statusBar.Width = $statusBar.Width
})

# EVENT - Scan

$btnScan.add_Click({
    [array]$names = @(Get-NamesFromTextBox)
    if ($names.Count -eq 0) {
        Set-Status $H.StatusNoNames
        return
    }

    Reset-State
    $state.SearchNames = [string[]]$names
    Set-Busy $true
    Set-Status $H.StatusScanning
    Set-Progress -Marquee $true

    $onProgress = {
        param($scanned, $matched, $fileName)
        Set-Status "$($H.StatusScanning)   $scanned scanned / $matched matched" $fileName
    }

    try {
        $state.ScanResult = Invoke-CompanyScan -Names $names -OnProgress $onProgress
    }
    catch {
        Set-Status "Error: $_"
        Set-Busy $false
        Set-Progress -Value 0
        return
    }

    Set-Progress -Value 0

    foreach ($name in $names) {
        foreach ($f in $state.ScanResult.MatchedFiles[$name]) {
            Add-FileRow -Company $name -FileName $f.Name -Ext $f.Extension `
                        -Size    (Format-FileSize -Bytes $f.Length) `
                        -Source  (Split-Path $f.DirectoryName -Leaf) `
                        -Status  'Found' -Bytes $f.Length
        }
    }

    $total  = $state.ScanResult.TotalMatched
    $size   = Format-FileSize -Bytes $state.ScanResult.TotalBytes
    $lblEmpty.Visible = ($total -eq 0)
    $lblFilesSec.Text = ($H.LblFiles + "  ($total  |  $size)").ToUpper()

    $nfNote = ''
    if ($state.ScanResult.NotFound.Count -gt 0) {
        $nfNote = "  |  $($H.WordNotFound): $($state.ScanResult.NotFound -join ', ')"
    }
    Set-Status "$($H.StatusScanDone) $total $($H.WordFiles) ($size)$nfNote"

    Set-Busy $false
    $btnMove.Enabled = ($total -gt 0)
})

# EVENT - Clear

$btnClear.add_Click({
    $txtNames.ForeColor = $co.TextSec
    $txtNames.Text      = $placeholderText
    Reset-State
    Set-Status $H.StatusReady
})

# EVENT - Move Files

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
    }
    else {
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
    $state.RunTimestamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
    $desktop            = [Environment]::GetFolderPath('Desktop')
    $state.LogPath      = Join-Path $desktop "SQLMove_Log_$($state.RunTimestamp).txt"
    $state.CsvPath      = Join-Path $desktop "SQLMove_Report_$($state.RunTimestamp).csv"
    $state.JsonPath     = Join-Path $desktop "SQLMove_Log_$($state.RunTimestamp).json"

    Set-Busy $true
    $opLabel = if ($isDryRun) { $H.ChkDryRun } else { $H.BtnMove }

    $onProgress = {
        param($current, $tot, $fileName)
        Set-Progress -Value $current -Maximum $tot
        $pct = [int](($current / $tot) * 100)
        Set-Status "$opLabel :  $current / $tot  |  $fileName" "$pct%"
    }

    $onFileResult = {
        param($r)
        Update-FileStatus -FileName $r.FileName -NewStatus $r.Status
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

    $rightSummary = if ($isDryRun) { "$($H.WordWouldMove): $sim" } `
                    else           { "$($H.WordMoved): $moved ($bytes)   $($H.WordFailed): $failed" }

    Set-Progress -Value $total -Maximum $total
    Set-Status "$opLabel OK" $rightSummary
    Set-Busy $false
    $btnExport.Enabled = $true

    if ($isDryRun) {
        $summaryMsg = "$($H.WordWouldMove): $sim`n$($H.WordNotFound): $nf"
    }
    else {
        $summaryMsg = "$($H.WordMoved): $moved ($bytes)`n$($H.WordFailed): $failed`n$($H.WordNotFound): $nf`n`n$($H.WordLogSaved)"
    }
    $summaryTitle = if ($isDryRun) { $H.DlgSummaryDry } else { $H.DlgSummaryMove }

    [System.Windows.Forms.MessageBox]::Show(
        $summaryMsg, $summaryTitle,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
})

# EVENT - Export Log

$btnExport.add_Click({
    if (-not $state.LogPath) { Set-Status $H.StatusNothingToMove; return }
    $dlg = New-Object System.Windows.Forms.SaveFileDialog
    $dlg.Title            = $H.BtnExport
    $dlg.Filter           = 'Text (*.txt)|*.txt|CSV (*.csv)|*.csv|JSON (*.json)|*.json'
    $dlg.FileName         = [System.IO.Path]::GetFileName($state.LogPath)
    $dlg.InitialDirectory = [Environment]::GetFolderPath('Desktop')
    if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        try {
            $src = switch ([System.IO.Path]::GetExtension($dlg.FileName).ToLower()) {
                '.csv'  { $state.CsvPath  }
                '.json' { $state.JsonPath }
                default { $state.LogPath  }
            }
            Copy-Item -LiteralPath $src -Destination $dlg.FileName -Force
            Set-Status "$($H.BtnExport): $($dlg.FileName)"
        }
        catch { Set-Status "Error: $_" }
    }
})

# EVENT - Open Archive Folder

$btnOpenFolder.add_Click({
    if (Test-Path -LiteralPath $script:DestinationFolder) {
        Start-Process explorer.exe -ArgumentList $script:DestinationFolder
    }
    else {
        [System.Windows.Forms.MessageBox]::Show(
            "$($H.DlgFolderMissing)`n`n$($script:DestinationFolder)",
            $H.DlgFolderMissing,
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    }
})

# KEYBOARD - Ctrl+Enter / F5 = Scan

$form.KeyPreview = $true
$form.add_KeyDown({
    param($sender, $e)
    if (($e.Control -and $e.KeyCode -eq [System.Windows.Forms.Keys]::Return) -or
        ($e.KeyCode  -eq [System.Windows.Forms.Keys]::F5)) {
        $btnScan.PerformClick()
        $e.SuppressKeyPress = $true
    }
})

# RUN

[System.Windows.Forms.Application]::Run($form)
