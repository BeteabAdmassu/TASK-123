/**
 * Installer path consistency tests.
 * Verifies that electron-builder.yml packaging layout matches
 * post-install.ps1 script expectations for migration/seed invocation.
 */

import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

describe('Installer Path Consistency', () => {
  const builderYml = fs.readFileSync(
    path.join(repoRoot, 'electron', 'electron-builder.yml'), 'utf8'
  );
  const postInstall = fs.readFileSync(
    path.join(repoRoot, 'installer', 'scripts', 'post-install.ps1'), 'utf8'
  );
  const nsisHooks = fs.readFileSync(
    path.join(repoRoot, 'installer', 'nsis-hooks.nsh'), 'utf8'
  );

  describe('Backend artifact packaging', () => {
    it('should map backend/dist to resources/backend via extraResources', () => {
      expect(builderYml).toContain('from: ../backend/dist');
      expect(builderYml).toContain('to: backend');
    });

    it('should map installer scripts to resources/installer/scripts', () => {
      expect(builderYml).toContain('from: ../installer/scripts');
      expect(builderYml).toContain('to: installer/scripts');
    });
  });

  describe('Post-install script paths', () => {
    it('should derive ResourcesDir from PSScriptRoot (not double-nest resources)', () => {
      // $ResourcesDir should be the extraResources root, not $InstallDir/resources
      expect(postInstall).toContain('$ResourcesDir');
      expect(postInstall).not.toMatch(/Join-Path \$InstallDir\s+'resources\\backend'/);
    });

    it('should reference backend under ResourcesDir, not InstallDir/resources/backend', () => {
      expect(postInstall).toContain("Join-Path $ResourcesDir 'backend'");
    });

    it('should reference migration script at correct nested path', () => {
      // tsc rootDir=".." produces dist/backend/src/migrations/run.js
      // electron-builder maps dist → resources/backend
      // So full path: resources/backend/backend/src/migrations/run.js
      expect(postInstall).toContain("Join-Path $BackendDir 'backend\\src\\migrations\\run.js'");
    });

    it('should reference seed script at correct nested path', () => {
      expect(postInstall).toContain("Join-Path $BackendDir 'backend\\src\\migrations\\seed.js'");
    });

    it('should reference PostgreSQL setup under ResourcesDir', () => {
      expect(postInstall).toContain("Join-Path $ResourcesDir 'postgresql\\postgresql-16-setup.exe'");
    });
  });

  describe('NSIS hooks paths', () => {
    it('should invoke post-install from resources/installer/scripts path', () => {
      expect(nsisHooks).toContain('$INSTDIR\\resources\\installer\\scripts\\post-install.ps1');
    });

    it('should invoke pre-uninstall from resources/installer/scripts path', () => {
      expect(nsisHooks).toContain('$INSTDIR\\resources\\installer\\scripts\\pre-uninstall.ps1');
    });

    it('should match electron-builder extraResources mapping', () => {
      // NSIS expects: $INSTDIR/resources/installer/scripts/...
      // electron-builder maps: ../installer/scripts → installer/scripts (under resources/)
      // These are consistent when extraResources target = installer/scripts
      expect(builderYml).toContain('to: installer/scripts');
    });
  });
});
