param([Parameter(Mandatory=$true)][string]$ProfileRoot, [Parameter(Mandatory=$true)][string]$Keys)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class A11yWindow {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
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
[A11yWindow]::SetForegroundWindow($browserProcess.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 250
[uint32]$foregroundPid = 0
[A11yWindow]::GetWindowThreadProcessId([A11yWindow]::GetForegroundWindow(), [ref]$foregroundPid) | Out-Null
if ($foregroundPid -ne $browser[0].ProcessId) { throw 'Refusing keyboard input: isolated Edge is not foreground' }
if ($Keys -eq '^0' -or $Keys -eq '^{ADD}') {
 $virtualKey=if($Keys -eq '^0'){0x30}else{0x6B}
 [A11yWindow]::keybd_event(0x11,0,0,[UIntPtr]::Zero)
 Start-Sleep -Milliseconds 60
 [A11yWindow]::keybd_event($virtualKey,0,0,[UIntPtr]::Zero)
 Start-Sleep -Milliseconds 60
 [A11yWindow]::keybd_event($virtualKey,0,2,[UIntPtr]::Zero)
 Start-Sleep -Milliseconds 60
 [A11yWindow]::keybd_event(0x11,0,2,[UIntPtr]::Zero)
} elseif ($Keys -eq 'NVDA+Space') {
 [A11yWindow]::keybd_event(0x2D,0,0,[UIntPtr]::Zero)
 [A11yWindow]::keybd_event(0x20,0,0,[UIntPtr]::Zero)
 [A11yWindow]::keybd_event(0x20,0,2,[UIntPtr]::Zero)
 [A11yWindow]::keybd_event(0x2D,0,2,[UIntPtr]::Zero)
} else {
 [System.Windows.Forms.SendKeys]::SendWait($Keys)
}
Start-Sleep -Milliseconds 350
Write-Output 'Isolated Edge keyboard input sent.'
