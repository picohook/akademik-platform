param([Parameter(Mandatory=$true)][string]$ProfileRoot,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class OwnedCapture {
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int left,top,right,bottom;}
 [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr window,int attribute,out RECT rect,int size);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int action);
 [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint action,uint p,out RECT rect,uint flags);
}
'@
[OwnedCapture]::SetProcessDPIAware()|Out-Null
$owned=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'"|Where-Object {$_.CommandLine -and $_.CommandLine.Contains($ProfileRoot) -and $_.CommandLine -notmatch '--type='})
if($owned.Count -ne 1){throw 'Expected one owned Edge window'}
$edge=Get-Process -Id $owned[0].ProcessId
[uint32]$foreground=0
[OwnedCapture]::GetWindowThreadProcessId([OwnedCapture]::GetForegroundWindow(),[ref]$foreground)|Out-Null
if($foreground -ne $edge.Id){throw 'Owned Edge is not foreground; refusing desktop capture'}
$rect=New-Object OwnedCapture+RECT
if([OwnedCapture]::DwmGetWindowAttribute($edge.MainWindowHandle,9,[ref]$rect,16) -ne 0){throw 'Cannot read owned window bounds'}
$work=New-Object OwnedCapture+RECT
if(-not [OwnedCapture]::SystemParametersInfo(0x30,0,[ref]$work,0)){throw 'Cannot read work area'}
$rect.left=[Math]::Max($rect.left,$work.left);$rect.top=[Math]::Max($rect.top,$work.top)
$rect.right=[Math]::Min($rect.right,$work.right);$rect.bottom=[Math]::Min($rect.bottom,$work.bottom)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$nvdaProcess=Get-Process nvda -ErrorAction SilentlyContinue|Select-Object -First 1
$viewerHandle=[IntPtr]::Zero
if($nvdaProcess){
 $pidCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,[int]$nvdaProcess.Id)
 $nameCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'NVDA Speech Viewer')
 $condition=New-Object System.Windows.Automation.AndCondition($pidCondition,$nameCondition)
 $viewerWindow=[System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children,$condition)
 if($viewerWindow){$viewerHandle=[IntPtr]$viewerWindow.Current.NativeWindowHandle}
}
$wasVisible=if($viewerHandle -ne [IntPtr]::Zero){[OwnedCapture]::ShowWindow($viewerHandle,0)}else{$false}
Start-Sleep -Milliseconds 180
$bitmap=New-Object Drawing.Bitmap ($rect.right-$rect.left),($rect.bottom-$rect.top)
$graphics=[Drawing.Graphics]::FromImage($bitmap)
try{$graphics.CopyFromScreen($rect.left,$rect.top,0,0,$bitmap.Size);$bitmap.Save($OutputPath,[Drawing.Imaging.ImageFormat]::Png)}finally{$graphics.Dispose();$bitmap.Dispose();if($wasVisible){[OwnedCapture]::ShowWindow($viewerHandle,4)|Out-Null}}
@{captured='owned Edge window only';width=$rect.right-$rect.left;height=$rect.bottom-$rect.top}|ConvertTo-Json -Compress
