param([Parameter(Mandatory=$true)][string]$ProfileRoot, [Parameter(Mandatory=$true)][string]$Keys)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class A11yWindow {
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach,uint attachTo,bool enable);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
'@
$browser = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object {
 $_.CommandLine -and $_.CommandLine.Contains($ProfileRoot) -and $_.CommandLine -notmatch '--type='
})
if ($browser.Count -ne 1) { throw "Expected one isolated Edge process, got $($browser.Count)" }
$browserProcess = Get-Process -Id $browser[0].ProcessId
if ($browserProcess.MainWindowHandle -eq 0) { throw 'Isolated Edge has no interactive window' }
[A11yWindow]::ShowWindow($browserProcess.MainWindowHandle, 9) | Out-Null
for($attempt=0;$attempt -lt 4;$attempt++) {
 [uint32]$foregroundPid=0
 $foregroundThread=[A11yWindow]::GetWindowThreadProcessId([A11yWindow]::GetForegroundWindow(),[ref]$foregroundPid)
 if($foregroundPid -eq $browserProcess.Id){break}
 [uint32]$targetPid=0
 $targetThread=[A11yWindow]::GetWindowThreadProcessId($browserProcess.MainWindowHandle,[ref]$targetPid)
 $ownThread=[A11yWindow]::GetCurrentThreadId()
 try {
  if($foregroundThread -ne $ownThread){[A11yWindow]::AttachThreadInput($ownThread,$foregroundThread,$true)|Out-Null}
  if($targetThread -ne $ownThread){[A11yWindow]::AttachThreadInput($ownThread,$targetThread,$true)|Out-Null}
  [A11yWindow]::BringWindowToTop($browserProcess.MainWindowHandle)|Out-Null
  [A11yWindow]::SetForegroundWindow($browserProcess.MainWindowHandle)|Out-Null
 }finally{
  if($targetThread -ne $ownThread){[A11yWindow]::AttachThreadInput($ownThread,$targetThread,$false)|Out-Null}
  if($foregroundThread -ne $ownThread){[A11yWindow]::AttachThreadInput($ownThread,$foregroundThread,$false)|Out-Null}
 }
 Start-Sleep -Milliseconds 300
}
[uint32]$verifiedPid=0
[A11yWindow]::GetWindowThreadProcessId([A11yWindow]::GetForegroundWindow(),[ref]$verifiedPid)|Out-Null
if($verifiedPid -ne $browserProcess.Id){throw 'Refusing keyboard input: isolated Edge is not foreground'}
if ($Keys -eq '^0' -or $Keys -eq '^{ADD}') {
 $virtualKey=if($Keys -eq '^0'){0x30}else{0x6B}
 [A11yWindow]::keybd_event(0x11,0,0,[UIntPtr]::Zero)
 Start-Sleep -Milliseconds 60
 [A11yWindow]::keybd_event($virtualKey,0,0,[UIntPtr]::Zero)
 Start-Sleep -Milliseconds 60
 [A11yWindow]::keybd_event($virtualKey,0,2,[UIntPtr]::Zero)
 Start-Sleep -Milliseconds 60
 [A11yWindow]::keybd_event(0x11,0,2,[UIntPtr]::Zero)
 } elseif ($Keys.StartsWith('NVDA+')) {
 $parts=$Keys.Split('+');$last=$parts[-1]
 $key=if($last -eq 'Space'){0x20}elseif($last -eq 'F10'){0x79}elseif($last -eq 'F'){0x46}elseif($last -eq 'N'){0x4E}else{throw 'Unsupported NVDA command'}
 $modifiers=@(0x2D)
 if($parts -contains 'Ctrl'){$modifiers+=0x11}
 if($parts -contains 'Shift'){$modifiers+=0x10}
 try {foreach($modifier in $modifiers){[A11yWindow]::keybd_event($modifier,0,0,[UIntPtr]::Zero)};[A11yWindow]::keybd_event($key,0,0,[UIntPtr]::Zero);[A11yWindow]::keybd_event($key,0,2,[UIntPtr]::Zero)}
 finally {[array]::Reverse($modifiers);foreach($modifier in $modifiers){[A11yWindow]::keybd_event($modifier,0,2,[UIntPtr]::Zero)}}
} else {
 [System.Windows.Forms.SendKeys]::SendWait($Keys)
}
Start-Sleep -Milliseconds 350
Write-Output 'Isolated Edge keyboard input sent.'
