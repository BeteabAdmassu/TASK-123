import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app, dialog, BrowserWindow, ipcMain } from 'electron';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Directory where offline update packages are dropped (e.g. from USB drive) */
const UPDATE_SOURCE_DIR = process.env.UPDATE_SOURCE_DIR
  || path.join(app.getPath('home'), 'TalentOps', 'updates');

/** Name pattern for update packages: talentops-update-<version>.tar.gz */
const UPDATE_PACKAGE_GLOB = /^talentops-update-(\d+\.\d+\.\d+)\.tar\.gz$/;

/** Accompanying checksum file: talentops-update-<version>.sha256 */
const CHECKSUM_SUFFIX = '.sha256';

/** The directory that contains the currently-running app resources */
const CURRENT_APP_DIR = path.join(app.getAppPath());

/** Backup directory for rollback — sits next to the app directory */
const PREVIOUS_DIR = path.join(path.dirname(CURRENT_APP_DIR), 'previous');

/** Staging directory where we unpack before swapping */
const STAGING_DIR = path.join(app.getPath('temp'), 'talentops-update-staging');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hex digest of a file.
 */
function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk: Buffer) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Recursively copy a directory tree.
 */
function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Recursively remove a directory (rm -rf equivalent).
 */
function removeDirSync(dir: string): void {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * List files in a directory, returning full paths.
 */
function listDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((name) => path.join(dir, name));
}

// ---------------------------------------------------------------------------
// Update package discovery
// ---------------------------------------------------------------------------

interface UpdatePackage {
  version: string;
  packagePath: string;
  checksumPath: string;
}

/**
 * Scan the update source directory for a valid update package.
 * Returns the highest-version package found, or null.
 */
function discoverUpdatePackage(): UpdatePackage | null {
  if (!fs.existsSync(UPDATE_SOURCE_DIR)) return null;

  const files = fs.readdirSync(UPDATE_SOURCE_DIR);
  let best: UpdatePackage | null = null;

  for (const file of files) {
    const match = UPDATE_PACKAGE_GLOB.exec(file);
    if (!match) continue;

    const version = match[1];
    const packagePath = path.join(UPDATE_SOURCE_DIR, file);
    const checksumPath = packagePath.replace(/\.tar\.gz$/, '') + CHECKSUM_SUFFIX;

    if (!fs.existsSync(checksumPath)) {
      // Skip packages without a checksum file
      continue;
    }

    if (!best || compareVersions(version, best.version) > 0) {
      best = { version, packagePath, checksumPath };
    }
  }

  return best;
}

/**
 * Simple semver comparison: returns positive if a > b, negative if a < b, 0 if equal.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Integrity verification
// ---------------------------------------------------------------------------

/**
 * Verify that the package file matches its .sha256 checksum.
 */
async function verifyPackageIntegrity(pkg: UpdatePackage): Promise<boolean> {
  const expectedHash = fs.readFileSync(pkg.checksumPath, 'utf-8').trim().split(/\s+/)[0];
  const actualHash = await computeSha256(pkg.packagePath);
  return expectedHash.toLowerCase() === actualHash.toLowerCase();
}

// ---------------------------------------------------------------------------
// Backup & rollback
// ---------------------------------------------------------------------------

/**
 * Back up the current app directory into `previous/` so we can rollback.
 */
function backupCurrentVersion(): void {
  removeDirSync(PREVIOUS_DIR);
  copyDirSync(CURRENT_APP_DIR, PREVIOUS_DIR);
}

/**
 * Rollback to the previous version by swapping directories.
 * The current app dir is removed and replaced with the backup.
 */
export function rollbackUpdate(): { success: boolean; error?: string } {
  if (!fs.existsSync(PREVIOUS_DIR)) {
    return { success: false, error: 'No previous version available for rollback' };
  }

  try {
    // Move current → temp
    const tempDir = path.join(path.dirname(CURRENT_APP_DIR), 'current-old-' + Date.now());
    fs.renameSync(CURRENT_APP_DIR, tempDir);

    // Move previous → current
    fs.renameSync(PREVIOUS_DIR, CURRENT_APP_DIR);

    // Move temp → previous (so another rollback would swap back)
    fs.renameSync(tempDir, PREVIOUS_DIR);

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Rollback failed: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// Extract & apply
// ---------------------------------------------------------------------------

/**
 * Extract an update package (tar.gz) into the staging directory.
 * Uses Node's built-in zlib + tar-stream-like extraction via child_process
 * because the Electron main process has access to the system tar command.
 */
function extractPackage(packagePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    removeDirSync(STAGING_DIR);
    fs.mkdirSync(STAGING_DIR, { recursive: true });

    const { execFile } = require('child_process');
    execFile(
      'tar',
      ['-xzf', packagePath, '-C', STAGING_DIR],
      (error: Error | null) => {
        if (error) {
          reject(new Error(`Failed to extract update package: ${error.message}`));
        } else {
          resolve();
        }
      },
    );
  });
}

/**
 * Apply the staged update by replacing the current app directory contents.
 */
function applyStagedUpdate(): void {
  // The extracted archive should contain an `app/` folder or the resources directly
  const stagedAppDir = fs.existsSync(path.join(STAGING_DIR, 'app'))
    ? path.join(STAGING_DIR, 'app')
    : STAGING_DIR;

  // Remove current app contents and copy staged files
  const entries = fs.readdirSync(CURRENT_APP_DIR);
  for (const entry of entries) {
    const fullPath = path.join(CURRENT_APP_DIR, entry);
    // Do not remove the previous/ backup
    if (fullPath === PREVIOUS_DIR) continue;
    fs.rmSync(fullPath, { recursive: true, force: true });
  }

  copyDirSync(stagedAppDir, CURRENT_APP_DIR);

  // Clean up staging
  removeDirSync(STAGING_DIR);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check for an offline update package and prompt the user to install it.
 * Called once from main.ts on app startup.
 */
export async function checkForOfflineUpdate(): Promise<void> {
  const pkg = discoverUpdatePackage();
  if (!pkg) return;

  const currentVersion = app.getVersion();
  if (compareVersions(pkg.version, currentVersion) <= 0) {
    // Already on this version or newer
    return;
  }

  // Prompt the user
  const mainWindow = BrowserWindow.getAllWindows()[0];
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'TalentOps Update Available',
    message: `Version ${pkg.version} is available (current: ${currentVersion}). Install now?`,
    detail: 'The application will restart after the update is applied.',
    buttons: ['Install Update', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });

  if (result.response !== 0) return;

  try {
    // 1. Verify integrity
    const valid = await verifyPackageIntegrity(pkg);
    if (!valid) {
      dialog.showErrorBox(
        'Update Failed',
        'The update package failed integrity verification (SHA-256 mismatch). The update has been aborted.',
      );
      return;
    }

    // 2. Backup current version
    backupCurrentVersion();

    // 3. Extract package to staging
    await extractPackage(pkg.packagePath);

    // 4. Apply staged update
    applyStagedUpdate();

    // 5. Restart the app
    app.relaunch();
    app.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Attempt automatic rollback
    const rollbackResult = rollbackUpdate();

    dialog.showErrorBox(
      'Update Failed',
      `The update could not be applied: ${message}\n\n${
        rollbackResult.success
          ? 'The previous version has been restored.'
          : `Rollback also failed: ${rollbackResult.error}`
      }`,
    );
  }
}

/**
 * Perform a one-click rollback from the renderer UI.
 * Returns a result object indicating success or failure.
 */
export function performRollback(): { success: boolean; error?: string } {
  const result = rollbackUpdate();
  if (result.success) {
    // Restart to load the previous version
    app.relaunch();
    app.exit(0);
  }
  return result;
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle('updater:check', async () => {
  const pkg = discoverUpdatePackage();
  if (!pkg) return { available: false };

  const currentVersion = app.getVersion();
  return {
    available: compareVersions(pkg.version, currentVersion) > 0,
    currentVersion,
    availableVersion: pkg.version,
  };
});

ipcMain.handle('updater:apply', async () => {
  await checkForOfflineUpdate();
  return { success: true };
});

ipcMain.handle('updater:rollback', () => {
  return performRollback();
});

ipcMain.handle('updater:has-rollback', () => {
  return { available: fs.existsSync(PREVIOUS_DIR) };
});
