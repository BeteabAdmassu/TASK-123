#Requires -RunAsAdministrator
<#
.SYNOPSIS
    TalentOps post-installation script.
    Initializes bundled PostgreSQL, creates the application database,
    runs migrations, creates a desktop shortcut, and registers system tray autostart.

.DESCRIPTION
    This script is executed automatically by the NSIS/MSI installer after files
    are placed on disk. It can also be run manually from an elevated PowerShell
    prompt for repair installations.

.NOTES
    Requires: PowerShell 5.1+, Administrator privileges.
    The script is idempotent — safe to run multiple times.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

$InstallDir       = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$PgSetupExe       = Join-Path $InstallDir 'resources\postgresql\postgresql-16-setup.exe'
$PgDataDir        = Join-Path $env:ProgramData 'TalentOps\pgdata'
$PgBinDir         = Join-Path $env:ProgramFiles 'PostgreSQL\16\bin'
$PgPort           = 5433
$DbName           = 'talentops'
$DbUser           = 'talentops'
$DbPassword       = 'talentops_local'
$BackendDir       = Join-Path $InstallDir 'resources\backend'
$MigrationScript  = Join-Path $BackendDir 'backend\src\migrations\run.js'
$SeedScript       = Join-Path $BackendDir 'backend\src\migrations\seed.js'
$AppExe           = Join-Path $InstallDir 'TalentOps.exe'
$ShortcutName     = 'TalentOps.lnk'
$LogFile          = Join-Path $env:ProgramData 'TalentOps\post-install.log'

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
# 1. Initialize bundled PostgreSQL
# ---------------------------------------------------------------------------

function Install-BundledPostgres {
    Write-Log 'Checking for existing PostgreSQL installation...'

    $pgService = Get-Service -Name 'postgresql-x64-16' -ErrorAction SilentlyContinue
    if ($pgService) {
        Write-Log 'PostgreSQL 16 service already exists — skipping installer.'
        if ($pgService.Status -ne 'Running') {
            Write-Log 'Starting PostgreSQL service...'
            Start-Service -Name 'postgresql-x64-16'
            Start-Sleep -Seconds 3
        }
        return
    }

    if (-not (Test-Path $PgSetupExe)) {
        Write-Log "PostgreSQL installer not found at $PgSetupExe — skipping bundled install." 'WARN'
        Write-Log 'Ensure PostgreSQL 16 is installed and accessible on the PATH.' 'WARN'
        return
    }

    Write-Log "Running PostgreSQL 16 silent installer..."

    $pgInstallArgs = @(
        '--mode', 'unattended',
        '--unattendedmodeui', 'none',
        '--superpassword', $DbPassword,
        '--serverport', $PgPort,
        '--datadir', $PgDataDir,
        '--install_runtimes', '0',
        '--disable-components', 'pgAdmin,stackbuilder'
    )

    $process = Start-Process -FilePath $PgSetupExe `
        -ArgumentList $pgInstallArgs `
        -Wait -PassThru -NoNewWindow

    if ($process.ExitCode -ne 0) {
        Write-Log "PostgreSQL installer exited with code $($process.ExitCode)." 'ERROR'
        throw "PostgreSQL installation failed (exit code $($process.ExitCode))."
    }

    Write-Log 'PostgreSQL 16 installed successfully.'

    # Wait for the service to become available
    $retries = 0
    $maxRetries = 30
    while ($retries -lt $maxRetries) {
        try {
            $pgIsReady = & "$PgBinDir\pg_isready.exe" -p $PgPort 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Log 'PostgreSQL is accepting connections.'
                return
            }
        } catch {
            # pg_isready not found yet — wait
        }
        $retries++
        Start-Sleep -Seconds 2
    }

    throw 'PostgreSQL did not become ready within 60 seconds.'
}

# ---------------------------------------------------------------------------
# 2. Create database and run migrations
# ---------------------------------------------------------------------------

function Initialize-Database {
    Write-Log 'Initializing application database...'

    $env:PGPASSWORD = $DbPassword
    $psqlExe = Join-Path $PgBinDir 'psql.exe'

    # Create role if it does not exist
    $roleCheck = & $psqlExe -h localhost -p $PgPort -U postgres -tAc `
        "SELECT 1 FROM pg_roles WHERE rolname='$DbUser'" 2>&1
    if ($roleCheck -notmatch '1') {
        Write-Log "Creating database role '$DbUser'..."
        & $psqlExe -h localhost -p $PgPort -U postgres -c `
            "CREATE ROLE $DbUser WITH LOGIN PASSWORD '$DbPassword' CREATEDB;" 2>&1 | Out-Null
    } else {
        Write-Log "Role '$DbUser' already exists."
    }

    # Create database if it does not exist
    $dbCheck = & $psqlExe -h localhost -p $PgPort -U postgres -tAc `
        "SELECT 1 FROM pg_database WHERE datname='$DbName'" 2>&1
    if ($dbCheck -notmatch '1') {
        Write-Log "Creating database '$DbName'..."
        & $psqlExe -h localhost -p $PgPort -U postgres -c `
            "CREATE DATABASE $DbName OWNER $DbUser;" 2>&1 | Out-Null
        # Enable PostGIS extension
        & $psqlExe -h localhost -p $PgPort -U postgres -d $DbName -c `
            "CREATE EXTENSION IF NOT EXISTS postgis;" 2>&1 | Out-Null
    } else {
        Write-Log "Database '$DbName' already exists."
    }

    # Run migrations
    if (Test-Path $MigrationScript) {
        Write-Log 'Running database migrations...'
        $env:DB_HOST = 'localhost'
        $env:DB_PORT = $PgPort
        $env:DB_USER = $DbUser
        $env:DB_PASSWORD = $DbPassword
        $env:DB_NAME = $DbName
        & node $MigrationScript 2>&1 | ForEach-Object { Write-Log $_ }
        Write-Log 'Migrations complete.'
    } else {
        Write-Log "Migration script not found at $MigrationScript — skipping." 'WARN'
    }

    # Run seed
    if (Test-Path $SeedScript) {
        Write-Log 'Seeding default data...'
        & node $SeedScript 2>&1 | ForEach-Object { Write-Log $_ }
        Write-Log 'Seeding complete.'
    } else {
        Write-Log "Seed script not found at $SeedScript — skipping." 'WARN'
    }

    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
# 3. Create desktop shortcut
# ---------------------------------------------------------------------------

function New-DesktopShortcut {
    Write-Log 'Creating desktop shortcut...'

    $desktopPath = [Environment]::GetFolderPath('CommonDesktopDirectory')
    $shortcutPath = Join-Path $desktopPath $ShortcutName

    if (Test-Path $shortcutPath) {
        Write-Log 'Desktop shortcut already exists — updating.'
        Remove-Item $shortcutPath -Force
    }

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $AppExe
    $shortcut.WorkingDirectory = $InstallDir
    $shortcut.Description = 'TalentOps Compliance & Service Desk'
    $shortcut.IconLocation = "$AppExe,0"
    $shortcut.Save()

    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($shell) | Out-Null

    Write-Log "Shortcut created at $shortcutPath."
}

# ---------------------------------------------------------------------------
# 4. Register system tray autostart
# ---------------------------------------------------------------------------

function Register-Autostart {
    Write-Log 'Registering autostart entry...'

    $regPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
    $regName = 'TalentOps'

    $existing = Get-ItemProperty -Path $regPath -Name $regName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Log 'Autostart registry entry already exists — updating.'
    }

    Set-ItemProperty -Path $regPath -Name $regName -Value "`"$AppExe`" --minimized" -Type String
    Write-Log "Autostart registered: $AppExe --minimized"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

try {
    Write-Log '====== TalentOps Post-Install Begin ======'

    Install-BundledPostgres
    Initialize-Database
    New-DesktopShortcut
    Register-Autostart

    Write-Log '====== TalentOps Post-Install Complete ======'
    exit 0
} catch {
    Write-Log "Post-install failed: $_" 'ERROR'
    Write-Log $_.ScriptStackTrace 'ERROR'
    exit 1
}
