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
if($signature.Status -notin @('Valid','NotSigned') -or ($signature.Status -eq 'Valid' -and $signature.SignerCertificate.Subject -notmatch 'Google LLC')){throw 'The application must have a valid Google signature.'}
$bytes=[IO.File]::ReadAllBytes($AppExe);$marker='dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'
$offset=[Text.Encoding]::ASCII.GetString($bytes).IndexOf($marker,[StringComparison]::Ordinal)+$marker.Length
if($offset -lt $marker.Length -or $bytes[$offset] -ne 1 -or $bytes[$offset+1] -lt 4 -or $bytes[$offset+2] -ne 49){throw 'This build does not provide the supported companion runtime.'}
$nativeIcons=($bytes[$offset+5] -eq 49)
if(!$nativeIcons){throw 'This app build does not expose the supported native icon integration. The executable and its security fuses will remain unchanged.'}
$target=Join-Path $env:LOCALAPPDATA 'antigravity-project-appearance'
$config=Join-Path $env:APPDATA 'antigravity-project-appearance'
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
if(Test-Path -LiteralPath (Join-Path $target 'windows\start.ps1')){& (Join-Path $target 'windows\start.ps1') -Stop}elseif(Test-Path -LiteralPath (Join-Path $target 'start-windows.ps1')){& (Join-Path $target 'start-windows.ps1') -Stop}
foreach($file in $files){
 $relative=$file
 foreach($mapping in $manifest.mappings.PSObject.Properties){if($file.StartsWith($mapping.Name)){$relative=$mapping.Value+$file.Substring($mapping.Name.Length);break}}
 $destination=Join-Path $target $relative
 [void](New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination))
 Copy-Item -LiteralPath (Join-Path $root $file) -Destination $destination -Force
}
[IO.File]::WriteAllText((Join-Path $config 'installation.json'),(@{version=1;appExe=$AppExe;nativeIconsSupported=$nativeIcons}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
$receiptInfo=New-Object System.Diagnostics.ProcessStartInfo
$receiptInfo.FileName=$AppExe;$receiptInfo.Arguments='"'+(Join-Path $target 'common\plugin-update-cli.cjs')+'" receipt "'+$target+'"'
$receiptInfo.UseShellExecute=$false;$receiptInfo.CreateNoWindow=$true;$receiptInfo.EnvironmentVariables['ELECTRON_RUN_AS_NODE']='1'
$receiptProcess=[System.Diagnostics.Process]::Start($receiptInfo);$receiptProcess.WaitForExit()
if($receiptProcess.ExitCode -ne 0){throw 'Could not register the update receipt.'}
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
if($Launch){& $start -Launch}
Write-Output 'Installed for the current user. Open Antigravity (customized) from Start.'
