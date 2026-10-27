[CmdletBinding()]
param([ValidateSet('Read','Enable','Disable')][string]$Action='Read')
$ErrorActionPreference='Stop'
$startup=[Environment]::GetFolderPath('Startup')
$linkPath=Join-Path $startup 'Antigravity Customizations.lnk'
$launcher=Join-Path $PSScriptRoot 'start-windows.ps1'
$shellExe=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$expectedArgs='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$launcher+'" -Launch'
$shell=New-Object -ComObject WScript.Shell
$owned=$false
if(Test-Path -LiteralPath $linkPath){
 $old=$shell.CreateShortcut($linkPath)
 $owned=($old.TargetPath -eq $shellExe -and $old.Arguments -eq $expectedArgs -and $old.Description -eq 'AGPA local customization launcher')
 if(!$owned -and $Action -ne 'Read'){throw 'An unrelated startup shortcut already exists.'}
}
if($Action -eq 'Enable'){
 $link=$shell.CreateShortcut($linkPath);$link.TargetPath=$shellExe;$link.Arguments=$expectedArgs
 $link.WorkingDirectory=$PSScriptRoot;$link.WindowStyle=7;$link.Description='AGPA local customization launcher'
 $link.IconLocation=(Join-Path $PSScriptRoot 'icons\antigravity.ico');$link.Save();$owned=$true
}elseif($Action -eq 'Disable' -and $owned){Remove-Item -LiteralPath $linkPath;$owned=$false}
@{enabled=$owned}|ConvertTo-Json -Compress
