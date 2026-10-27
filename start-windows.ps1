[CmdletBinding()]
param([switch]$Launch,[switch]$Watch,[switch]$Stop)
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'windows\start.ps1') @PSBoundParameters
