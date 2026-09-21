<#
.SYNOPSIS
    Sign and sideload the built MediaForge Store package so AM-22's Store-install smoke tests
    can actually be run before/after Partner Center certification.

.DESCRIPTION
    `npm run dist:store` emits an UNSIGNED .msix (electron-builder has no certificate configured,
    and Partner Center re-signs on submission). An unsigned MSIX cannot be sideloaded, so the four
    behaviours AM-22 lists as "still owed" -- PyInstaller onefile extraction under a packaged
    filesystem, spawning the bundled yt-dlp/ffmpeg/qjs from WindowsApps, the Local Share LAN server
    against privateNetworkClientServer, and toast notifications -- were unverifiable.

    This script closes that gap without touching the Store build configuration:

      1. reads the Publisher out of the package's own AppxManifest.xml (never hardcoded, so it
         cannot drift from what Partner Center assigned),
      2. creates or reuses a self-signed code-signing certificate with that exact Subject,
      3. trusts that certificate, signs a COPY of the package (the submitted artifact is never
         modified), and installs the copy with Add-AppxPackage,
      4. prints the smoke checklist to walk through.

.PARAMETER Package
    Path to the .msix to sideload. Defaults to the newest dist\*-store.msix.

.PARAMETER Cleanup
    Uninstall the sideloaded package and remove the certificate created by this script.

.PARAMETER DryRun
    Resolve and report everything (package, publisher, signtool, certificate state) without
    creating a certificate, signing, or installing anything.

.PARAMETER CertSubject
    Override the certificate Subject. Defaults to the package's Publisher.

.PARAMETER UseMachineStore
    Trust the certificate in LocalMachine\TrustedPeople instead of CurrentUser\TrustedPeople.
    Requires an elevated prompt. Use this when Add-AppxPackage rejects the certificate as
    untrusted despite a per-user install.

.EXAMPLE
    pwsh -File scripts\smoke-msix.ps1 -DryRun
    Report what would happen, changing nothing.

.EXAMPLE
    pwsh -File scripts\smoke-msix.ps1
    Sign and install the newest Store package, then print the smoke checklist.

.EXAMPLE
    pwsh -File scripts\smoke-msix.ps1 -Cleanup
    Remove the sideloaded package and its certificate. Run this BEFORE installing the real
    Store build: both share identity prodip-datta.MediaForgeDesktop, and Windows will not
    treat a self-signed copy and a Microsoft-signed one as the same app.
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Package,
    [switch]$Cleanup,
    [switch]$DryRun,
    [string]$CertSubject,
    [switch]$UseMachineStore
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$friendlyName = 'MediaForge MSIX sideload (scripts/smoke-msix.ps1)'

function Write-Step { param([string]$Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok { param([string]$Message) Write-Host "    $Message" -ForegroundColor Green }
function Write-Note { param([string]$Message) Write-Host "    $Message" -ForegroundColor DarkGray }
function Write-Warn { param([string]$Message) Write-Host "    $Message" -ForegroundColor Yellow }

function Test-Elevated {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

<#
    The publisher has to come from the package itself. Partner Center assigns a CN=<guid> value
    that is meaningless to a human and changes per app, so hardcoding it here would guarantee a
    stale script the first time the app is re-associated.
#>
function Get-PackagePublisher {
    param([Parameter(Mandatory)][string]$Path)

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $entry = $zip.Entries | Where-Object { $_.FullName -eq 'AppxManifest.xml' } | Select-Object -First 1
        if (-not $entry) { throw "AppxManifest.xml not found inside $Path - is this really an MSIX?" }

        $reader = New-Object System.IO.StreamReader($entry.Open())
        try { $xml = $reader.ReadToEnd() } finally { $reader.Dispose() }
    }
    finally { $zip.Dispose() }

    $m = [regex]::Match($xml, "Publisher\s*=\s*'([^']*)'")
    if (-not $m.Success) { $m = [regex]::Match($xml, 'Publisher\s*=\s*"([^"]*)"') }
    if (-not $m.Success) { throw "Could not read Identity/@Publisher from the package manifest." }

    $name = [regex]::Match($xml, "Identity\s+Name\s*=\s*'([^']*)'")
    if (-not $name.Success) { $name = [regex]::Match($xml, 'Identity\s+Name\s*=\s*"([^"]*)"') }

    [pscustomobject]@{
        Publisher = $m.Groups[1].Value
        Identity  = if ($name.Success) { $name.Groups[1].Value } else { $null }
    }
}

<#
    electron-builder pins toolsets.winCodeSign to 1.3.0 (Windows Kits 10.0.26100.0), which is
    exactly what supplies signtool.exe. Prefer the newest installed kit over PATH, and fall back
    to PATH so a differently-installed SDK still works.
#>
function Resolve-SignTool {
    $roots = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'),
        (Join-Path $env:ProgramFiles 'Windows Kits\10\bin')
    ) | Where-Object { $_ -and (Test-Path $_) }

    foreach ($root in $roots) {
        $found = Get-ChildItem $root -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object {
                $candidate = Join-Path $_.FullName 'x64\signtool.exe'
                if (Test-Path $candidate) { $candidate }
            } |
            Select-Object -First 1
        if ($found) { return $found }
    }

    $onPath = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }

    throw 'signtool.exe not found. Install the Windows SDK (Windows Kits 10) or run from a Developer Command Prompt.'
}

function Resolve-PackagePath {
    param([string]$Explicit)

    if ($Explicit) {
        if (-not (Test-Path $Explicit)) { throw "Package not found: $Explicit" }
        return (Resolve-Path $Explicit).Path
    }

    $dist = Join-Path $repoRoot 'dist'
    if (-not (Test-Path $dist)) { throw "No dist folder at $dist. Run 'npm run dist:store' first." }

    $newest = Get-ChildItem $dist -Filter '*-store.msix' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $newest) {
        throw "No *-store.msix in $dist. Run 'npm run dist:store' first. (Note: sideload the .msix, not the .msixupload.)"
    }
    return $newest.FullName
}

function Get-SideloadCertificate {
    param([Parameter(Mandatory)][string]$Subject)

    Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
        Where-Object { $_.Subject -eq $Subject -and $_.FriendlyName -eq $friendlyName } |
        Select-Object -First 1
}

function New-SideloadCertificate {
    param([Parameter(Mandatory)][string]$Subject)

    # Code-signing EKU (1.3.6.1.5.5.7.3.3) is what signtool and the AppX signature validator
    # require; the explicit KeyUsage extension avoids the default key-encipherment-only cert.
    New-SelfSignedCertificate `
        -Type Custom `
        -Subject $Subject `
        -FriendlyName $friendlyName `
        -KeyUsage DigitalSignature `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -CertStoreLocation 'Cert:\CurrentUser\My' `
        -NotAfter (Get-Date).AddYears(2) `
        -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
}

function Get-TrustStorePath {
    if ($UseMachineStore) {
        if (-not (Test-Elevated)) {
            throw '-UseMachineStore requires an elevated prompt. Re-run from an Administrator terminal.'
        }
        return 'Cert:\LocalMachine\TrustedPeople'
    }
    return 'Cert:\CurrentUser\TrustedPeople'
}

function Test-Trusted {
    param(
        [Parameter(Mandatory)][System.Security.Cryptography.X509Certificates.X509Certificate2]$Cert,
        [Parameter(Mandatory)][string]$StorePath
    )

    $null -ne (Get-ChildItem $StorePath -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $Cert.Thumbprint } |
        Select-Object -First 1)
}

function Invoke-Cleanup {
    param([Parameter(Mandatory)][string]$Identity)

    Write-Step 'Removing the sideloaded package'

    $installed = Get-AppxPackage -Name $Identity -ErrorAction SilentlyContinue
    if ($installed) {
        Remove-AppxPackage -Package $installed.PackageFullName
        Write-Ok "Uninstalled $Identity"
    }
    else {
        Write-Note "$Identity is not installed."
    }

    Write-Step 'Removing the sideload certificate'

    foreach ($store in @('Cert:\CurrentUser\TrustedPeople', 'Cert:\LocalMachine\TrustedPeople')) {
        Get-ChildItem $store -ErrorAction SilentlyContinue |
            Where-Object { $_.FriendlyName -eq $friendlyName } |
            ForEach-Object {
                Remove-Item $_.PSPath -Force
                Write-Ok "Removed from $store"
            }
    }

    Get-ChildItem 'Cert:\CurrentUser\My' -ErrorAction SilentlyContinue |
        Where-Object { $_.FriendlyName -eq $friendlyName } |
        ForEach-Object {
            Remove-Item $_.PSPath -Force
            Write-Ok 'Removed from Cert:\CurrentUser\My'
        }

    $sideloadDir = Join-Path $repoRoot 'dist\_sideload'
    if (Test-Path $sideloadDir) {
        Remove-Item $sideloadDir -Recurse -Force
        Write-Ok 'Removed dist\_sideload'
    }

    Write-Host ''
    Write-Host 'Clean. The Store build can now be installed on this machine.' -ForegroundColor Green
}

# ---------------------------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------------------------

$packagePath = Resolve-PackagePath -Explicit $Package
Write-Step 'Package'
Write-Ok $packagePath

$manifest = Get-PackagePublisher -Path $packagePath
$publisher = if ($CertSubject) { $CertSubject } else { $manifest.Publisher }
Write-Ok "Identity : $($manifest.Identity)"
Write-Ok "Publisher: $publisher"

if ($Cleanup) {
    Invoke-Cleanup -Identity $manifest.Identity
    return
}

$signtool = Resolve-SignTool
Write-Step 'Signing tool'
Write-Ok $signtool

$cert = Get-SideloadCertificate -Subject $publisher
Write-Step 'Certificate'
if ($cert) {
    Write-Ok "Reusing $($cert.Thumbprint) (expires $($cert.NotAfter.ToString('yyyy-MM-dd')))"
}
else {
    Write-Note "No existing certificate for '$publisher' - one will be created."
}

$trustStore = Get-TrustStorePath
Write-Ok "Trust store: $trustStore"

if ($DryRun) {
    Write-Host ''
    Write-Host 'Dry run - nothing created, signed, or installed.' -ForegroundColor Green
    Write-Note "Would sign a copy into dist\_sideload\ and run Add-AppxPackage."
    if (-not (Test-Elevated)) {
        Write-Note 'Not elevated: the certificate goes to the per-user store by default.'
    }
    return
}

if (-not $cert) {
    $cert = New-SideloadCertificate -Subject $publisher
    Write-Ok "Created $($cert.Thumbprint)"
}

# signtool takes a PFX; the private key never leaves the temp file, which is always deleted.
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("mf-sideload-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    Write-Step 'Trusting the certificate'

    if (-not (Test-Trusted -Cert $cert -StorePath $trustStore)) {
        $cerPath = Join-Path $tempDir 'pub.cer'
        Export-Certificate -Cert $cert -FilePath $cerPath -Type CERT | Out-Null
        Import-Certificate -FilePath $cerPath -CertStoreLocation $trustStore | Out-Null
        Write-Ok "Imported into $trustStore"
    }
    else {
        Write-Ok 'Already trusted.'
    }

    Write-Step 'Signing a copy of the package'

    $sideloadDir = Join-Path $repoRoot 'dist\_sideload'
    New-Item -ItemType Directory -Path $sideloadDir -Force | Out-Null

    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($packagePath)
    $signedPath = Join-Path $sideloadDir "$baseName-signed.msix"
    Copy-Item -Path $packagePath -Destination $signedPath -Force
    Write-Note "The submitted artifact at $packagePath is left untouched."

    $pfxPath = Join-Path $tempDir 'sign.pfx'
    $pfxPassword = [guid]::NewGuid().ToString('N')
    $securePassword = ConvertTo-SecureString -String $pfxPassword -AsPlainText -Force
    Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePassword | Out-Null

    & $signtool sign /fd SHA256 /f $pfxPath /p $pfxPassword $signedPath
    if ($LASTEXITCODE -ne 0) { throw "signtool failed with exit code $LASTEXITCODE." }
    Write-Ok "Signed $signedPath"

    Write-Step 'Installing'

    try {
        Add-AppxPackage -Path $signedPath -ErrorAction Stop
        Write-Ok "Installed $($manifest.Identity)"
    }
    catch {
        Write-Warn "Add-AppxPackage failed: $($_.Exception.Message)"
        Write-Host ''
        Write-Host 'If this is a certificate-trust failure (0x800B0109), retry from an elevated prompt:' -ForegroundColor Yellow
        Write-Host "    pwsh -File scripts\smoke-msix.ps1 -UseMachineStore" -ForegroundColor Yellow
        Write-Host 'If it instead complains about sideloading being disabled, enable Developer Mode:' -ForegroundColor Yellow
        Write-Host '    Settings > System > For developers > Developer Mode' -ForegroundColor Yellow
        throw
    }

    $app = Get-AppxPackage -Name $manifest.Identity -ErrorAction SilentlyContinue
    if ($app) {
        Write-Ok "Package family: $($app.PackageFamilyName)"
        Write-Ok "Install location: $($app.InstallLocation)"
    }

    Write-Host ''
    Write-Host 'AM-22 Store-install smoke tests' -ForegroundColor Cyan
    Write-Host '  Launch MediaForge from the Start menu (not from dist\), then verify each:'
    Write-Host ''
    Write-Host '  1. Bundled binaries spawn from WindowsApps'
    Write-Host '       Settings > Diagnostics: yt-dlp, FFmpeg and the YouTube JS Runtime tiles must'
    Write-Host '       all show a version and source "bundled" - not "missing".'
    Write-Host ''
    Write-Host '  2. PyInstaller onefile yt-dlp extracts under the packaged filesystem'
    Write-Host '       Analyze a public YouTube URL. A real format list (multiple rows, 1080p/720p)'
    Write-Host '       means extraction worked; an empty or 360p-only list means it did not.'
    Write-Host ''
    Write-Host '  3. Local Share LAN server vs the privateNetworkClientServer capability'
    Write-Host '       Start Local Share, then load the shown LAN URL from a phone on the same Wi-Fi.'
    Write-Host ''
    Write-Host '  4. Toast notifications'
    Write-Host '       Complete a short download with "notify on complete" enabled. The toast must'
    Write-Host '       show the MediaForge name and icon - a blank or "Electron" identity means the'
    Write-Host '       manifest-derived AppUserModelID did not take, which AM-22 predicted rather'
    Write-Host '       than assumed.'
    Write-Host ''
    Write-Host '  Also confirm Settings > About hides "Download & Install" and points at the Store,'
    Write-Host '  and that Settings > Drivers still reports versions (AM-22 keeps those updating).'
    Write-Host ''
    Write-Host "When finished:  pwsh -File scripts\smoke-msix.ps1 -Cleanup" -ForegroundColor Yellow
    Write-Host 'Run that BEFORE installing the real Store build - they share the package identity.'
}
finally {
    Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
