import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatFormField } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { SettingHelpComponent } from '../../../ui/setting-help/setting-help.component';
import { UltraTasksAppearanceService } from '../../../core/theme/ultra-tasks-appearance.service';
import { PaletteThemeService } from '../../../core/theme/palette-theme.service';
import { SnackService } from '../../../core/snack/snack.service';
import { GlobalConfigService } from '../global-config.service';
import { resolveBgImageToDataUrl } from '../../../core/theme/resolve-bg-image-to-data-url.util';
import { glassGradientDataUrl } from '../../../core/theme/glass-backdrop/glass-backdrop.util';
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_SOURCE_IMAGE_BYTES,
  reduceImageFile,
  ReduceImageError,
} from '../../../core/theme/glass-backdrop/reduce-image-file.util';

type ImageKey = 'backgroundImageLight' | 'backgroundImageDark';

interface ImageSlot {
  key: ImageKey;
  mode: 'light' | 'dark';
  label: string;
  isSet: boolean;
  preview: string | null;
}

/**
 * Settings → General → Appearance: the device-local Glass switch and, where the
 * app draws its own backdrop (web, mobile, Linux, Windows 10), the background
 * image it blurs. The macOS and Windows 11 desktop app blur the desktop
 * instead, so the image rows are hidden there.
 */
@Component({
  selector: 'glass-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButton,
    MatFormField,
    MatInput,
    MatSlideToggle,
    TranslatePipe,
    SettingHelpComponent,
  ],
  templateUrl: './glass-settings.component.html',
  styleUrl: './glass-settings.component.scss',
})
export class GlassSettingsComponent {
  readonly appearance = inject(UltraTasksAppearanceService);
  private readonly _paletteThemeService = inject(PaletteThemeService);
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _snackService = inject(SnackService);

  readonly T = T;
  readonly accept = ACCEPTED_IMAGE_TYPES.join(',');
  readonly glassHint = this.appearance.nativeMaterial
    ? T.F.ULTRA_TASKS.GLASS_HINT_DESKTOP
    : T.F.ULTRA_TASKS.GLASS_HINT;
  /** The image is only ever shown blurred behind glass, never on its own. */
  readonly isBackgroundShown = computed(
    () => this.appearance.glassEnabled() && !this.appearance.nativeMaterial,
  );

  private readonly _resolved = signal<Record<ImageKey, string | null>>({
    backgroundImageLight: null,
    backgroundImageDark: null,
  });
  private readonly _raw = computed(() => {
    const misc = this._globalConfigService.misc();
    return {
      backgroundImageLight: misc?.backgroundImageLight || null,
      backgroundImageDark: misc?.backgroundImageDark || null,
    };
  });

  readonly slots = computed<ImageSlot[]>(() => {
    const raw = this._raw();
    const resolved = this._resolved();
    return (
      [
        ['backgroundImageLight', 'light', T.F.ULTRA_TASKS.BG_IMAGE_LIGHT],
        ['backgroundImageDark', 'dark', T.F.ULTRA_TASKS.BG_IMAGE_DARK],
      ] as const
    ).map(([key, mode, label]) => ({
      key,
      mode,
      label,
      isSet: !!raw[key]?.trim(),
      preview: raw[key]?.trim()
        ? resolved[key]
        : glassGradientDataUrl(this._paletteThemeService.roles(mode === 'dark')),
    }));
  });

  private _pendingKey: ImageKey | null = null;

  constructor() {
    let requestId = 0;
    effect(() => {
      if (!this.isBackgroundShown()) return;
      const raw = this._raw();
      const currentRequest = ++requestId;
      void Promise.all([
        resolveBgImageToDataUrl(raw.backgroundImageLight),
        resolveBgImageToDataUrl(raw.backgroundImageDark),
      ]).then(([light, dark]) => {
        if (currentRequest === requestId) {
          this._resolved.set({ backgroundImageLight: light, backgroundImageDark: dark });
        }
      });
    });
  }

  choose(key: ImageKey, fileInput: HTMLInputElement): void {
    this._pendingKey = key;
    fileInput.click();
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const key = this._pendingKey;
    input.value = '';
    this._pendingKey = null;
    if (!file || !key) return;
    try {
      const dataUrl = await reduceImageFile(file);
      this._save(key, dataUrl);
    } catch (err) {
      const isTooLarge = err instanceof ReduceImageError && err.reason === 'size';
      this._snackService.open(
        isTooLarge
          ? {
              type: 'ERROR',
              msg: T.F.PROJECT.FORM_THEME.S_BACKGROUND_IMAGE_TOO_LARGE,
              translateParams: { maxSizeKb: Math.round(MAX_SOURCE_IMAGE_BYTES / 1024) },
            }
          : { type: 'ERROR', msg: T.F.PROJECT.FORM_THEME.S_BACKGROUND_IMAGE_READ_ERROR },
      );
    }
  }

  remove(key: ImageKey): void {
    this._save(key, null);
  }

  private _save(key: ImageKey, value: string | null): void {
    // One op per user action; the preview updating is the confirmation.
    this._globalConfigService.updateSection('misc', { [key]: value }, true);
  }
}
