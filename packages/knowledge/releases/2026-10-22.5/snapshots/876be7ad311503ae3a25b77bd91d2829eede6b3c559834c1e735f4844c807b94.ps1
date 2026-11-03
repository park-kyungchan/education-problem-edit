param([string]$JobFile)
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LayoutOwnedPid {
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);
}
'@
$job=Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8|ConvertFrom-Json
$utf8=New-Object Text.UTF8Encoding($false)
$receipt=[ordered]@{schema='daechi.template-native.v1';startedAt=[DateTime]::UtcNow.ToString('o');mode=$job.mode;registryChanged=$false;securityModuleChanged=$false;newPaidCalls=0;acceptanceDecision=$null}
$baseline=@(Get-Process -Name Hwp -ErrorAction SilentlyContinue|Select-Object Id,StartTime,MainWindowHandle)
$receipt.baseline=$baseline;$owned=$false;$hwp=$null
try {
 $hwp=New-Object -ComObject HWPFrame.HwpObject
 $hwnd=[IntPtr][int64]$hwp.XHwpWindows.Item(0).WindowHandle
 [uint32]$nativePid=0;[void][LayoutOwnedPid]::GetWindowThreadProcessId($hwnd,[ref]$nativePid)
 if($nativePid -eq 0 -or $nativePid -in @($baseline|ForEach-Object{$_.Id})){throw 'Fresh ownership not established; no document operations permitted'}
 if((Get-Process -Id $nativePid).ProcessName -ne 'Hwp'){throw 'Unexpected process owner'}
 $owned=$true;$receipt.ownedPid=$nativePid;$receipt.windowHandle=[string]$hwnd;$receipt.version=[string]$hwp.Version
 $hwp.XHwpWindows.Item(0).Visible=$false
 $receipt.documents=@()
 foreach($doc in $job.documents){
  if(-not $hwp.Open([string]$doc.input,'','')){throw ('Open failed: '+$doc.input)}
  $d=[ordered]@{id=$doc.id;input=$doc.input;pageCount=[int]$hwp.PageCount}
  $controls=@();$c=$hwp.HeadCtrl
  while($null -ne $c){$controls += [string]$c.CtrlID;$c=$c.Next}
  $d.controlCounts=@($controls|Group-Object|ForEach-Object{[ordered]@{id=$_.Name;count=$_.Count}})
  if($doc.title){
   $a=$hwp.CreateAction('DocSummaryInfo');$s=$a.CreateSet();[void]$a.GetDefault($s);[void]$s.SetItem('Title',[string]$doc.title)
   if(-not $a.Execute($s)){throw 'Title update failed'}
  }
  $a=$hwp.CreateAction('DocSummaryInfo');$s=$a.CreateSet();[void]$a.GetDefault($s);$d.title=[string]$s.Item('Title')
  foreach($format in @('HWP','HWPX','PDF')){
   $dest=$doc.($format.ToLowerInvariant())
   if($dest){if(Test-Path -LiteralPath $dest){throw ('Refusing overwrite: '+$dest)};if(-not $hwp.SaveAs([string]$dest,$format,'')){throw ('Save failed: '+$format)};$d.($format.ToLowerInvariant())=$dest}
  }
  if($doc.hml){$xml=[string]$hwp.GetTextFile('HWPML2X','');[IO.File]::WriteAllText([string]$doc.hml,$xml,$utf8)}
  if($doc.text){[IO.File]::WriteAllText([string]$doc.text,[string]$hwp.GetTextFile('TEXT',''),$utf8)}
  $receipt.documents += $d
  [void]$hwp.Clear(1)
 }
}catch{$receipt.error=$_.Exception.ToString()}
finally{
 if($null -ne $hwp){if($owned){$hwp.Quit();$receipt.ownedQuit=$true};[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($hwp)}
 $receipt.baselineAfter=@($baseline|ForEach-Object{$old=$_;$live=Get-Process -Id $old.Id -ErrorAction SilentlyContinue;[ordered]@{id=$old.Id;stillRunning=($null -ne $live);sameStartTime=if($live){$live.StartTime -eq $old.StartTime}else{$false}}})
 $receipt.finishedAt=[DateTime]::UtcNow.ToString('o')
 [IO.File]::WriteAllText([string]$job.receipt,($receipt|ConvertTo-Json -Depth 12),$utf8)
}
$receipt|ConvertTo-Json -Depth 12
if($receipt.error){exit 1}
