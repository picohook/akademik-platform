param([Parameter(Mandatory=$true)][string]$ProfileRoot,[ValidateSet(100,200,400)][int]$Percent)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class RetestWindow {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] public static extern void keybd_event(byte k,byte s,uint f,UIntPtr e);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool join);
 [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
}
'@
$edge=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'"|Where-Object {$_.CommandLine -and $_.CommandLine.Contains($ProfileRoot) -and $_.CommandLine -notmatch '--type='})
if($edge.Count -ne 1){throw 'Expected one isolated Edge process'}
$process=Get-Process -Id $edge[0].ProcessId
if($process.MainWindowHandle -eq 0){throw 'Test Edge window is unavailable'}
[RetestWindow]::ShowWindow($process.MainWindowHandle,9)|Out-Null
[RetestWindow]::SetForegroundWindow($process.MainWindowHandle)|Out-Null
Start-Sleep -Milliseconds 300
for($attempt=0;$attempt -lt 3;$attempt++){
 [uint32]$foreground=0
 $foregroundThread=[RetestWindow]::GetWindowThreadProcessId([RetestWindow]::GetForegroundWindow(),[ref]$foreground)
 if($foreground -eq $process.Id){break}
 [uint32]$targetPid=0
 $targetThread=[RetestWindow]::GetWindowThreadProcessId($process.MainWindowHandle,[ref]$targetPid)
 $ownThread=[RetestWindow]::GetCurrentThreadId()
 try {
  if($foregroundThread -ne $ownThread){[RetestWindow]::AttachThreadInput($ownThread,$foregroundThread,$true)|Out-Null}
  if($targetThread -ne $ownThread){[RetestWindow]::AttachThreadInput($ownThread,$targetThread,$true)|Out-Null}
  [RetestWindow]::BringWindowToTop($process.MainWindowHandle)|Out-Null
  [RetestWindow]::SetForegroundWindow($process.MainWindowHandle)|Out-Null
 } finally {
  if($targetThread -ne $ownThread){[RetestWindow]::AttachThreadInput($ownThread,$targetThread,$false)|Out-Null}
  if($foregroundThread -ne $ownThread){[RetestWindow]::AttachThreadInput($ownThread,$foregroundThread,$false)|Out-Null}
 }
 Start-Sleep -Milliseconds 300
}
function Assert-TestForeground {
 [uint32]$foreground=0
 [RetestWindow]::GetWindowThreadProcessId([RetestWindow]::GetForegroundWindow(),[ref]$foreground)|Out-Null
 if($foreground -ne $process.Id){throw 'Refusing input: isolated Edge is not foreground'}
}
$keys=@(0x30)
$plusCount=if($Percent -eq 400){8}elseif($Percent -eq 200){5}else{0}
for($keyIndex=0;$keyIndex -lt $plusCount;$keyIndex++){$keys+=0x6B}
foreach($key in $keys){
 Assert-TestForeground
 try {
  [RetestWindow]::keybd_event(0x11,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 50
  [RetestWindow]::keybd_event($key,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 50
  [RetestWindow]::keybd_event($key,0,2,[UIntPtr]::Zero)
 } finally { [RetestWindow]::keybd_event(0x11,0,2,[UIntPtr]::Zero) }
 Start-Sleep -Milliseconds 120
}
Write-Output "Native browser zoom requested: $Percent%"
