import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { GlassSettingsComponent } from './glass-settings.component';
import { UltraTasksAppearanceService } from '../../../core/theme/ultra-tasks-appearance.service';
import { PaletteThemeService } from '../../../core/theme/palette-theme.service';
import { SnackService } from '../../../core/snack/snack.service';
import { GlobalConfigService } from '../global-config.service';
import { DEFAULT_PALETTE } from '../../../core/theme/palette.util';
import { T } from '../../../t.const';

describe('GlassSettingsComponent', () => {
  let fixture: ComponentFixture<GlassSettingsComponent>;
  let glassEnabled: WritableSignal<boolean>;
  let misc: WritableSignal<Record<string, string | null>>;
  let updateSection: jasmine.Spy;
  let snackOpen: jasmine.Spy;
  let setGlass: jasmine.Spy;

  const setup = (nativeMaterial: 'vibrancy' | null = null): void => {
    glassEnabled = signal(true);
    misc = signal({});
    updateSection = jasmine.createSpy('updateSection');
    snackOpen = jasmine.createSpy('open');
    setGlass = jasmine.createSpy('setGlass');
    TestBed.configureTestingModule({
      imports: [GlassSettingsComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: UltraTasksAppearanceService,
          useValue: { glassEnabled, nativeMaterial, setGlass },
        },
        {
          provide: PaletteThemeService,
          useValue: {
            roles: (isDark: boolean) => DEFAULT_PALETTE[isDark ? 'dark' : 'light'],
          },
        },
        { provide: GlobalConfigService, useValue: { misc, updateSection } },
        { provide: SnackService, useValue: { open: snackOpen } },
      ],
    });
    fixture = TestBed.createComponent(GlassSettingsComponent);
    fixture.detectChanges();
  };
  const el = (selector: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(selector);

  it('switches glass from the toggle', () => {
    setup();
    const toggle = el('.st-glass-setting [role="switch"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    toggle.click();
    expect(setGlass).toHaveBeenCalledWith(false);
  });

  it('is one toggle in a field box, not a bare checkbox', () => {
    setup();
    expect(el('input[type="checkbox"]')).toBeNull();
    expect(el('mat-form-field.st-glass-setting mat-slide-toggle')).not.toBeNull();
  });

  it('shows the image rows only with glass on and a drawn backdrop', () => {
    setup();
    expect(el('.st-glass-background')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.mode').length).toBe(2);
    glassEnabled.set(false);
    fixture.detectChanges();
    expect(el('.st-glass-background')).toBeNull();
  });

  it('hides the image rows where the desktop is blurred instead', () => {
    setup('vibrancy');
    expect(el('.st-glass-background')).toBeNull();
    expect(fixture.componentInstance.glassHint).toBe(T.F.ULTRA_TASKS.GLASS_HINT_DESKTOP);
  });

  it('previews the gradient until an image is set', () => {
    setup();
    const light = el('.mode[data-mode="light"]')!;
    expect(light.querySelector('img')!.getAttribute('src')).toMatch(/^data:image\/png/);
    expect(light.querySelector('button.remove')).toBeNull();
  });

  it('removes an image with one silent config update', () => {
    setup();
    misc.set({ backgroundImageDark: 'data:image/webp;base64,AAAA' });
    fixture.detectChanges();
    (el('.mode[data-mode="dark"] button.remove') as HTMLButtonElement).click();
    expect(updateSection).toHaveBeenCalledOnceWith(
      'misc',
      { backgroundImageDark: null },
      true,
    );
  });

  it('stores a chosen file reduced, for the chosen mode', async () => {
    setup();
    const input = el('input[type="file"]') as HTMLInputElement;
    spyOn(input, 'click');
    (el('.mode[data-mode="dark"] button.choose') as HTMLButtonElement).click();
    expect(input.click).toHaveBeenCalled();

    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 300;
    canvas.getContext('2d')!.fillRect(0, 0, 600, 300);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png'),
    );
    const file = new File([blob], 'photo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await fixture.componentInstance.onFileSelected({ target: input } as unknown as Event);

    expect(updateSection).toHaveBeenCalledTimes(1);
    const [section, changes, isSkipSnack] = updateSection.calls.mostRecent().args;
    expect(section).toBe('misc');
    expect(isSkipSnack).toBeTrue();
    expect(Object.keys(changes)).toEqual(['backgroundImageDark']);
    expect(changes.backgroundImageDark).toMatch(/^data:image\/(webp|jpeg);base64,/);
    expect(snackOpen).not.toHaveBeenCalled();
  });

  it('explains an unreadable file', async () => {
    setup();
    const input = el('input[type="file"]') as HTMLInputElement;
    spyOn(input, 'click');
    (el('.mode[data-mode="light"] button.choose') as HTMLButtonElement).click();
    const svg = new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' });
    Object.defineProperty(input, 'files', { value: [svg], configurable: true });
    await fixture.componentInstance.onFileSelected({ target: input } as unknown as Event);
    expect(updateSection).not.toHaveBeenCalled();
    expect(snackOpen).toHaveBeenCalledWith(
      jasmine.objectContaining({
        msg: T.F.PROJECT.FORM_THEME.S_BACKGROUND_IMAGE_READ_ERROR,
      }),
    );
  });
});
