param([Parameter(Mandatory)][int]$AppPid, [Parameter(Mandatory)][string]$Folder)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PickerControls {
    public delegate bool EnumProc(IntPtr hwnd, IntPtr state);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr state);
    [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
    public static bool ClickAccept(IntPtr parent) {
        IntPtr accept = IntPtr.Zero;
        EnumChildWindows(parent, (hwnd, state) => {
            if (GetDlgCtrlID(hwnd) == 1) { accept = hwnd; return false; }
            return true;
        }, IntPtr.Zero);
        return accept != IntPtr.Zero && PostMessage(accept, 0x00F5, IntPtr.Zero, IntPtr.Zero);
    }
}
'@
$shell = New-Object -ComObject WScript.Shell
$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $AppPid)
$deadline = (Get-Date).AddSeconds(30)
do {
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
    $dialog = $null
    foreach ($window in $windows) {
        if ($window.Current.ClassName -eq '#32770') { $dialog = $window; break }
    }
    if (-not $dialog) { Start-Sleep -Milliseconds 200 }
} while (-not $dialog -and (Get-Date) -lt $deadline)
if (-not $dialog) { throw 'Native folder picker did not appear for the test process' }
$shell.AppActivate($dialog.Current.Name) | Out-Null
[System.Windows.Forms.Clipboard]::SetText($Folder)
[System.Windows.Forms.SendKeys]::SendWait('%d')
[System.Windows.Forms.SendKeys]::SendWait('^v')
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 800
$windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
$dialog = $null
foreach ($window in $windows) {
    if ($window.Current.ClassName -eq '#32770') { $dialog = $window; break }
}
# Enter in the address field can also accept a valid folder. The browser test
# independently verifies the selected workspace and Counter.swift afterwards.
if (-not $dialog) { exit 0 }
# The common dialog's accept control can be a SplitButton instead of Button.
# Prefer its native IDOK handle; it is independent of localized UIA names/types.
if ([PickerControls]::ClickAccept([IntPtr]$dialog.Current.NativeWindowHandle)) { exit 0 }
$buttons = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$labels = @()
foreach ($button in $buttons) {
    $labels += "$($button.Current.AutomationId):$($button.Current.Name)"
    if ($button.Current.IsEnabled -and ($button.Current.AutomationId -eq '1' -or $button.Current.Name.Replace('&', '') -match '^(Select Folder|Open|Choose Folder|Select)$')) {
        $pattern = $null
        if ($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
            $pattern.Invoke()
            exit 0
        }
    }
}
Write-Output "Picker buttons: $($labels -join ', ')"
# Some Windows shell providers expose no button automation names. Accept the
# dialog's default action, then require it to close instead of assuming success.
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
$deadline = (Get-Date).AddSeconds(5)
do {
    Start-Sleep -Milliseconds 200
    $open = $false
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
    foreach ($window in $windows) { if ($window.Current.ClassName -eq '#32770') { $open = $true } }
} while ($open -and (Get-Date) -lt $deadline)
if ($open) { throw 'Native folder picker did not accept the test folder' }
