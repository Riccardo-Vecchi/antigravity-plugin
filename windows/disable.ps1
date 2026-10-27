[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$config=Join-Path $env:APPDATA 'antigravity-project-appearance'
$installation=Get-Content -LiteralPath (Join-Path $config 'installation.json') -Raw -Encoding UTF8|ConvertFrom-Json
$oldRuntime=$env:ELECTRON_RUN_AS_NODE
try{
 $env:ELECTRON_RUN_AS_NODE='1'
 & $installation.appExe -e "require(process.argv[1]).restoreIntegration().catch(e=>{console.error(e.message);process.exit(1)})" (Join-Path $PSScriptRoot 'desktop.cjs')
 if($LASTEXITCODE -ne 0){throw 'Could not restore the native icon preference.'}
}finally{$env:ELECTRON_RUN_AS_NODE=$oldRuntime}
& (Join-Path $root 'start-windows.ps1') -Stop
$runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run';$name='AntigravityLocalCustomizations'
$value=Get-ItemPropertyValue -LiteralPath $runKey -Name $name -ErrorAction SilentlyContinue
$psExe=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$start=Join-Path $root 'start-windows.ps1'
$expectedRun='"'+$psExe+'" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$start+'" -Watch'
if($value -eq $expectedRun){Remove-ItemProperty -LiteralPath $runKey -Name $name}
$shortcut=Join-Path ([Environment]::GetFolderPath('Programs')) 'Antigravity (customized).lnk'
if(Test-Path -LiteralPath $shortcut){
 $shell=New-Object -ComObject WScript.Shell;$link=$shell.CreateShortcut($shortcut)
 $expectedArgs='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$start+'" -Launch'
 if($link.TargetPath -eq $psExe -and $link.Arguments -eq $expectedArgs -and $link.Description -eq 'AGPA local customization launcher'){Remove-Item -LiteralPath $shortcut}
}
Write-Output 'Helper disabled and app autostart removed. Reopen Antigravity to remove the injected UI. Preferences and sessions were retained.'
