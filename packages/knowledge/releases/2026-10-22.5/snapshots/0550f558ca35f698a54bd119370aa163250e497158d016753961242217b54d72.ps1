param([Parameter(Mandatory=$true)][string]$JobFile,[Parameter(Mandatory=$true)][string]$NativeOutputRoot)
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class OwnedHwpWindowProcess {
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
}
'@
$utf8=New-Object Text.UTF8Encoding($false)
New-Item -ItemType Directory -Force -Path $NativeOutputRoot|Out-Null
$jobs=Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8|ConvertFrom-Json
$all=@()
foreach($job in $jobs.jobs){
  $id=[string]$job.dataset
  $revision=[string]$job.revision
  if($revision -notmatch '^r[0-9]+$'){throw 'Explicit revision required for an immutable native render'}
  $inputCopy=Join-Path $NativeOutputRoot ($id+'-feedback-'+$revision+'-native-working.hwpx')
  $pdf=Join-Path $NativeOutputRoot ($id+'-feedback-'+$revision+'-native.pdf')
  $receiptPath=Join-Path $NativeOutputRoot ($id+'-native.json')
  if((Test-Path -LiteralPath $inputCopy) -or (Test-Path -LiteralPath $pdf) -or (Test-Path -LiteralPath $receiptPath)){throw 'Existing versioned native evidence must not be overwritten'}
  Copy-Item -LiteralPath ([string]$job.inputWindowsPath) -Destination $inputCopy
  $actual=(Get-FileHash -LiteralPath $inputCopy -Algorithm SHA256).Hash.ToLowerInvariant()
  if($actual -ne [string]$job.sha256){throw 'Native input copy hash does not match the exact composition job'}
  $r=[ordered]@{
    schema='math-editing.feedback-native-render.v3';dataset=$id;revision=$revision;startedAt=[DateTime]::UtcNow.ToString('o')
    inputPath=$inputCopy;inputSha256=$actual;sourceCompositionPath=[string]$job.inputWindowsPath
    stage='copy-verified';freshComInstance=$true;existingApplicationAttached=$false
    registryChanged=$false;securityModuleRegistrationChanged=$false
    openSucceeded=$false;pdfExportSucceeded=$false;ownedInstanceQuit=$false;acceptanceDecision=$null
  }
  $hwp=$null;$ownedQualified=$false
  $preexisting=@(Get-Process -Name Hwp -ErrorAction SilentlyContinue | Select-Object Id,StartTime,MainWindowHandle)
  $r.preexistingHwpProcesses=$preexisting
  try{
    [IO.File]::WriteAllText($receiptPath,($r|ConvertTo-Json -Depth 9),$utf8)
    $hwp=New-Object -ComObject HWPFrame.HwpObject
    $nativeWindow=$hwp.XHwpWindows.Item(0)
    $hwnd=[IntPtr][int64]$nativeWindow.WindowHandle
    [uint32]$windowProcessId=0
    [void][OwnedHwpWindowProcess]::GetWindowThreadProcessId($hwnd,[ref]$windowProcessId)
    $priorIds=@($preexisting|ForEach-Object{$_.Id})
    if($windowProcessId -eq 0 -or $windowProcessId -in $priorIds){throw 'Owned COM window does not belong to a newly created process; no Open/Visible/Quit is permitted'}
    $owned=Get-Process -Id $windowProcessId -ErrorAction Stop
    if($owned.ProcessName -ne 'Hwp'){throw 'Owned COM window process is not Hwp'}
    $ownedQualified=$true
    $r.ownedProcessId=[int]$windowProcessId;$r.ownedWindowHandle=[string]$hwnd
    $r.ownershipMethod='Fresh COM object WindowHandle resolved by GetWindowThreadProcessId; PID excluded from preexisting process baseline'
    $r.usedGetActiveObject=$false
    $hwp.XHwpWindows.Item(0).Visible=$false
    $r.stage='opening-owned-copy'
    [IO.File]::WriteAllText($receiptPath,($r|ConvertTo-Json -Depth 9),$utf8)
    $r.openSucceeded=[bool]$hwp.Open($inputCopy,'','')
    if(-not $r.openSucceeded){throw 'Hancom did not open the exact composed copy'}
    $r.version=[string]$hwp.Version;$r.pageCount=[int]$hwp.PageCount
    $controls=@();$c=$hwp.HeadCtrl;$i=0
    while($null -ne $c -and $i -lt 20000){$controls += [string]$c.CtrlID;$c=$c.Next;$i++}
    $r.controlTraversal='HeadCtrl/Next; nested-table control reachability not assumed'
    $r.controlCounts=[ordered]@{eqed=@($controls|Where-Object{$_ -eq 'eqed'}).Count;gso=@($controls|Where-Object{$_ -eq 'gso'}).Count;tbl=@($controls|Where-Object{$_ -eq 'tbl'}).Count}
    $r.stage='exporting-pdf'
    [IO.File]::WriteAllText($receiptPath,($r|ConvertTo-Json -Depth 9),$utf8)
    $r.pdfExportSucceeded=[bool]$hwp.SaveAs($pdf,'PDF','')
    if(-not $r.pdfExportSucceeded -or -not(Test-Path -LiteralPath $pdf)){throw 'Owned native PDF export failed'}
    $r.pdfPath=$pdf;$r.pdfSha256=(Get-FileHash -LiteralPath $pdf -Algorithm SHA256).Hash.ToLowerInvariant()
    $r.stage='opened-and-rendered'
  }catch{$r.stage='native-check-incomplete';$r.error=$_.Exception.Message}
  finally{
    if($null -ne $hwp){if($ownedQualified){try{$hwp.Quit();$r.ownedInstanceQuit=$true}catch{$r.quitError=$_.Exception.Message}};[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($hwp)}
    $r.preexistingProcessesAfter=@($preexisting|ForEach-Object{$old=$_;$live=Get-Process -Id $old.Id -ErrorAction SilentlyContinue;[ordered]@{id=$old.Id;stillRunning=($null -ne $live);oldMainWindowHandle=[string]$old.MainWindowHandle;currentMainWindowHandle=if($live){[string]$live.MainWindowHandle}else{$null}}})
  }
  $r.finishedAt=[DateTime]::UtcNow.ToString('o')
  [IO.File]::WriteAllText($receiptPath,($r|ConvertTo-Json -Depth 9),$utf8)
  $all += $r
}
[IO.File]::WriteAllText((Join-Path $NativeOutputRoot 'native-render.json'),($all|ConvertTo-Json -Depth 9),$utf8)
$all|ConvertTo-Json -Depth 9
