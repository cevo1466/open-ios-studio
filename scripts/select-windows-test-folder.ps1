param([Parameter(Mandatory)][int]$AppPid, [Parameter(Mandatory)][string]$Folder)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
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
$buttons = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))
foreach ($button in $buttons) {
    if ($button.Current.Name -match '^(Select Folder|Open|Choose Folder)$') {
        $pattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $pattern.Invoke()
        exit 0
    }
}
throw 'Native folder picker confirmation button was not found'
