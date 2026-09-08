param([string]$InputPath='.tmp/export-015/review.docx',[string]$OutputPath='.tmp/export-015/word-review.pdf')
$ErrorActionPreference='Stop'
$sourcePath=[IO.Path]::GetFullPath((Join-Path (Get-Location) $InputPath))
$outputFile=[IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPath))
$wordInstance=$null
$testDocument=$null
try {
  $wordInstance=New-Object -ComObject Word.Application
  $wordInstance.Visible=$false
  $wordInstance.DisplayAlerts=0
  $testDocument=$wordInstance.Documents.Open($sourcePath,$false,$true)
  $testDocument.ExportAsFixedFormat($outputFile,17)
  Write-Output "Word-rendered PDF: $outputFile"
} finally {
  if($null -ne $testDocument){$testDocument.Close(0);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($testDocument)}
  if($null -ne $wordInstance){$wordInstance.Quit();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($wordInstance)}
}
