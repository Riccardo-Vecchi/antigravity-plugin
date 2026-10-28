[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$config=Join-Path $env:APPDATA 'antigravity-project-appearance'
$installation=Get-Content -LiteralPath (Join-Path $config 'installation.json') -Raw -Encoding UTF8|ConvertFrom-Json
$oldRuntime=$env:ELECTRON_RUN_AS_NODE
try{
 $env:ELECTRON_RUN_AS_NODE='1'
 $computerUse=Join-Path $root 'common\computer-use-cli.cjs'
 if(Test-Path -LiteralPath $computerUse){
  & $installation.appExe $computerUse disconnect
  if($LASTEXITCODE -ne 0){Write-Warning 'Computer-use lease revoked; review native MCP settings.'}
 }
 & $installation.appExe -e "require(process.argv[1]).restoreIntegration().catch(e=>{console.error(e.message);process.exit(1)})" (Join-Path $PSScriptRoot 'desktop.cjs')
 if($LASTEXITCODE -ne 0){throw 'Could not restore the native icon preference.'}
}finally{$env:ELECTRON_RUN_AS_NODE=$oldRuntime}
& (Join-Path $PSScriptRoot 'start.ps1') -Stop
$runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run';$name='AntigravityLocalCustomizations'
$value=(Get-ItemProperty -LiteralPath $runKey -Name $name -ErrorAction SilentlyContinue).$name
$psExe=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$start=Join-Path $PSScriptRoot 'start.ps1'
$expectedRun='"'+$psExe+'" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$start+'" -Watch'
$legacyStart=Join-Path $root 'start-windows.ps1'
$legacyRun='"'+$psExe+'" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$legacyStart+'" -Watch'
if($value -in @($expectedRun,$legacyRun)){Remove-ItemProperty -LiteralPath $runKey -Name $name}
$shortcut=Join-Path ([Environment]::GetFolderPath('Programs')) 'Antigravity (customized).lnk'
if(Test-Path -LiteralPath $shortcut){
 $shell=New-Object -ComObject WScript.Shell;$link=$shell.CreateShortcut($shortcut)
 $expectedArgs='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$start+'" -Launch'
 $legacyArgs='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$legacyStart+'" -Launch'
 if($link.TargetPath -eq $psExe -and $link.Arguments -in @($expectedArgs,$legacyArgs) -and $link.Description -eq 'AGPA local customization launcher'){Remove-Item -LiteralPath $shortcut}
}
Write-Output 'Helper disabled and app autostart removed. Reopen Antigravity to remove the injected UI. Preferences and sessions were retained.'
