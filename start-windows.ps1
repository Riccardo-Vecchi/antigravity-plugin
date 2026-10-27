[CmdletBinding()]
param([switch]$Launch,[switch]$Watch,[switch]$Stop)
$ErrorActionPreference='Stop'
$record=Join-Path $env:APPDATA 'antigravity-project-appearance\installation.json'
$installation=Get-Content -LiteralPath $record -Raw -Encoding UTF8|ConvertFrom-Json
if($installation.version -ne 1 -or !(Test-Path -LiteralPath $installation.appExe)){throw 'Run install-windows.ps1 first.'}
$command=if($Stop){'--stop'}elseif($Watch){'--watch'}else{'--launch'}
$script=Join-Path $PSScriptRoot 'windows-launcher.cjs'
$info=New-Object System.Diagnostics.ProcessStartInfo
$info.FileName=$installation.appExe;$info.Arguments='"'+$script+'" '+$command
$info.WorkingDirectory=$PSScriptRoot;$info.UseShellExecute=$false;$info.CreateNoWindow=$true
$info.EnvironmentVariables['ELECTRON_RUN_AS_NODE']='1'
$process=[System.Diagnostics.Process]::Start($info)
if($Stop){[void]$process.WaitForExit(5000)}
