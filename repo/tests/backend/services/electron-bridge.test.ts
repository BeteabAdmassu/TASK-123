/**
 * Electron bridge wiring tests.
 * Verifies that the Angular app component's initElectronBridge()
 * connects preload channels to concrete behavior, not placeholders.
 *
 * Skipped when electron/frontend source files are not present (e.g. Docker).
 */

import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const appComponentPath = path.join(repoRoot, 'frontend', 'src', 'app', 'app.component.ts');
const preloadPath = path.join(repoRoot, 'electron', 'preload.ts');
const hasFiles = fs.existsSync(appComponentPath) && fs.existsSync(preloadPath);
const appComponentSource = hasFiles ? fs.readFileSync(appComponentPath, 'utf8') : '';
const preloadSource = hasFiles ? fs.readFileSync(preloadPath, 'utf8') : '';

(hasFiles ? describe : describe.skip)('Electron Bridge Wiring', () => {

  describe('Preload channel alignment', () => {
    it('should expose onSearch in preload', () => {
      expect(preloadSource).toContain('onSearch(callback');
    });

    it('should expose onSave in preload', () => {
      expect(preloadSource).toContain('onSave(callback');
    });

    it('should expose onNextRecord in preload', () => {
      expect(preloadSource).toContain('onNextRecord(callback');
    });

    it('should expose onNavigate in preload', () => {
      expect(preloadSource).toContain('onNavigate(callback');
    });

    it('should expose onAction for context menu in preload', () => {
      expect(preloadSource).toContain('onAction(callback');
    });
  });

  describe('App component bridge consumption', () => {
    it('should call initElectronBridge in lifecycle', () => {
      expect(appComponentSource).toContain('this.initElectronBridge()');
    });

    it('should guard against missing electronAPI (browser fallback)', () => {
      expect(appComponentSource).toContain("if (!electronAPI) return");
    });

    it('should subscribe to shortcuts.onSearch with real handler', () => {
      expect(appComponentSource).toContain('shortcuts.onSearch(() => this.onSearchOpen())');
    });

    it('should subscribe to shortcuts.onSave with real behavior (not no-op)', () => {
      // Must dispatch a synthetic keydown, not just subscribe to an observable
      expect(appComponentSource).toContain('dispatchEvent(new KeyboardEvent');
      expect(appComponentSource).toContain("ctrlKey: true");
      // Must NOT contain the old no-op pattern
      expect(appComponentSource).not.toContain(
        'shortcuts.onSave(() => this.keyboardService.saveTriggered$.subscribe())'
      );
    });

    it('should subscribe to shortcuts.onNextRecord with real emission', () => {
      expect(appComponentSource).toContain(
        'shortcuts.onNextRecord(() => this.nextRecord$.next('
      );
    });

    it('should subscribe to navigation.onNavigate with router navigation', () => {
      expect(appComponentSource).toContain('this.router.navigate([route])');
    });

    it('should subscribe to contextMenu.onAction with functional dispatch', () => {
      // Must route to candidate detail with action query params, not empty break
      expect(appComponentSource).toContain("case 'tag-candidate':");
      expect(appComponentSource).toContain("case 'request-materials':");
      expect(appComponentSource).toContain("case 'create-approval':");
      // Each case must navigate, not be an empty break
      expect(appComponentSource).toContain("queryParams: { action: 'tag' }");
      expect(appComponentSource).toContain("queryParams: { action: 'request-materials' }");
      expect(appComponentSource).toContain("queryParams: { action: 'create-approval' }");
    });
  });
});
