$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;public static class Nvda127Console {
[DllImport("kernel32.dll")]public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")]public static extern bool AttachThreadInput(uint a,uint b,bool on);
[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);
[DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern IntPtr SendMessageTimeout(IntPtr h,uint m,IntPtr w,string text,uint flags,uint timeout,out UIntPtr result);
[DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
}
'@
$taskNvda=Get-Process nvda,nvda_noUIAccess -ErrorAction SilentlyContinue|Select-Object -First 1
if(-not $taskNvda){throw 'NVDA not running'}
$taskPid=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,[int]$taskNvda.Id)
$taskTitle=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'NVDA Python Console')
$taskConsole=[System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children,(New-Object System.Windows.Automation.AndCondition($taskPid,$taskTitle)))
if(-not $taskConsole){throw 'NVDA Python Console unavailable'}
$taskWindow=[IntPtr]$taskConsole.Current.NativeWindowHandle
[uint32]$taskOldPid=0
$taskOldThread=[Nvda127Console]::GetWindowThreadProcessId([Nvda127Console]::GetForegroundWindow(),[ref]$taskOldPid)
[uint32]$taskTargetPid=0
$taskTargetThread=[Nvda127Console]::GetWindowThreadProcessId($taskWindow,[ref]$taskTargetPid)
if($taskTargetPid -ne $taskNvda.Id){throw 'Wrong NVDA console process'}
$taskOwn=[Nvda127Console]::GetCurrentThreadId()
try{
 if($taskOldThread -ne $taskOwn){[Nvda127Console]::AttachThreadInput($taskOwn,$taskOldThread,$true)|Out-Null}
 if($taskTargetThread -ne $taskOwn){[Nvda127Console]::AttachThreadInput($taskOwn,$taskTargetThread,$true)|Out-Null}
 [Nvda127Console]::ShowWindow($taskWindow,9)|Out-Null
 [Nvda127Console]::SetForegroundWindow($taskWindow)|Out-Null
}finally{
 if($taskTargetThread -ne $taskOwn){[Nvda127Console]::AttachThreadInput($taskOwn,$taskTargetThread,$false)|Out-Null}
 if($taskOldThread -ne $taskOwn){[Nvda127Console]::AttachThreadInput($taskOwn,$taskOldThread,$false)|Out-Null}
}
Start-Sleep -Milliseconds 200
$taskInput=$taskConsole.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty,'Edit')))
if(-not $taskInput){throw 'Editable NVDA console input not found'}
$taskEditHandle=[IntPtr]$taskInput.Current.NativeWindowHandle
[uint32]$taskEditPid=0
[Nvda127Console]::GetWindowThreadProcessId($taskEditHandle,[ref]$taskEditPid)|Out-Null
if($taskEditPid -ne $taskNvda.Id -or $taskEditHandle -eq [IntPtr]::Zero){throw 'Wrong NVDA console input process'}
[UIntPtr]$taskSetResult=[UIntPtr]::Zero
$taskSetOk=[Nvda127Console]::SendMessageTimeout($taskEditHandle,12,[IntPtr]::Zero,'import speechViewer; speechViewer.activate()',2,3000,[ref]$taskSetResult)
if($taskSetOk -eq [IntPtr]::Zero){throw 'NVDA console input unavailable'}
[Nvda127Console]::PostMessage($taskEditHandle,0x0102,[IntPtr]::new(13),[IntPtr]::Zero)|Out-Null
Start-Sleep -Milliseconds 800
$taskViewerTitle=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'NVDA Speech Viewer')
$taskViewer=[System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children,(New-Object System.Windows.Automation.AndCondition($taskPid,$taskViewerTitle)))
if(-not $taskViewer){throw 'Speech Viewer was not opened'}
[Nvda127Console]::PostMessage($taskWindow,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null
@{openedViewer=$true;method='NVDA console opens viewer only; no speech injection';processId=$taskNvda.Id;startupSettingChanged=$false}|ConvertTo-Json -Compress
