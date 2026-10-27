[CmdletBinding()]
param([string]$AppExe,[switch]$Launch)
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'windows\install.ps1') @PSBoundParameters
