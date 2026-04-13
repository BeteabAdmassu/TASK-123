#Requires -RunAsAdministrator
<#
.SYNOPSIS
    TalentOps pre-uninstall cleanup script.
    Stops the application, removes autostart entries, deletes shortcuts,
    and optionally removes the local database.

.DESCRIPTION
    This script is executed by the NSIS/MSI uninstaller before files are removed
    from disk. It can also be run manually from an elevated PowerShell prompt.

.PARAMETER KeepDatabase
    When specified, the PostgreSQL database and data directory are preserved
    so a future reinstall can pick up where it left off.

.NOTES
    Requires: PowerShell 5.1+, Administrator privileges.
    The script is idempotent — safe to run multiple times.
#>

[CmdletBinding()]
param(
    [switch]$KeepDatabase
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

$InstallDir       = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$AppExe           = Join-Path $InstallDir 'TalentOps.exe'
$PgDataDir        = Join-Path $env:ProgramData 'TalentOps\pgdata'
$AppDataDir       = Join-Path $env:ProgramData 'TalentOps'
$UserDataDir      = Join-Path $env:LOCALAPPDATA 'talentops-desktop'
$ShortcutName     = 'TalentOps.lnk'
$LogFile          = Join-Path $env:ProgramData 'TalentOps\pre-uninstall.log'

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $entry = "[$timestamp] [$Level] $Message"
    Write-Host $entry
    $logDir = Split-Path -Parent $LogFile
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    Add-Content -Path $LogFile -Value $entry
}

# ---------------------------------------------------------------------------
# 1. Stop running TalentOps processes
# ---------------------------------------------------------------------------

function Stop-TalentOpsProcesses {
    Write-Log 'Stopping TalentOps processes...'

    $processes = Get-Process -Name 'TalentOps' -ErrorAction SilentlyContinue
    if ($processes) {
        $processes | ForEach-Object {
            Write-Log "Stopping process $($_.Id)..."
            $_ | Stop-Process -Force -ErrorAction SilentlyContinue
        }
        # Wait briefly for processes to exit
        Start-Sleep -Seconds 2

        # Verify they are gone
        $remaining = Get-Process -Name 'TalentOps' -ErrorAction SilentlyContinue
        if ($remaining) {
            Write-Log 'Some TalentOps processes did not exit cleanly — forcing termination.' 'WARN'
            $remaining | Stop-Process -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 1
        }
    } else {
        Write-Log 'No running TalentOps processes found.'
    }

    # Also stop any node.js backend processes spawned by the app
    $nodeProcesses = Get-Process -Name 'node' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir) }
    if ($nodeProcesses) {
        Write-Log "Stopping $($nodeProcesses.Count) backend node process(es)..."
        $nodeProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------
# 2. Remove autostart registry entry
# ---------------------------------------------------------------------------

function Remove-Autostart {
    Write-Log 'Removing autostart registry entry...'

    $regPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
    $regName = 'TalentOps'

    $existing = Get-ItemProperty -Path $regPath -Name $regName -ErrorAction SilentlyContinue
    if ($existing) {
        Remove-ItemProperty -Path $regPath -Name $regName -Force
        Write-Log 'Autostart entry removed.'
    } else {
        Write-Log 'No autostart entry found — nothing to remove.'
    }
}

# ---------------------------------------------------------------------------
# 3. Remove desktop shortcut
# ---------------------------------------------------------------------------

function Remove-DesktopShortcut {
    Write-Log 'Removing desktop shortcut...'

    $desktopPath = [Environment]::GetFolderPath('CommonDesktopDirectory')
    $shortcutPath = Join-Path $desktopPath $ShortcutName

    if (Test-Path $shortcutPath) {
        Remove-Item $shortcutPath -Force
        Write-Log "Removed shortcut at $shortcutPath."
    } else {
        Write-Log 'Desktop shortcut not found — nothing to remove.'
    }

    # Also check per-user desktop
    $userDesktop = [Environment]::GetFolderPath('Desktop')
    $userShortcut = Join-Path $userDesktop $ShortcutName
    if (Test-Path $userShortcut) {
        Remove-Item $userShortcut -Force
        Write-Log "Removed per-user shortcut at $userShortcut."
    }
}

# ---------------------------------------------------------------------------
# 4. Remove Start Menu entry
# ---------------------------------------------------------------------------

function Remove-StartMenuEntry {
    Write-Log 'Removing Start Menu entry...'

    $startMenuDir = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'TalentOps'
    if (Test-Path $startMenuDir) {
        Remove-Item $startMenuDir -Recurse -Force
        Write-Log "Removed Start Menu folder at $startMenuDir."
    } else {
        Write-Log 'No Start Menu entry found.'
    }
}

# ---------------------------------------------------------------------------
# 5. Clean up application data
# ---------------------------------------------------------------------------

function Remove-ApplicationData {
    Write-Log 'Cleaning up application data...'

    # Remove Electron userData (window state, caches, etc.)
    if (Test-Path $UserDataDir) {
        Remove-Item $UserDataDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Log "Removed user data at $UserDataDir."
    }

    if ($KeepDatabase) {
        Write-Log 'KeepDatabase flag set — preserving PostgreSQL data directory.'
        # Still remove non-database app data
        $nonDbItems = Get-ChildItem $AppDataDir -Exclude 'pgdata' -ErrorAction SilentlyContinue
        foreach ($item in $nonDbItems) {
            Remove-Item $item.FullName -Recurse -Force -ErrorAction SilentlyContinue
            Write-Log "Removed $($item.FullName)."
        }
    } else {
        Write-Log 'Removing PostgreSQL data directory...'
        # Stop PostgreSQL service before deleting data
        $pgService = Get-Service -Name 'postgresql-x64-16' -ErrorAction SilentlyContinue
        if ($pgService) {
            if ($pgService.Status -eq 'Running') {
                Write-Log 'Stopping PostgreSQL service...'
                Stop-Service -Name 'postgresql-x64-16' -Force
                Start-Sleep -Seconds 3
            }
        }

        if (Test-Path $AppDataDir) {
            Remove-Item $AppDataDir -Recurse -Force -ErrorAction SilentlyContinue
            Write-Log "Removed application data at $AppDataDir."
        }
    }
}

# ---------------------------------------------------------------------------
# 6. Remove Windows Firewall rules
# ---------------------------------------------------------------------------

function Remove-FirewallRules {
    Write-Log 'Removing firewall rules...'

    $rules = Get-NetFirewallRule -DisplayName 'TalentOps*' -ErrorAction SilentlyContinue
    if ($rules) {
        $rules | Remove-NetFirewallRule
        Write-Log "Removed $($rules.Count) firewall rule(s)."
    } else {
        Write-Log 'No TalentOps firewall rules found.'
    }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

try {
    Write-Log '====== TalentOps Pre-Uninstall Begin ======'

    Stop-TalentOpsProcesses
    Remove-Autostart
    Remove-DesktopShortcut
    Remove-StartMenuEntry
    Remove-FirewallRules
    Remove-ApplicationData

    Write-Log '====== TalentOps Pre-Uninstall Complete ======'
    exit 0
} catch {
    Write-Log "Pre-uninstall failed: $_" 'ERROR'
    Write-Log $_.ScriptStackTrace 'ERROR'
    # Do not fail the uninstaller — allow file removal to proceed
    exit 0
}
