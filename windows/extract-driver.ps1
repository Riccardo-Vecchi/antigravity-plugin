param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($Archive)
try {
  $found=$false
  foreach($entry in $zip.Entries) {
    # Extract only root runtime executables/libraries from the hash-pinned asset.
    if($entry.FullName -notmatch '^(cua-driver\.exe|cua-driver-uia\.exe|cua-cursor-theme\.exe|[a-zA-Z0-9_-]+\.dll)$'){continue}
    if($entry.Length -gt 188743680){throw 'Unexpected driver member size.'}
    $target=Join-Path $Destination $entry.FullName
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$false)
    if($entry.FullName -eq 'cua-driver.exe'){$found=$true}
  }
  if(!$found){throw 'The verified archive does not contain Cua Driver.'}
} finally {$zip.Dispose()}
