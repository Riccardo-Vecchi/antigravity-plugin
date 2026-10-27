[CmdletBinding()]
param([string]$AppExe,[switch]$Launch)
$ErrorActionPreference='Stop'
if(!$AppExe){
 $candidates=@((Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\Antigravity.exe'),(Join-Path $env:ProgramFiles 'Antigravity\Antigravity.exe'))
 $AppExe=$candidates|Where-Object {Test-Path -LiteralPath $_}|Select-Object -First 1
}
if(!$AppExe -or !(Test-Path -LiteralPath $AppExe)){throw 'Install the official Antigravity App first, or pass -AppExe with its path.'}
$AppExe=(Resolve-Path -LiteralPath $AppExe).Path
if([IO.Path]::GetFileName($AppExe) -ne 'Antigravity.exe'){throw 'Expected the official Antigravity.exe executable.'}
$signature=Get-AuthenticodeSignature -LiteralPath $AppExe
if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Google LLC'){throw 'The application must have a valid Google signature.'}
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
if(Test-Path -LiteralPath (Join-Path $target 'start-windows.ps1')){& (Join-Path $target 'start-windows.ps1') -Stop}
$files=@('versions.cjs','daemon.cjs','renderer.js','app-settings.js','i18n.js','locales.json','gemini-switch.js','gemini-switch.css','gemini-inline.js','shortcuts.js','window-chrome.css','switch-assets.json','compatibility.cjs','session-state.cjs','desktop-icon.cjs','desktop-windows.cjs','platform-paths.cjs','app-preferences.cjs','prepare-reload.cjs','cdp-connection.cjs','windows-launcher.cjs','windows-native-attach.cjs','windows-native-controller.cjs','windows-autostart.ps1','start-windows.ps1','disable-windows.ps1','WINDOWS.md','NOTICE.md')
foreach($file in $files){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $target $file) -Force}
[void](New-Item -ItemType Directory -Force -Path (Join-Path $target 'icons'))
foreach($file in @('antigravity.png','gemini-512.png','antigravity.ico','gemini.ico')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('icons\'+$file)) -Destination (Join-Path $target ('icons\'+$file)) -Force}
[IO.File]::WriteAllText((Join-Path $config 'installation.json'),(@{version=1;appExe=$AppExe;nativeIconsSupported=$nativeIcons}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
$psExe=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$start=Join-Path $target 'start-windows.ps1'
$run='"'+$psExe+'" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$start+'" -Watch'
$runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run';$valueName='AntigravityLocalCustomizations'
$previous=Get-ItemPropertyValue -LiteralPath $runKey -Name $valueName -ErrorAction SilentlyContinue
if($previous -and $previous -ne $run){throw 'An unrelated helper startup entry already exists.'}
[void](New-Item -Path $runKey -Force);[void](New-ItemProperty -LiteralPath $runKey -Name $valueName -Value $run -PropertyType String -Force)
$shortcut=Join-Path ([Environment]::GetFolderPath('Programs')) 'Antigravity (customized).lnk'
$shell=New-Object -ComObject WScript.Shell;$link=$shell.CreateShortcut($shortcut)
if((Test-Path -LiteralPath $shortcut) -and $link.Description -ne 'AGPA local customization launcher'){throw 'An unrelated customized launcher already exists.'}
$link.TargetPath=$psExe;$link.Arguments='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$start+'" -Launch'
$link.WorkingDirectory=$target;$link.WindowStyle=7;$link.IconLocation=$AppExe;$link.Description='AGPA local customization launcher';$link.Save()
& $start -Watch
if($Launch){& $start -Launch}
Write-Output 'Installed for the current user. Open Antigravity (customized) from Start.'
