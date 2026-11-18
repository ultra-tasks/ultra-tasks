import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Subject } from 'rxjs';
import { Action } from '@ngrx/store';
import { GlobalConfigEffects } from './global-config.effects';
import {
  mapKeyboardConfigToQwerty,
  mapShortcutToQwerty,
} from '../keyboard-shortcut.util';
import {
  KeyboardLayout,
  KeyboardLayoutService,
} from '../../../core/keyboard-layout/keyboard-layout.service';
import { DateService } from 'src/app/core/date/date.service';
import { LanguageService } from '../../../core/language/language.service';
import { SnackService } from '../../../core/snack/snack.service';
import { updateGlobalConfigSection } from './global-config.actions';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { AppStateActions } from '../../../root-store/app-state/app-state.actions';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { DEFAULT_GLOBAL_CONFIG } from '../default-global-config.const';
import { KeyboardConfig } from '@sp/keyboard-config';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { selectAllTasks } from '../../tasks/store/task.selectors';
import { IS_ELECTRON_TOKEN } from '../../../app.constants';
import { IS_MAC_TOKEN } from '../../../util/is-mac';
import { selectConfigFeatureState } from './global-config.reducer';

describe('GlobalConfigEffects', () => {
  let effects: GlobalConfigEffects;
  let actions$: Subject<Action>;
  let dateServiceSpy: jasmine.SpyObj<DateService>;
  let store: MockStore;

  const setup = (
    isElectron = false,
    isMac = false,
    keyboardLayoutService?: KeyboardLayoutService,
  ): void => {
    actions$ = new Subject<Action>();
    dateServiceSpy = jasmine.createSpyObj('DateService', [
      'setStartOfNextDayDiff',
      'todayStr',
      'getStartOfNextDayDiffMs',
    ]);
    dateServiceSpy.todayStr.and.returnValue('2026-02-20');
    dateServiceSpy.getStartOfNextDayDiffMs.and.returnValue(0);

    TestBed.configureTestingModule({
      providers: [
        GlobalConfigEffects,
        provideMockActions(() => actions$),
        provideMockStore(),
        { provide: LOCAL_ACTIONS, useValue: actions$ },
        { provide: DateService, useValue: dateServiceSpy },
        {
          provide: LanguageService,
          useValue: { setLng: jasmine.createSpy('setLng') },
        },
        {
          provide: SnackService,
          useValue: { open: jasmine.createSpy('open') },
        },
        { provide: IS_ELECTRON_TOKEN, useValue: isElectron },
        { provide: IS_MAC_TOKEN, useValue: isMac },
        {
          provide: KeyboardLayoutService,
          useValue: keyboardLayoutService || new KeyboardLayoutService(),
        },
      ],
    });

    store = TestBed.inject(MockStore);
    store.overrideSelector(selectAllTasks, []);
    effects = TestBed.inject(GlobalConfigEffects);
    effects.setStartOfNextDayDiffOnLoad.subscribe();
  };

  afterEach(() => {
    if (store) {
      store.resetSelectors();
    }
  });

  describe('setStartOfNextDayDiffOnChange', () => {
    beforeEach(() => setup());
    it('should call setStartOfNextDayDiff when startOfNextDay is set to a non-zero value', () => {
      const dispatched: Action[] = [];
      effects.setStartOfNextDayDiffOnChange.subscribe((a) => dispatched.push(a));

      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'misc',
          sectionCfg: { startOfNextDay: 4 },
        }),
      );

      expect(dateServiceSpy.setStartOfNextDayDiff).toHaveBeenCalledWith('04:00', 4);
    });

    it('should call setStartOfNextDayDiff when startOfNextDay is set to 0', () => {
      const dispatched: Action[] = [];
      effects.setStartOfNextDayDiffOnChange.subscribe((a) => dispatched.push(a));

      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'misc',
          sectionCfg: { startOfNextDay: 0 },
        }),
      );

      expect(dateServiceSpy.setStartOfNextDayDiff).toHaveBeenCalledWith('00:00', 0);
    });

    it('should not call setStartOfNextDayDiff for other config sections', () => {
      const dispatched: Action[] = [];
      effects.setStartOfNextDayDiffOnChange.subscribe((a) => dispatched.push(a));

      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'keyboard',
          sectionCfg: { globalShowHide: 'Ctrl+Shift+X' },
        }),
      );

      expect(dateServiceSpy.setStartOfNextDayDiff).not.toHaveBeenCalled();
      expect(dispatched.length).toBe(0);
    });

    it('should dispatch setTodayString when startOfNextDay changes', () => {
      const dispatched: Action[] = [];
      effects.setStartOfNextDayDiffOnChange.subscribe((a) => dispatched.push(a));

      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'misc',
          sectionCfg: { startOfNextDay: 4 },
        }),
      );

      expect(dispatched).toContain(
        AppStateActions.setTodayString({
          todayStr: '2026-02-20',
          startOfNextDayDiffMs: 0,
        }),
      );
    });

    it('should dispatch updateTasks when todayStr shifts and tasks have old dueDay', () => {
      // First call returns old date, second call (after setStartOfNextDayDiff) returns new date
      dateServiceSpy.todayStr.and.returnValues('2026-02-20', '2026-02-19');

      store.overrideSelector(selectAllTasks, [
        { id: 'task1', dueDay: '2026-02-20' } as any,
        { id: 'task2', dueDay: '2026-02-20' } as any,
        { id: 'task3', dueDay: '2026-02-18' } as any,
      ]);
      store.refreshState();

      const dispatched: Action[] = [];
      effects.setStartOfNextDayDiffOnChange.subscribe((a) => dispatched.push(a));

      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'misc',
          sectionCfg: { startOfNextDay: 4 },
        }),
      );

      const updateTasksAction = dispatched.find(
        (a) => a.type === TaskSharedActions.updateTasks.type,
      );
      expect(updateTasksAction).toBeTruthy();
      expect((updateTasksAction as any).tasks).toEqual([
        { id: 'task1', changes: { dueDay: '2026-02-19' } },
        { id: 'task2', changes: { dueDay: '2026-02-19' } },
      ]);
    });

    it('should not dispatch updateTasks when todayStr does not change', () => {
      // Both calls return the same date
      dateServiceSpy.todayStr.and.returnValue('2026-02-20');

      store.overrideSelector(selectAllTasks, [
        { id: 'task1', dueDay: '2026-02-20' } as any,
      ]);
      store.refreshState();

      const dispatched: Action[] = [];
      effects.setStartOfNextDayDiffOnChange.subscribe((a) => dispatched.push(a));

      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'misc',
          sectionCfg: { startOfNextDay: 0 },
        }),
      );

      const updateTasksAction = dispatched.find(
        (a) => a.type === TaskSharedActions.updateTasks.type,
      );
      expect(updateTasksAction).toBeUndefined();
    });

    it('should dispatch setTodayString with todayStr and startOfNextDayDiffMs', () => {
      dateServiceSpy.getStartOfNextDayDiffMs.and.returnValue(14400000);
      const dispatched: Action[] = [];
      effects.setStartOfNextDayDiffOnChange.subscribe((action) => {
        dispatched.push(action);
      });

      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'misc',
          sectionCfg: { startOfNextDay: 4 },
        }),
      );

      expect(dispatched).toContain(
        AppStateActions.setTodayString({
          todayStr: '2026-02-20',
          startOfNextDayDiffMs: 14400000,
        }),
      );
    });

    it('should normalize invalid startOfNextDayTime before updating DateService', () => {
      const dispatched: Action[] = [];
      effects.setStartOfNextDayDiffOnChange.subscribe((a) => dispatched.push(a));

      actions$.next(
        updateGlobalConfigSection({
          sectionKey: 'misc',
          sectionCfg: {
            startOfNextDay: 4,
            startOfNextDayTime: '24:00',
          },
        }),
      );

      expect(dateServiceSpy.setStartOfNextDayDiff).toHaveBeenCalledWith('00:00', 0);
    });
  });

  describe('setStartOfNextDayDiffOnLoad', () => {
    beforeEach(() => setup());
    it('should call setStartOfNextDayDiff when loadAllData is dispatched', () => {
      actions$.next(
        loadAllData({
          appDataComplete: {
            globalConfig: {
              ...DEFAULT_GLOBAL_CONFIG,
              misc: {
                ...DEFAULT_GLOBAL_CONFIG.misc,
                startOfNextDay: 4,
                startOfNextDayTime: undefined,
              },
            },
          } as any,
        }),
      );

      expect(dateServiceSpy.setStartOfNextDayDiff).toHaveBeenCalledWith('04:00', 4);
    });

    it('should dispatch setTodayString when loadAllData is dispatched', () => {
      dateServiceSpy.getStartOfNextDayDiffMs.and.returnValue(14400000);
      let emittedAction: Action | undefined;
      effects.setStartOfNextDayDiffOnLoad.subscribe((action) => {
        emittedAction = action;
      });

      actions$.next(
        loadAllData({
          appDataComplete: {
            globalConfig: {
              ...DEFAULT_GLOBAL_CONFIG,
              misc: {
                ...DEFAULT_GLOBAL_CONFIG.misc,
                startOfNextDay: 4,
                startOfNextDayTime: undefined,
              },
            },
          } as any,
        }),
      );

      expect(emittedAction).toEqual(
        AppStateActions.setTodayString({
          todayStr: '2026-02-20',
          startOfNextDayDiffMs: 14400000,
        }),
      );
    });

    it('should normalize invalid loaded startOfNextDayTime before updating DateService', () => {
      actions$.next(
        loadAllData({
          appDataComplete: {
            globalConfig: {
              ...DEFAULT_GLOBAL_CONFIG,
              misc: {
                ...DEFAULT_GLOBAL_CONFIG.misc,
                startOfNextDay: 4,
                startOfNextDayTime: '24:00',
              },
            },
          } as any,
        }),
      );

      expect(dateServiceSpy.setStartOfNextDayDiff).toHaveBeenCalledWith('00:00', 0);
    });
  });

  describe('shortcut mapping logic', () => {
    beforeEach(() => setup());
    let mockLayout: KeyboardLayout;

    beforeEach(() => {
      // Create a mock keyboard layout representing QWERTZ
      mockLayout = new Map([
        ['KeyA', 'a'],
        ['KeyB', 'b'],
        ['KeyY', 'z'],
        ['KeyZ', 'y'],
        ['Digit1', '1'],
        ['Digit2', '2'],
        ['BracketRight', '+'],
      ]);
    });

    describe('mapShortcutToQwerty', () => {
      it('should handle QWERTZ Y -> Z mapping', () => {
        expect(mapShortcutToQwerty('Ctrl+Y', mockLayout)).toBe('Ctrl+Z');
        expect(mapShortcutToQwerty('Ctrl+y', mockLayout)).toBe('Ctrl+Z');
      });

      it('should handle QWERTZ Z -> Y mapping', () => {
        expect(mapShortcutToQwerty('Ctrl+Z', mockLayout)).toBe('Ctrl+Y');
        expect(mapShortcutToQwerty('Ctrl+z', mockLayout)).toBe('Ctrl+Y');
      });

      it('should handle digit keys', () => {
        expect(mapShortcutToQwerty('Ctrl+1', mockLayout)).toBe('Ctrl+1');
        expect(mapShortcutToQwerty('Ctrl+Alt+2', mockLayout)).toBe('Ctrl+Alt+2');
      });

      it('should map punctuation key according to qwertyCodeMap (BracketRight -> + key on German layout)', () => {
        expect(mapShortcutToQwerty('Ctrl++', mockLayout)).toBe('Ctrl+]');
        expect(mapShortcutToQwerty('+', mockLayout)).toBe(']');
      });

      it('should return unchanged if character is not found in layout', () => {
        expect(mapShortcutToQwerty('Ctrl+F2', mockLayout)).toBe('Ctrl+F2');
        expect(mapShortcutToQwerty('Ctrl+Y', new Map())).toBe('Ctrl+Y');
      });

      it('should return null/undefined/empty inputs unchanged', () => {
        expect(mapShortcutToQwerty(null, mockLayout)).toBeNull();
        expect(mapShortcutToQwerty(undefined, mockLayout)).toBeUndefined();
        expect(mapShortcutToQwerty('', mockLayout)).toBe('');
      });
    });

    describe('mapKeyboardConfigToQwerty', () => {
      it('should map keyboard config shortcuts', () => {
        const keyboardCfg = {
          globalShowHide: 'Ctrl+Y',
          globalToggleTaskStart: 'Ctrl++',
          globalAddNote: 'Ctrl+F2',
          globalAddTask: null,
          globalToggleTaskWidget: undefined,
          toggleBacklog: 'Ctrl+Y',
        } as KeyboardConfig;

        const result = mapKeyboardConfigToQwerty(keyboardCfg, mockLayout);

        expect(result.globalShowHide).toBe('Ctrl+Z');
        expect(result.globalToggleTaskStart).toBe('Ctrl+]');
        expect(result.globalAddNote).toBe('Ctrl+F2');
        expect(result.globalAddTask).toBeNull();
        expect(result.globalToggleTaskWidget).toBeUndefined();
        expect(result.toggleBacklog).toBe('Ctrl+Y');
      });
    });
  });

  describe('global shortcut effects', () => {
    let registerGlobalShortcutsSpy: jasmine.Spy;

    beforeEach(() => {
      registerGlobalShortcutsSpy = jasmine.createSpy('registerGlobalShortcuts');
      (window as any).ea = {
        registerGlobalShortcuts: registerGlobalShortcutsSpy,
      };
    });

    afterEach(() => {
      delete (window as any).ea;
    });

    // The initial registration resolves asynchronously (macOS waits for the layout).
    const loadAllDataWithKeyboard = async (keyboard: KeyboardConfig): Promise<void> => {
      actions$.next(
        loadAllData({
          appDataComplete: {
            globalConfig: { ...DEFAULT_GLOBAL_CONFIG, keyboard },
          } as any,
        }),
      );
      await new Promise<void>((resolve) => setTimeout(resolve));
    };

    // Effects run after the reducer, so the store already holds the updated keyboard
    // config when `updateGlobalShortcut$` reads it. The mock store has no reducer.
    const setEffectiveKeyboard = (keyboard: KeyboardConfig): void => {
      store.overrideSelector(selectConfigFeatureState, {
        ...DEFAULT_GLOBAL_CONFIG,
        keyboard,
      });
      store.refreshState();
    };

    const updateKeyboard = (sectionCfg: Partial<KeyboardConfig>): void => {
      actions$.next(updateGlobalConfigSection({ sectionKey: 'keyboard', sectionCfg }));
    };

    describe('updateGlobalShortcut$', () => {
      it('should not send again when the update leaves the global bindings unchanged', () => {
        setup(true, false);
        effects.updateGlobalShortcut$.subscribe();
        const keyboardCfg = {
          ...DEFAULT_GLOBAL_CONFIG.keyboard,
          globalShowHide: 'Ctrl+X',
        };
        setEffectiveKeyboard(keyboardCfg);
        updateKeyboard(keyboardCfg);

        // Only an in-app shortcut changes (e.g. accepting a suggested replacement).
        setEffectiveKeyboard({ ...keyboardCfg, undo: 'Ctrl+Alt+Z' });
        updateKeyboard({ undo: 'Ctrl+Alt+Z' });

        expect(registerGlobalShortcutsSpy).toHaveBeenCalledTimes(1);
      });

      it('should send again after a real change of a global binding', () => {
        setup(true, false);
        effects.updateGlobalShortcut$.subscribe();
        const keyboardCfg = {
          ...DEFAULT_GLOBAL_CONFIG.keyboard,
          globalShowHide: 'Ctrl+X',
        };
        setEffectiveKeyboard(keyboardCfg);
        updateKeyboard(keyboardCfg);

        const changedCfg = { ...keyboardCfg, globalAddTask: 'Ctrl+Alt+A' };
        setEffectiveKeyboard(changedCfg);
        updateKeyboard({ globalAddTask: 'Ctrl+Alt+A' });

        expect(registerGlobalShortcutsSpy).toHaveBeenCalledTimes(2);
        expect(registerGlobalShortcutsSpy.calls.mostRecent().args[0]).toEqual(changedCfg);
      });

      it('should send the complete effective keyboard config when the update carries only the changed keys', () => {
        setup(true, false);
        effects.updateGlobalShortcut$.subscribe();
        // The main process treats what it receives as the complete set of global bindings.
        const effectiveCfg = {
          ...DEFAULT_GLOBAL_CONFIG.keyboard,
          globalShowHide: 'Ctrl+X',
          globalAddTask: 'Ctrl+Alt+A',
        };
        setEffectiveKeyboard(effectiveCfg);

        updateKeyboard({ globalAddTask: 'Ctrl+Alt+A' });

        expect(registerGlobalShortcutsSpy).toHaveBeenCalledOnceWith(effectiveCfg);
      });

      it('should keep the global bindings registered when a partial update changes only an in-app shortcut', async () => {
        setup(true, false);
        effects.registerGlobalShortcutInitially$.subscribe();
        effects.updateGlobalShortcut$.subscribe();
        const keyboardCfg = {
          ...DEFAULT_GLOBAL_CONFIG.keyboard,
          globalShowHide: 'Ctrl+X',
        };
        await loadAllDataWithKeyboard(keyboardCfg);

        // `{ undo }` alone would otherwise be read as "no global bindings any more".
        setEffectiveKeyboard({ ...keyboardCfg, undo: 'Ctrl+Alt+Z' });
        updateKeyboard({ undo: 'Ctrl+Alt+Z' });

        expect(registerGlobalShortcutsSpy).toHaveBeenCalledTimes(1);
        expect(registerGlobalShortcutsSpy).toHaveBeenCalledWith(keyboardCfg);
      });

      it('should send a global change that follows the initial registration', async () => {
        setup(true, false);
        effects.registerGlobalShortcutInitially$.subscribe();
        effects.updateGlobalShortcut$.subscribe();
        const keyboardCfg = {
          ...DEFAULT_GLOBAL_CONFIG.keyboard,
          globalShowHide: 'Ctrl+X',
        };
        await loadAllDataWithKeyboard(keyboardCfg);

        const changedCfg = { ...keyboardCfg, globalShowHide: 'Ctrl+Alt+X' };
        setEffectiveKeyboard(changedCfg);
        updateKeyboard({ globalShowHide: 'Ctrl+Alt+X' });

        expect(registerGlobalShortcutsSpy).toHaveBeenCalledTimes(2);
        expect(registerGlobalShortcutsSpy.calls.mostRecent().args[0]).toEqual(changedCfg);
      });

      it('should register shortcuts in Electron', () => {
        setup(true, false);
        effects.updateGlobalShortcut$.subscribe();

        const keyboardCfg = {
          ...DEFAULT_GLOBAL_CONFIG.keyboard,
          globalShowHide: 'Ctrl+X',
        };
        actions$.next(
          updateGlobalConfigSection({
            sectionKey: 'keyboard',
            sectionCfg: keyboardCfg,
          }),
        );

        expect(registerGlobalShortcutsSpy).toHaveBeenCalledWith(keyboardCfg);
      });

      it('should translate shortcuts to QWERTY on macOS Electron', () => {
        const keyboardLayoutService = new KeyboardLayoutService();
        setup(true, true, keyboardLayoutService);
        keyboardLayoutService.setLayout(
          new Map([
            ['KeyY', 'z'],
            ['KeyZ', 'y'],
          ]),
        );
        effects.updateGlobalShortcut$.subscribe();

        const keyboardCfg = {
          ...DEFAULT_GLOBAL_CONFIG.keyboard,
          globalShowHide: 'Ctrl+Y',
        };
        actions$.next(
          updateGlobalConfigSection({
            sectionKey: 'keyboard',
            sectionCfg: keyboardCfg,
          }),
        );

        // Ctrl+Y on QWERTZ is KeyY, which is Ctrl+Z on QWERTY
        expect(registerGlobalShortcutsSpy).toHaveBeenCalledWith(
          jasmine.objectContaining({
            globalShowHide: 'Ctrl+Z',
          }),
        );
      });

      it('should NOT register shortcuts if NOT in Electron', () => {
        setup(false, false);
        effects.updateGlobalShortcut$.subscribe();
        actions$.next(
          updateGlobalConfigSection({
            sectionKey: 'keyboard',
            sectionCfg: DEFAULT_GLOBAL_CONFIG.keyboard,
          }),
        );
        expect(registerGlobalShortcutsSpy).not.toHaveBeenCalled();
      });
    });

    describe('registerGlobalShortcutInitially$', () => {
      it('should not send unchanged global bindings again when a later loadAllData (e.g. an applied account snapshot) carries them', async () => {
        setup(true, false);
        effects.registerGlobalShortcutInitially$.subscribe();
        const keyboardCfg = {
          ...DEFAULT_GLOBAL_CONFIG.keyboard,
          globalShowHide: 'Ctrl+X',
        };

        await loadAllDataWithKeyboard(keyboardCfg);
        await loadAllDataWithKeyboard({ ...keyboardCfg });
        await loadAllDataWithKeyboard({ ...keyboardCfg });

        expect(registerGlobalShortcutsSpy).toHaveBeenCalledOnceWith(keyboardCfg);
      });

      it('should ignore changes to in-app shortcuts in a later loadAllData', async () => {
        setup(true, false);
        effects.registerGlobalShortcutInitially$.subscribe();
        const keyboardCfg = {
          ...DEFAULT_GLOBAL_CONFIG.keyboard,
          globalShowHide: 'Ctrl+X',
          undo: 'Ctrl+Z',
        };

        await loadAllDataWithKeyboard(keyboardCfg);
        await loadAllDataWithKeyboard({ ...keyboardCfg, undo: 'Ctrl+Alt+Z' });

        expect(registerGlobalShortcutsSpy).toHaveBeenCalledTimes(1);
      });

      it('should send again when a later loadAllData changes a global binding', async () => {
        setup(true, false);
        effects.registerGlobalShortcutInitially$.subscribe();
        const keyboardCfg = {
          ...DEFAULT_GLOBAL_CONFIG.keyboard,
          globalShowHide: 'Ctrl+X',
        };
        const changedCfg = { ...keyboardCfg, globalAddTask: 'Ctrl+Alt+A' };

        await loadAllDataWithKeyboard(keyboardCfg);
        await loadAllDataWithKeyboard(changedCfg);

        expect(registerGlobalShortcutsSpy).toHaveBeenCalledTimes(2);
        expect(registerGlobalShortcutsSpy.calls.mostRecent().args[0]).toEqual(changedCfg);
      });

      it('should send again when a later loadAllData clears a global binding', async () => {
        setup(true, false);
        effects.registerGlobalShortcutInitially$.subscribe();
        const keyboardCfg = {
          ...DEFAULT_GLOBAL_CONFIG.keyboard,
          globalShowHide: 'Ctrl+X',
        };
        const clearedCfg = { ...keyboardCfg, globalShowHide: null };

        await loadAllDataWithKeyboard(keyboardCfg);
        await loadAllDataWithKeyboard(clearedCfg);

        expect(registerGlobalShortcutsSpy).toHaveBeenCalledTimes(2);
        expect(registerGlobalShortcutsSpy.calls.mostRecent().args[0]).toEqual(clearedCfg);
      });

      it('should treat a missing binding and a null binding alike', async () => {
        setup(true, false);
        effects.registerGlobalShortcutInitially$.subscribe();
        const withNull = { ...DEFAULT_GLOBAL_CONFIG.keyboard, globalAddNote: null };
        const withoutKey = Object.fromEntries(
          Object.entries(withNull).filter(([key]) => key !== 'globalAddNote'),
        ) as KeyboardConfig;

        await loadAllDataWithKeyboard(withNull);
        await loadAllDataWithKeyboard(withoutKey);

        expect(registerGlobalShortcutsSpy).toHaveBeenCalledTimes(1);
      });

      it('should still send the first load even when it carries no global binding', async () => {
        setup(true, false);
        effects.registerGlobalShortcutInitially$.subscribe();
        const noGlobalBindings = {
          ...DEFAULT_GLOBAL_CONFIG.keyboard,
          globalShowHide: null,
        };

        await loadAllDataWithKeyboard(noGlobalBindings);

        expect(registerGlobalShortcutsSpy).toHaveBeenCalledOnceWith(noGlobalBindings);
      });

      it('should compare the QWERTY-mapped bindings on macOS', async () => {
        const keyboardLayoutService = new KeyboardLayoutService();
        setup(true, true, keyboardLayoutService);
        keyboardLayoutService.setLayout(
          new Map([
            ['KeyY', 'z'],
            ['KeyZ', 'y'],
          ]),
        );
        effects.registerGlobalShortcutInitially$.subscribe();

        // Both spellings are the same key on this layout, so they map to the same binding.
        await loadAllDataWithKeyboard({
          ...DEFAULT_GLOBAL_CONFIG.keyboard,
          globalShowHide: 'Ctrl+Z',
        });
        await loadAllDataWithKeyboard({
          ...DEFAULT_GLOBAL_CONFIG.keyboard,
          globalShowHide: 'Ctrl+z',
        });
        expect(registerGlobalShortcutsSpy).toHaveBeenCalledTimes(1);
        expect(registerGlobalShortcutsSpy).toHaveBeenCalledWith(
          jasmine.objectContaining({ globalShowHide: 'Ctrl+Y' }),
        );

        // A different key maps to a different binding and is sent.
        await loadAllDataWithKeyboard({
          ...DEFAULT_GLOBAL_CONFIG.keyboard,
          globalShowHide: 'Ctrl+Y',
        });
        expect(registerGlobalShortcutsSpy).toHaveBeenCalledTimes(2);
        expect(registerGlobalShortcutsSpy.calls.mostRecent().args[0]).toEqual(
          jasmine.objectContaining({ globalShowHide: 'Ctrl+Z' }),
        );
      });

      it('should register shortcuts initially in Electron', (done) => {
        setup(true, false);

        const keyboardCfg = {
          ...DEFAULT_GLOBAL_CONFIG.keyboard,
          globalShowHide: 'Ctrl+X',
        };
        effects.registerGlobalShortcutInitially$.subscribe(() => {
          expect(registerGlobalShortcutsSpy).toHaveBeenCalledWith(keyboardCfg);
          done();
        });

        actions$.next(
          loadAllData({
            appDataComplete: {
              globalConfig: {
                ...DEFAULT_GLOBAL_CONFIG,
                keyboard: keyboardCfg,
              },
            } as any,
          }),
        );
      });

      it('should wait for layout and translate to QWERTY initially on macOS Electron', (done) => {
        const keyboardLayoutService = new KeyboardLayoutService();
        setup(true, true, keyboardLayoutService);

        // We don't call setLayout yet, so layoutReady is still pending
        const keyboardCfg = {
          ...DEFAULT_GLOBAL_CONFIG.keyboard,
          globalShowHide: 'Ctrl+Y',
        };

        effects.registerGlobalShortcutInitially$.subscribe(() => {
          expect(registerGlobalShortcutsSpy).toHaveBeenCalledWith(
            jasmine.objectContaining({
              globalShowHide: 'Ctrl+Z',
            }),
          );
          done();
        });

        actions$.next(
          loadAllData({
            appDataComplete: {
              globalConfig: {
                ...DEFAULT_GLOBAL_CONFIG,
                keyboard: keyboardCfg,
              },
            } as any,
          }),
        );

        // Now resolve the layout in a macrotask to ensure the await logic is exercised
        setTimeout(() => {
          keyboardLayoutService.setLayout(
            new Map([
              ['KeyY', 'z'],
              ['KeyZ', 'y'],
            ]),
          );
        });
      });
    });
  });
});
