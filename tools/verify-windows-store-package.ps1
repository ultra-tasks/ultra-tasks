param(
  [Parameter(Mandatory = $true)][string]$PackagePath,
  [Parameter(Mandatory = $true)][ValidateSet('x64', 'arm64')][string]$Architecture
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $PackagePath))
try {
  $entry = $archive.GetEntry('AppxManifest.xml')
  if (-not $entry) { throw 'AppxManifest.xml is missing' }
  $reader = [System.IO.StreamReader]::new($entry.Open())
  try { [xml]$manifest = $reader.ReadToEnd() } finally { $reader.Dispose() }
  $identity = $manifest.Package.Identity
  if ($identity.Name -cne $env:WINDOWS_STORE_IDENTITY_NAME) { throw 'Wrong package identity name' }
  if ($identity.Publisher -cne $env:WINDOWS_STORE_PUBLISHER) { throw 'Wrong package publisher' }
  if ($manifest.Package.Properties.PublisherDisplayName -cne $env:WINDOWS_STORE_PUBLISHER_DISPLAY_NAME) {
    throw 'Wrong publisher display name'
  }
  if ($identity.ProcessorArchitecture -cne $Architecture) { throw 'Wrong package architecture' }
  $version = (Get-Content -LiteralPath "$PSScriptRoot/../package.json" -Raw | ConvertFrom-Json).version
  if ($identity.Version -cne "$version.0") { throw 'Wrong Store package version' }
  if ($manifest.Package.Applications.Application.Id -cne 'UltraTasks') { throw 'Wrong application ID' }
  if (-not $manifest.SelectSingleNode('//*[local-name()="Protocol" and @Name="ultratasks"]')) {
    throw 'ultratasks protocol registration is missing'
  }
  if (-not $manifest.SelectSingleNode('//*[local-name()="Capability" and @Name="runFullTrust"]')) {
    throw 'Electron desktop capability is missing'
  }
  if ($archive.GetEntry('AppxSignature.p7x')) { throw 'Store submission unexpectedly has a local signature' }
  Write-Output "Verified unsigned $Architecture Store package: $PackagePath"
} finally {
  $archive.Dispose()
}
