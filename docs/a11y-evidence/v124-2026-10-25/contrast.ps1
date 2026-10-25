param([ValidateSet('status','enable','restore')][string]$Operation='status')
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class ContrastAudit {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct HIGHCONTRAST {
  public uint cbSize;public uint flags;public IntPtr scheme;
 }
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool SystemParametersInfo(uint action,uint size,ref HIGHCONTRAST value,uint flags);
}
'@
$statePath=Join-Path $PSScriptRoot 'contrast-original.json'
$value=New-Object ContrastAudit+HIGHCONTRAST
$value.cbSize=[Runtime.InteropServices.Marshal]::SizeOf($value)
if(-not [ContrastAudit]::SystemParametersInfo(0x42,$value.cbSize,[ref]$value,0)){throw 'Cannot read Windows contrast state'}
if($Operation -eq 'enable'){
 if(Test-Path -LiteralPath $statePath){throw 'An earlier contrast session must be restored first'}
 @{flags=$value.flags;scheme=[Runtime.InteropServices.Marshal]::PtrToStringUni($value.scheme)}|ConvertTo-Json|Set-Content -LiteralPath $statePath -Encoding utf8
 $value.flags=$value.flags -bor 1
 if(-not [ContrastAudit]::SystemParametersInfo(0x43,$value.cbSize,[ref]$value,2)){throw 'Cannot temporarily enable Windows contrast'}
}elseif($Operation -eq 'restore'){
 $saved=Get-Content -LiteralPath $statePath -Raw|ConvertFrom-Json
 $value.flags=$saved.flags
 if(-not [ContrastAudit]::SystemParametersInfo(0x43,$value.cbSize,[ref]$value,2)){throw 'Cannot restore Windows contrast'}
 Remove-Item -LiteralPath $statePath
}
if(-not [ContrastAudit]::SystemParametersInfo(0x42,$value.cbSize,[ref]$value,0)){throw 'Cannot verify Windows contrast state'}
@{flags=$value.flags;enabled=[bool]($value.flags -band 1);scheme=[Runtime.InteropServices.Marshal]::PtrToStringUni($value.scheme);operation=$Operation}|ConvertTo-Json -Compress
