# Copyright (c) Mojang AB.  All rights reserved.

#Requires -Version 7.0



# release.ps1
# Creates a GitHub release with VSIX packages
# Version is always read from package.json

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$originalLocation = Get-Location
$skipVersionCheck = $true
$titlePrefix = "FASTBuild Monitor for VS Code"
$tagPrefix = "FASTBuild Monitor for VS Code v"

try {
    # Validate GitHub CLI is available
    Write-Host "Validating GitHub CLI is available..." -ForegroundColor Cyan
    $ghVersion = & gh --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "GitHub CLI (gh) is not installed or not in PATH. Please install it from https://cli.github.com/"
        exit 1
    }
    Write-Host "  GitHub CLI version: $ghVersion" -ForegroundColor Green

    # Ensure we're in the repository root
    $repoRoot = Split-Path -Parent $PSScriptRoot
    Push-Location $repoRoot

    # Get version from package.json (single source of truth)
    Write-Host "Reading version from package.json..." -ForegroundColor Cyan

    $rootPkgPath = Join-Path $repoRoot 'package.json'
    if (Test-Path $rootPkgPath) {
        $rootPkg = Get-Content $rootPkgPath -Raw | ConvertFrom-Json
        $Version = $rootPkg.version
        Write-Host "  Version from package.json: $Version" -ForegroundColor Green
    }
    else {
        Write-Error "package.json not found at: $rootPkgPath"
        exit 1
    }

    #### Validate version format
    # Validate version format (x.y.z only - VS Code standard)
    # See: https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions
    if ($Version -notmatch '^\d+\.\d+\.\d+$') {
        Write-Error "Version must be in semver format: x.y.z (e.g., 0.1.0, 1.2.3). Pre-release versions use odd minor numbers (0.3.0, 0.5.0)."
        exit 1
    }

    # Parse version components
    $versionParts = $Version -split '\.'
    $major = [int]$versionParts[0]
    $minor = [int]$versionParts[1]

    # VS Code versioning: even minor = release, odd minor = pre-release
    $isPreRelease = ($minor % 2 -ne 0)

    if (-not $skipVersionCheck) {
        # If this is a release version (even minor), verify a pre-release version exists
        if (-not $isPreRelease) {
            Write-Host "`nValidating release version..." -ForegroundColor Cyan

            # Calculate expected pre-release version (odd minor number before this even number)
            $expectedPreReleaseMinor = $minor - 1
            $expectedPreReleaseVersion = "$major.$expectedPreReleaseMinor.0"

            # Check if any release with this pre-release version exists
            Write-Host "  Checking for pre-release version v$expectedPreReleaseVersion..." -ForegroundColor Gray

            $releases = & gh release list --limit 100 --json tagName, isPrerelease 2>$null | ConvertFrom-Json
            $preReleaseExists = $releases | Where-Object {
                $_.tagName -eq "v$expectedPreReleaseVersion" -or
                $_.tagName -match "^v$major\.$expectedPreReleaseMinor\.\d+$"
            }

            if (-not $preReleaseExists) {
                Write-Error @"
Release version $Version (even minor) cannot be published before pre-release version $expectedPreReleaseVersion (odd minor).

VS Code versioning standard requires:
  - Pre-release versions use ODD minor numbers (0.1.0, 0.3.0)
  - Release versions use EVEN minor numbers (0.2.0, 0.4.0)
  - Pre-release must be published BEFORE the corresponding release

Expected workflow:
  1. Publish v$expectedPreReleaseVersion (pre-release)
  2. Test and iterate on $major.$expectedPreReleaseMinor.x versions
  3. Then publish v$Version (release)

See: https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions
"@
                exit 1
            }

            Write-Host "  Pre-release version found" -ForegroundColor Green
        }# Update root package.json version (single source of truth)
        Write-Host "`nUpdating root package.json to version $Version..." -ForegroundColor Cyan
        $rootPkgPath = Join-Path $repoRoot 'package.json'
        $rootPkg = Get-Content $rootPkgPath -Raw | ConvertFrom-Json
        $rootPkg.version = $Version
        $rootPkg | ConvertTo-Json -Depth 100 | Set-Content $rootPkgPath -Encoding UTF8
        Write-Host "  Version set to $Version" -ForegroundColor Green
    }

    $tag = "$tagPrefix$Version"
    $title = "$titlePrefix $tag"
    if ($isPreRelease) {
        $title += " (Pre-release)"
    }
    


    #### Generate Hashes
    # Check if VSIX files exist
    $artifactsDir = Join-Path $repoRoot 'artifacts'
    $extensionVsix = Join-Path $artifactsDir "FASTBuild-Monitor-$Version.vsix"

    $missingFiles = @()
    if (-not (Test-Path $extensionVsix)) { $missingFiles += $extensionVsix }

    if ($missingFiles.Count -gt 0) {
        Write-Error "VSIX package(s) not found: $($missingFiles -join ', '). Run 'npm run package' to create packages first."
        exit 1
    }

    # Generate SHA256 checksums for VSIX files
    Write-Host "`nGenerating SHA256 checksums..." -ForegroundColor Cyan

    $extensionSha256File = "$extensionVsix.sha256"

    $extensionHash = (Get-FileHash -Path $extensionVsix -Algorithm SHA256).Hash

    # Write checksum files in format: HASH  FILENAME
    $extensionHash + "  " + (Split-Path -Leaf $extensionVsix) | Set-Content -Path $extensionSha256File -Encoding UTF8 -NoNewline

    Write-Host "  $extensionSha256File" -ForegroundColor Green
    Write-Host "     $extensionHash" -ForegroundColor Gray

    ##### Publish
    # Load release notes from template
    Write-Host "`nLoading release notes from RELEASE_NOTES.md..." -ForegroundColor Cyan
    $releaseNotesPath = Join-Path $repoRoot 'RELEASE_NOTES.md'
    if (-not (Test-Path $releaseNotesPath)) {
        Write-Error "RELEASE_NOTES.md not found at: $releaseNotesPath"
        exit 1
    }

    $notes = Get-Content $releaseNotesPath -Raw
    # Replace {VERSION} placeholder with actual version
    $notes = $notes -replace '\{VERSION\}', $Version

    # Validate release notes contain required content
    if ($notes -notmatch '##\s+(Installation|Features|Uninstallation)') {
        Write-Error "RELEASE_NOTES.md appears to be incomplete. Ensure it contains Installation, Features, and Uninstallation sections."
        exit 1
    }

    Write-Host "  Release notes loaded" -ForegroundColor Green

    # Create the release
    Write-Host "`nCreating GitHub release: $tag" -ForegroundColor Cyan
    Write-Host "Title: $title" -ForegroundColor Cyan
    Write-Host "Files:" -ForegroundColor Cyan
    Write-Host "  - $extensionVsix" -ForegroundColor Gray
    Write-Host "  - $extensionSha256File" -ForegroundColor Gray

    # Build GitHub CLI arguments
    $ghArgs = @(
        'release', 'create', $tag,
        '--title', $title,
        '--notes', $notes,
        $extensionVsix,
        $extensionSha256File
    )
    if ($isPreRelease) {
        $ghArgs += '--prerelease'
    }

    & gh @ghArgs

    if ($LASTEXITCODE -eq 0) {
        Write-Host "`nRelease created successfully!" -ForegroundColor Green
        Write-Host "View at: https://github.com/Mojang/FASTBuildMonitor/releases/tag/$tag" -ForegroundColor Cyan
    }
    else {
        Write-Error "Failed to create release"
        exit 1
    }

    Pop-Location
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
finally {
    Set-Location $originalLocation
}