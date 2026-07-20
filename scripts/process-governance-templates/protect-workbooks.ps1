param(
  [Parameter(Mandatory = $true)][string]$WorkbookDirectory
)

$excel = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.EnableEvents = $false
  $excel.AskToUpdateLinks = $false
  $excel.AutomationSecurity = 3

  Get-ChildItem -LiteralPath $WorkbookDirectory -Filter '*.xlsx' | Sort-Object Name | ForEach-Object {
    $workbook = $null
    $snapshotSheet = $null
    try {
      $workbook = $excel.Workbooks.Open($_.FullName, 0, $false)
      $snapshotSheet = $workbook.Worksheets.Item('99_来源快照')
      if (-not $snapshotSheet.ProtectContents) {
        $snapshotSheet.Protect('', $true, $true, $true)
      }
      $workbook.Save()
      $workbook.Close($false)
      Write-Output ("protected: {0}" -f $_.Name)
    }
    finally {
      if ($null -ne $snapshotSheet) {
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($snapshotSheet)
      }
      if ($null -ne $workbook) {
        try { $workbook.Close($false) } catch {}
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook)
      }
    }
  }
}
finally {
  if ($null -ne $excel) {
    try { $excel.Quit() } catch {}
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
