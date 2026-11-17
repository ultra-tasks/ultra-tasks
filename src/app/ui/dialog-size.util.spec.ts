import { Injector, runInInjectionContext } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import {
  dialogSize,
  dialogWindowHeight,
  useDialogSize,
  viewportHeight,
} from './dialog-size.util';

describe('dialogSize', () => {
  it('should map each size to its panel class', () => {
    expect(dialogSize('s')).toEqual({ panelClass: 'dialog-s' });
    expect(dialogSize('m')).toEqual({ panelClass: 'dialog-m' });
    expect(dialogSize('l')).toEqual({ panelClass: 'dialog-l' });
    expect(dialogSize('window')).toEqual({ panelClass: 'dialog-window' });
  });

  it('should keep extra panel classes next to the size class', () => {
    expect(dialogSize('window', 'settings-window')).toEqual({
      panelClass: ['dialog-window', 'settings-window'],
    });
  });
});

describe('useDialogSize', () => {
  const run = (ref: unknown): void => {
    const injector = Injector.create({
      providers: ref === undefined ? [] : [{ provide: MatDialogRef, useValue: ref }],
    });
    runInInjectionContext(injector, () => useDialogSize('m'));
  };

  it('should add the size class to the dialog panel', () => {
    const addPanelClass = jasmine.createSpy('addPanelClass');
    run({ addPanelClass });
    expect(addPanelClass).toHaveBeenCalledWith('dialog-m');
  });

  it('should do nothing outside a dialog or with a ref that cannot take classes', () => {
    expect(() => run(undefined)).not.toThrow();
    expect(() => run({})).not.toThrow();
  });
});

describe('viewportHeight', () => {
  it('uses dvh where the browser knows it', () => {
    spyOn(CSS, 'supports').and.returnValue(true);
    expect(viewportHeight(86)).toBe('86dvh');
  });

  it('falls back to vh in a WebView older than Chrome 108', () => {
    spyOn(CSS, 'supports').and.returnValue(false);
    expect(viewportHeight(86)).toBe('86vh');
  });

  it('asks for the unit it may return', () => {
    const supports = spyOn(CSS, 'supports').and.returnValue(true);
    viewportHeight(10);
    // `CSS.supports` has two overloads; the spy is typed after the one-argument form.
    expect(supports.calls.mostRecent().args as unknown[]).toEqual(['height', '1dvh']);
  });
});

describe('dialogWindowHeight', () => {
  it('is 86% of the viewport, 96% at most', () => {
    spyOn(CSS, 'supports').and.returnValue(true);
    expect(dialogWindowHeight()).toEqual({ height: '86dvh', maxHeight: '96dvh' });
  });

  it('keeps both in vh when dvh is unknown', () => {
    spyOn(CSS, 'supports').and.returnValue(false);
    expect(dialogWindowHeight()).toEqual({ height: '86vh', maxHeight: '96vh' });
  });
});
