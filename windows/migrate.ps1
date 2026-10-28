[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$OldInstall,[Parameter(Mandatory=$true)][string]$NewInstall,[Parameter(Mandatory=$true)][string]$OldConfig,[Parameter(Mandatory=$true)][string]$NewConfig,[switch]$Undo)
$ErrorActionPreference='Stop'
$journal=Join-Path $NewConfig 'migration-windows-integrations.json'
$shell=New-Object -ComObject WScript.Shell
if($Undo){
 if(!(Test-Path -LiteralPath $journal)){return}
 $entries=@( (Get-Content -LiteralPath $journal -Raw -Encoding UTF8|ConvertFrom-Json) );[array]::Reverse($entries)
 foreach($e in $entries){
  if($e.kind -eq 'registry'){
   $current=(Get-Item -LiteralPath $e.path).GetValue($e.name)
   if($current -ne $e.after){throw 'A registry integration changed during migration. It was retained for manual recovery.'}
   if($e.name -eq ''){Set-Item -LiteralPath $e.path -Value $e.before}else{Set-ItemProperty -LiteralPath $e.path -Name $e.name -Value $e.before}
  }elseif($e.kind -eq 'shortcut'){
   $link=$shell.CreateShortcut($e.path)
   if($link.Arguments -ne $e.after.Arguments -or $link.Description -ne 'AGPA local customization launcher'){throw 'A shortcut changed during migration. It was retained for manual recovery.'}
   foreach($key in @('Arguments','WorkingDirectory','IconLocation')){$link.$key=$e.before.$key};$link.Save()
  }
 }
 Remove-Item -LiteralPath $journal;return
}
if(Test-Path -LiteralPath $journal){throw 'An earlier Windows migration needs recovery before retrying.'}
function Move-InstallPath([string]$Text){
 return [regex]::Replace($Text,[regex]::Escape($OldInstall),[System.Text.RegularExpressions.MatchEvaluator]{param($match) $NewInstall},[System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
}
$entries=New-Object System.Collections.ArrayList
function Save-Change($entry){[void]$entries.Add($entry);[IO.File]::WriteAllText($journal,(ConvertTo-Json -InputObject @($entries.ToArray()) -Depth 8),(New-Object Text.UTF8Encoding($false)))}
$run='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run';$name='AntigravityLocalCustomizations'
$value=(Get-ItemProperty -LiteralPath $run -Name $name -ErrorAction SilentlyContinue).$name
$oldStart=Join-Path $OldInstall 'windows\start.ps1';$oldLegacyStart=Join-Path $OldInstall 'start-windows.ps1'
$psExe=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$runA='"'+$psExe+'" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$oldStart+'" -Watch'
$runB='"'+$psExe+'" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$oldLegacyStart+'" -Watch'
$ownedRun=@($runA,$runB)
if($value -and $value -in $ownedRun){$after=(Move-InstallPath $value);Save-Change @{kind='registry';path=$run;name=$name;before=$value;after=$after};Set-ItemProperty -LiteralPath $run -Name $name -Value $after}
foreach($file in @((Join-Path ([Environment]::GetFolderPath('Programs')) 'Antigravity (customized).lnk'),(Join-Path ([Environment]::GetFolderPath('Startup')) 'Antigravity Customizations.lnk'))){
 if(!(Test-Path -LiteralPath $file)){continue}
 $link=$shell.CreateShortcut($file)
 $launchA='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$oldStart+'" -Launch'
 $launchB='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$oldLegacyStart+'" -Launch'
 $ownedArgs=@($launchA,$launchB)
 if($link.Description -eq 'AGPA local customization launcher' -and $link.TargetPath -eq $psExe -and $link.Arguments -in $ownedArgs){
  $before=@{Arguments=$link.Arguments;WorkingDirectory=$link.WorkingDirectory;IconLocation=$link.IconLocation}
  $after=@{Arguments=(Move-InstallPath $link.Arguments);WorkingDirectory=(Move-InstallPath $link.WorkingDirectory);IconLocation=(Move-InstallPath $link.IconLocation)}
  Save-Change @{kind='shortcut';path=$file;before=$before;after=$after}
  foreach($key in @('Arguments','WorkingDirectory','IconLocation')){$link.$key=$after[$key]};$link.Save()
 }
}
$hostName='com.antigravity_plugin.browser'
foreach($browser in @('Google\Chrome','Chromium','Microsoft\Edge','BraveSoftware\Brave-Browser','Vivaldi','Opera Software')){
 $key='HKCU:\Software\'+$browser+'\NativeMessagingHosts\'+$hostName
 if(!(Test-Path -LiteralPath $key)){continue}
 $old=(Get-Item -LiteralPath $key).GetValue('')
 if($old -eq (Join-Path $OldConfig 'companion\browser-host.json')){
  $after=Join-Path $NewConfig 'companion\browser-host.json';Save-Change @{kind='registry';path=$key;name='';before=$old;after=$after};Set-Item -LiteralPath $key -Value $after
 }
}
