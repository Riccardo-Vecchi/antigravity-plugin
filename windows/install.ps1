[CmdletBinding()]
param([string]$AppExe,[switch]$Launch)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
if(!$AppExe){
 $candidates=@((Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\Antigravity.exe'),(Join-Path $env:ProgramFiles 'Antigravity\Antigravity.exe'))
 $AppExe=$candidates|Where-Object {Test-Path -LiteralPath $_}|Select-Object -First 1
}
if(!$AppExe -or !(Test-Path -LiteralPath $AppExe)){throw 'Install the official Antigravity App first, or pass -AppExe with its path.'}
$AppExe=(Resolve-Path -LiteralPath $AppExe).Path
if([IO.Path]::GetFileName($AppExe) -ne 'Antigravity.exe'){throw 'Expected the official Antigravity.exe executable.'}
$signature=Get-AuthenticodeSignature -LiteralPath $AppExe
if($signature.Status -notin @('Valid','NotSigned') -or ($signature.Status -eq 'Valid' -and $signature.SignerCertificate.Subject -notmatch 'Google LLC')){throw 'The application signature is invalid or does not identify Google LLC.'}
$bytes=[IO.File]::ReadAllBytes($AppExe);$marker='dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'
$offset=[Text.Encoding]::ASCII.GetString($bytes).IndexOf($marker,[StringComparison]::Ordinal)+$marker.Length
if($offset -lt $marker.Length -or $bytes[$offset] -ne 1 -or $bytes[$offset+1] -lt 4 -or $bytes[$offset+2] -ne 49){throw 'This build does not provide the supported companion runtime.'}
$nativeIcons=($bytes[$offset+5] -eq 49)
if(!$nativeIcons){throw 'This app build does not expose the supported native icon integration. The executable and its security fuses will remain unchanged.'}
$target=Join-Path $env:LOCALAPPDATA 'antigravity-plugin'
$config=Join-Path $env:APPDATA 'antigravity-plugin'
foreach($directory in @($target,$config)){
 if(Test-Path -LiteralPath $directory){if((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Integration folders must not be junctions or symbolic links.'}}
 [void](New-Item -ItemType Directory -Force -Path $directory)
}
$manifest=Get-Content -LiteralPath (Join-Path $root 'common\distribution.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($manifest.version -ne 1){throw 'Unsupported distribution manifest.'}
$files=@($manifest.common)+@($manifest.windows)
$destinations=@{}
foreach($file in $files){
 $relative=$file
 foreach($mapping in $manifest.mappings.PSObject.Properties){if($file.StartsWith($mapping.Name)){$relative=$mapping.Value+$file.Substring($mapping.Name.Length);break}}
 if([IO.Path]::IsPathRooted($relative) -or $relative -match '(^|[\\/])\.\.([\\/]|$)' -or $destinations.ContainsKey($relative)){throw 'Invalid deployment target.'}
 $destinations[$relative]=$true
 if([IO.Path]::IsPathRooted($file) -or $file -match '(^|[\\/])\.\.([\\/]|$)' -or !(Test-Path -LiteralPath (Join-Path $root $file) -PathType Leaf)){throw 'Invalid distribution file.'}
}
function Invoke-PluginScript([string]$Script,[string]$Arguments=''){
 $info=New-Object System.Diagnostics.ProcessStartInfo
 $info.FileName=$AppExe;$info.Arguments='"'+$Script+'" '+$Arguments
 $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.EnvironmentVariables['ELECTRON_RUN_AS_NODE']='1'
 $child=[System.Diagnostics.Process]::Start($info);$child.WaitForExit()
 if($child.ExitCode -ne 0){throw ('Plugin operation failed: '+[IO.Path]::GetFileName($Script)+'. Existing data was retained.')}
}
Invoke-PluginScript (Join-Path $root 'common\migration.cjs') '--prepare'
Invoke-PluginScript (Join-Path $root 'common\prepare-reload.cjs')
$runtimeFile=Join-Path $config 'updates\runtime.json';$previousPid=$null
if(Test-Path -LiteralPath $runtimeFile){try{$previousPid=(Get-Content -LiteralPath $runtimeFile -Raw -Encoding UTF8|ConvertFrom-Json).pid}catch{}}
# Always stop through source code: moved old launch scripts still contain the old data path.
Invoke-PluginScript (Join-Path $root 'windows\launcher.cjs') '--stop'
if(($previousPid -is [int] -or $previousPid -is [long]) -and $previousPid -gt 0){
 for($attempt=0;$attempt -lt 60;$attempt++){
  if(!(Get-Process -Id $previousPid -ErrorAction SilentlyContinue)){break}
  if($attempt -eq 59){throw 'The previous helper is still stopping. Retry the installer shortly.'}
  Start-Sleep -Milliseconds 100
 }
}
foreach($file in $files){
 $relative=$file
 foreach($mapping in $manifest.mappings.PSObject.Properties){if($file.StartsWith($mapping.Name)){$relative=$mapping.Value+$file.Substring($mapping.Name.Length);break}}
 $destination=Join-Path $target $relative
 [void](New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination))
 Copy-Item -LiteralPath (Join-Path $root $file) -Destination $destination -Force
}
[IO.File]::WriteAllText((Join-Path $config 'installation.json'),(@{version=1;appExe=$AppExe;nativeIconsSupported=$nativeIcons}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
Invoke-PluginScript (Join-Path $target 'common\plugin-update-cli.cjs') ('receipt "'+$target+'"')
$psExe=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$start=Join-Path $target 'windows\start.ps1'
$legacyStart=Join-Path $target 'start-windows.ps1'
$run='"'+$psExe+'" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$start+'" -Watch'
$runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run';$valueName='AntigravityLocalCustomizations'
$previous=(Get-ItemProperty -LiteralPath $runKey -Name $valueName -ErrorAction SilentlyContinue).$valueName
$legacyRun='"'+$psExe+'" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$legacyStart+'" -Watch'
if($previous -and $previous -notin @($run,$legacyRun)){throw 'An unrelated helper startup entry already exists.'}
[void](New-Item -Path $runKey -Force);[void](New-ItemProperty -LiteralPath $runKey -Name $valueName -Value $run -PropertyType String -Force)
$shortcut=Join-Path ([Environment]::GetFolderPath('Programs')) 'Antigravity (customized).lnk'
$shell=New-Object -ComObject WScript.Shell;$link=$shell.CreateShortcut($shortcut)
$expectedLaunch='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$start+'" -Launch'
$legacyLaunch='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$legacyStart+'" -Launch'
if((Test-Path -LiteralPath $shortcut) -and ($link.Description -ne 'AGPA local customization launcher' -or $link.TargetPath -ne $psExe -or $link.Arguments -notin @($expectedLaunch,$legacyLaunch))){throw 'An unrelated customized launcher already exists.'}
$link.TargetPath=$psExe;$link.Arguments='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$start+'" -Launch'
$link.WorkingDirectory=$target;$link.WindowStyle=7;$link.IconLocation=$AppExe;$link.Description='AGPA local customization launcher';$link.Save()
$auto=Join-Path $target 'windows\autostart.ps1'
if((& $auto -Action Read|ConvertFrom-Json).enabled){& $auto -Action Enable|Out-Null}
& $start -Watch
Invoke-PluginScript (Join-Path $target 'common\migration.cjs') '--finish'
if($Launch){& $start -Launch}
Write-Output 'Installed for the current user. Open Antigravity (customized) from Start.'
