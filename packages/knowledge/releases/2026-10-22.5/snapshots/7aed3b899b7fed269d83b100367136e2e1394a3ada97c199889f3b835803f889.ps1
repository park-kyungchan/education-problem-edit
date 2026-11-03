$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MetricHwpPid {
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);
}
'@
$root='C:\Users\packr\Downloads\Daechi-feedback-20261022'
$utf8=New-Object Text.UTF8Encoding($false)
$receipt=[ordered]@{schema='daechi.native-equation-metrics.v1';startedAt=[DateTime]::UtcNow.ToString('o');newPaidCalls=0;acceptanceDecision=$null}
$prior=@(Get-Process -Name Hwp -ErrorAction SilentlyContinue|Select-Object Id,StartTime)
$owned=$false;$hwp=$null
try{
 $hwp=New-Object -ComObject HWPFrame.HwpObject
 $hwnd=[IntPtr][int64]$hwp.XHwpWindows.Item(0).WindowHandle
 [uint32]$hwpPid=0;[void][MetricHwpPid]::GetWindowThreadProcessId($hwnd,[ref]$hwpPid)
 if($hwpPid -eq 0 -or $hwpPid -in @($prior|ForEach-Object{$_.Id})){throw 'Fresh ownership not established'}
 $owned=$true;$receipt.ownedPid=$hwpPid;$receipt.nativeVersion=[string]$hwp.Version
 $hwp.XHwpWindows.Item(0).Visible=$false
 if(-not $hwp.Open((Join-Path $root 'metrics-blank.hwpx'),'','')){throw 'Blank open failed'}
 [void]$hwp.HAction.Run('MoveDocEnd');[void]$hwp.HAction.Run('BreakPara')
 $items=Get-Content (Join-Path $root 'metrics-request.json') -Raw -Encoding UTF8|ConvertFrom-Json
 $done=0
 foreach($item in $items){
  $txt=$hwp.HParameterSet.HInsertText;[void]$hwp.HAction.GetDefault('InsertText',$txt.HSet);$txt.Text=('E{0:D4} ' -f [int]$item.index);[void]$hwp.HAction.Execute('InsertText',$txt.HSet)
  $eq=$hwp.HParameterSet.HEqEdit;[void]$hwp.HAction.GetDefault('EquationCreate',$eq.HSet)
  $eq.String=[string]$item.script;$eq.BaseUnit=[int]$item.baseUnit;$eq.EqFontName='HYhwpEQ'
  if(-not $hwp.HAction.Execute('EquationCreate',$eq.HSet)){throw ('EquationCreate failed at '+$item.index)}
  [void]$hwp.HAction.Run('MoveLineEnd');[void]$hwp.HAction.Run('BreakPara');$done++
 }
 $receipt.equationsCreated=$done
 $receipt.hwpxSaved=[bool]$hwp.SaveAs((Join-Path $root 'native-equation-metrics-r1.hwpx'),'HWPX','')
 $receipt.pdfSaved=[bool]$hwp.SaveAs((Join-Path $root 'native-equation-metrics-r1.pdf'),'PDF','')
}catch{$receipt.error=$_.Exception.Message}
finally{if($null -ne $hwp){if($owned){$hwp.Quit();$receipt.ownedQuit=$true};[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($hwp)}}
$receipt.finishedAt=[DateTime]::UtcNow.ToString('o')
[IO.File]::WriteAllText((Join-Path $root 'metrics-receipt.json'),($receipt|ConvertTo-Json -Depth 8),$utf8)
$receipt|ConvertTo-Json -Depth 8
