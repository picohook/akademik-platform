param([ValidateSet('baseline','delta')][string]$Operation='baseline',[string]$Marker='baseline')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System;using System.Text;using System.Runtime.InteropServices;
public static class NvdaSpeechRead {
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hwnd,uint msg,UIntPtr wParam,IntPtr lParam,uint flags,uint timeout,out UIntPtr result);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hwnd,uint msg,UIntPtr wParam,StringBuilder lParam,uint flags,uint timeout,out UIntPtr result);
}
"@
$taskNvda=Get-Process nvda | Where-Object {$_.MainWindowTitle -eq 'NVDA Speech Viewer'} | Select-Object -First 1
if(-not $taskNvda){throw 'NVDA Speech Viewer unavailable'}
$taskWindow=[System.Windows.Automation.AutomationElement]::FromHandle($taskNvda.MainWindowHandle)
$taskItems=$taskWindow.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
$taskEdit=$null
foreach($taskItem in $taskItems){if($taskItem.Current.ClassName -eq 'RICHEDIT50W'){$taskEdit=$taskItem;break}}
if(-not $taskEdit){throw 'NVDA speech text control unavailable'}
$taskHandle=[IntPtr]$taskEdit.Current.NativeWindowHandle
[UIntPtr]$taskLength=[UIntPtr]::Zero
$taskOk=[NvdaSpeechRead]::SendMessageTimeout($taskHandle,14,[UIntPtr]::Zero,[IntPtr]::Zero,2,3000,[ref]$taskLength)
if($taskOk -eq [IntPtr]::Zero){throw ('Speech length unavailable; Win32 error '+[Runtime.InteropServices.Marshal]::GetLastWin32Error())}
$taskCapacity=[int]$taskLength.ToUInt64()+2
$taskBuffer=New-Object System.Text.StringBuilder($taskCapacity)
[UIntPtr]$taskRead=[UIntPtr]::Zero
$taskOk=[NvdaSpeechRead]::SendMessageTimeout($taskHandle,13,[UIntPtr]::new([uint64]$taskCapacity),$taskBuffer,2,3000,[ref]$taskRead)
if($taskOk -eq [IntPtr]::Zero){throw ('Speech text unavailable; Win32 error '+[Runtime.InteropServices.Marshal]::GetLastWin32Error())}
$taskText=$taskBuffer.ToString()
$taskFile=Join-Path $PSScriptRoot ($Marker+'.marker.json')
if($Marker -notmatch '^[a-zA-Z0-9_-]+$'){throw 'Invalid marker'}
if($Operation -eq 'baseline'){@{processId=$taskNvda.Id;length=$taskText.Length;at=(Get-Date).ToUniversalTime().ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath $taskFile -Encoding UTF8;@{baselineSaved=$true;characters=$taskText.Length;processId=$taskNvda.Id}|ConvertTo-Json -Compress}
else{$taskBefore=Get-Content -LiteralPath $taskFile -Raw|ConvertFrom-Json;if($taskBefore.processId -ne $taskNvda.Id){throw 'NVDA process changed'};if($taskText.Length -lt $taskBefore.length){throw 'Speech history rotated; cannot isolate new test output'};@{from=$taskBefore.at;capturedAt=(Get-Date).ToUniversalTime().ToString('o');text=$taskText.Substring($taskBefore.length);processId=$taskNvda.Id}|ConvertTo-Json -Compress}
