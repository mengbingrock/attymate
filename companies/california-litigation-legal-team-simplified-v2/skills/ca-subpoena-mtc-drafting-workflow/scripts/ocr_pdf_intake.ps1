param(
    [Parameter(Mandatory = $true)]
    [string]$WorkspaceRoot,

    [Parameter(Mandatory = $true)]
    [string]$OutputRoot,

    [string[]]$SourceRoot,

    [string[]]$PythonCommand = @("python"),

    [switch]$Force,

    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-FullPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }
    return [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $Path))
}

function Test-PathInside {
    param(
        [Parameter(Mandatory = $true)][string]$Child,
        [Parameter(Mandatory = $true)][string]$Parent
    )
    $parentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $childFull = [System.IO.Path]::GetFullPath($Child).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    return $childFull.Equals($parentFull, [StringComparison]::OrdinalIgnoreCase) -or
        $childFull.StartsWith($parentFull + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        $childFull.StartsWith($parentFull + [System.IO.Path]::AltDirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

if (-not (Test-Path -LiteralPath $WorkspaceRoot -PathType Container)) {
    throw "WorkspaceRoot does not exist or is not a directory: $WorkspaceRoot"
}

$workspaceFull = (Resolve-Path -LiteralPath $WorkspaceRoot).Path
$outputFull = Get-FullPath -Path $OutputRoot

if (-not (Test-PathInside -Child $outputFull -Parent $workspaceFull)) {
    throw "OutputRoot must be inside WorkspaceRoot for this portable helper. WorkspaceRoot=$workspaceFull OutputRoot=$outputFull"
}

$roots = New-Object System.Collections.Generic.List[string]
if ($SourceRoot -and $SourceRoot.Count -gt 0) {
    foreach ($root in $SourceRoot) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) {
            throw "SourceRoot does not exist or is not a directory: $root"
        }
        $resolved = (Resolve-Path -LiteralPath $root).Path
        if (-not (Test-PathInside -Child $resolved -Parent $workspaceFull)) {
            throw "SourceRoot must be inside WorkspaceRoot: $resolved"
        }
        $roots.Add($resolved)
    }
} else {
    $candidateRoots = @(
        $workspaceFull,
        (Join-Path $workspaceFull "Exhibits"),
        (Join-Path $workspaceFull "Context"),
        (Join-Path $workspaceFull "Context (not exhibit)"),
        (Join-Path $workspaceFull "Authorities")
    )
    foreach ($candidate in $candidateRoots) {
        if (Test-Path -LiteralPath $candidate -PathType Container) {
            $roots.Add((Resolve-Path -LiteralPath $candidate).Path)
        }
    }
}

$excluded = @(
    $outputFull,
    (Join-Path $workspaceFull "Intermediary work"),
    (Join-Path $workspaceFull ".git"),
    (Join-Path $workspaceFull "node_modules")
) | ForEach-Object { Get-FullPath -Path $_ }

$pdfs = New-Object System.Collections.Generic.List[string]
foreach ($root in $roots) {
    Get-ChildItem -LiteralPath $root -Recurse -File -Filter "*.pdf" | ForEach-Object {
        $full = $_.FullName
        $isExcluded = $false
        foreach ($excludedRoot in $excluded) {
            if (Test-PathInside -Child $full -Parent $excludedRoot) {
                $isExcluded = $true
                break
            }
        }
        if (-not $isExcluded -and -not $pdfs.Contains($full)) {
            $pdfs.Add($full)
        }
    }
}

Write-Host "WorkspaceRoot: $workspaceFull"
Write-Host "OutputRoot: $outputFull"
Write-Host "Source roots: $($roots.Count)"
Write-Host "PDFs discovered: $($pdfs.Count)"

if ($DryRun) {
    foreach ($pdf in $pdfs) {
        Write-Host "DRY-RUN PDF: $pdf"
    }
    Write-Host "Dry run complete. No files were written."
    exit 0
}

$ocrRoot = Join-Path $outputFull "OCR"
New-Item -ItemType Directory -Force -Path $ocrRoot | Out-Null

if ($pdfs.Count -eq 0) {
    $indexPath = Join-Path $ocrRoot "OCR Index.csv"
    "SourcePathRelative,SHA256,PageCount,OcrTextRelative,Status" | Set-Content -LiteralPath $indexPath -Encoding UTF8
    Write-Host "No PDFs found. Wrote empty OCR index: $indexPath"
    exit 0
}

$pythonParts = @($PythonCommand)
if ($pythonParts.Count -eq 1 -and $pythonParts[0] -match "\s") {
    $pythonParts = $pythonParts[0] -split "\s+"
}
$pythonExe = $pythonParts[0]
$pythonArgs = @()
if ($pythonParts.Count -gt 1) {
    $pythonArgs = $pythonParts[1..($pythonParts.Count - 1)]
}

$payload = @{
    workspace = $workspaceFull
    output = $outputFull
    pdfs = @($pdfs)
    force = [bool]$Force
} | ConvertTo-Json -Depth 6

$payloadPath = [System.IO.Path]::GetTempFileName()
$scriptPath = [System.IO.Path]::ChangeExtension([System.IO.Path]::GetTempFileName(), ".py")

try {
    Set-Content -LiteralPath $payloadPath -Value $payload -Encoding UTF8
    @'
import csv
import hashlib
import json
import os
import re
import sys

try:
    import fitz
except Exception as exc:
    raise SystemExit("PyMuPDF is required for PDF text extraction in this helper: %s" % exc)

payload_path = sys.argv[1]
with open(payload_path, "r", encoding="utf-8-sig") as handle:
    payload = json.load(handle)

workspace = payload["workspace"]
output = payload["output"]
ocr_root = os.path.join(output, "OCR")
os.makedirs(ocr_root, exist_ok=True)
index_path = os.path.join(ocr_root, "OCR Index.csv")

def rel(path):
    return os.path.relpath(path, workspace).replace(os.sep, "/")

def safe_name(path):
    relative = rel(path)
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", relative).strip("_")
    return cleaned or "source"

rows = []
for pdf_path in payload["pdfs"]:
    with open(pdf_path, "rb") as handle:
        digest = hashlib.sha256(handle.read()).hexdigest()

    text_name = safe_name(pdf_path) + ".ocr.txt"
    text_path = os.path.join(ocr_root, text_name)
    if os.path.exists(text_path) and not payload.get("force"):
        status = "skipped-existing"
        page_count = ""
    else:
        doc = fitz.open(pdf_path)
        page_count = doc.page_count
        parts = []
        for index, page in enumerate(doc, start=1):
            parts.append("--- Page %d ---" % index)
            parts.append(page.get_text("text") or "")
        doc.close()
        with open(text_path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write("\n".join(parts).rstrip() + "\n")
        status = "written"

    rows.append({
        "SourcePathRelative": rel(pdf_path),
        "SHA256": digest,
        "PageCount": page_count,
        "OcrTextRelative": rel(text_path),
        "Status": status,
    })

with open(index_path, "w", encoding="utf-8", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=["SourcePathRelative", "SHA256", "PageCount", "OcrTextRelative", "Status"])
    writer.writeheader()
    writer.writerows(rows)

print("Wrote OCR sidecars/index under: %s" % ocr_root)
'@ | Set-Content -LiteralPath $scriptPath -Encoding UTF8

    & $pythonExe @pythonArgs $scriptPath $payloadPath
    if ($LASTEXITCODE -ne 0) {
        throw "Python OCR helper failed with exit code $LASTEXITCODE"
    }
} finally {
    Remove-Item -LiteralPath $payloadPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $scriptPath -Force -ErrorAction SilentlyContinue
}
