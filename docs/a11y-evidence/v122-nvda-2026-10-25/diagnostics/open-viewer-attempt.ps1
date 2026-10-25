$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;public static class NvdaMenuKeys{[DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);}
"@
$taskNvda=Get-Process nvda | Select-Object -First 1
if(-not $taskNvda){throw 'NVDA not running'}
if($taskNvda.MainWindowTitle -eq 'NVDA Speech Viewer'){Write-Output '{"speechViewerAlreadyOpen":true}';exit}
[NvdaMenuKeys]::keybd_event(0x2D,0,0,[UIntPtr]::Zero)
[NvdaMenuKeys]::keybd_event(0x4E,0,0,[UIntPtr]::Zero)
[NvdaMenuKeys]::keybd_event(0x4E,0,2,[UIntPtr]::Zero)
[NvdaMenuKeys]::keybd_event(0x2D,0,2,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 500
function Get-TaskMenuItems {
 $taskRoots=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$taskNvda.Id)))
 foreach($taskRoot in $taskRoots){$taskNodes=$taskRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::MenuItem)));foreach($taskNode in $taskNodes){$taskNode}}
}
$taskItems=@(Get-TaskMenuItems)
$taskTools=$taskItems|Where-Object {$_.Current.Name -match '^Tools$|^Araçlar$'}|Select-Object -First 1
if(-not $taskTools){@{foundTools=$false;menuNames=@($taskItems|ForEach-Object {$_.Current.Name})}|ConvertTo-Json -Compress;exit 1}
$taskExpand=$null
if($taskTools.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$taskExpand)){$taskExpand.Expand()}else{($taskTools.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()}
Start-Sleep -Milliseconds 500
$taskItems=@(Get-TaskMenuItems)
$taskViewer=$taskItems|Where-Object {$_.Current.Name -match 'Speech viewer|Konuşma [Gg]örüntüleyici'}|Select-Object -First 1
if(-not $taskViewer){@{foundTools=$true;foundViewer=$false;menuNames=@($taskItems|ForEach-Object {$_.Current.Name})}|ConvertTo-Json -Compress;exit 1}
($taskViewer.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
Start-Sleep -Milliseconds 700
@{openedViewer=$true;processId=$taskNvda.Id;startupSettingChanged=$false}|ConvertTo-Json -Compress
