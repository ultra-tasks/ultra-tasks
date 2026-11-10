import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { DialogKeyboardShortcutsComponent } from './dialog-keyboard-shortcuts.component';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { PluginBridgeService } from '../../../plugins/plugin-bridge.service';
import { PluginShortcutCfg } from '../../../plugins/plugin-api.model';
import { T } from '../../../t.const';
import { TaskUndoService } from '../../../features/tasks/task-undo.service';
import { IS_MAC } from '../../../util/is-mac';

describe('DialogKeyboardShortcutsComponent', () => {
  const setup = (
    keyboard: Record<string, string | null>,
    shortcuts: PluginShortcutCfg[] = [],
  ): DialogKeyboardShortcutsComponent => {
    TestBed.configureTestingModule({
      providers: [
        { provide: GlobalConfigService, useValue: { cfg: signal({ keyboard }) } },
        { provide: PluginBridgeService, useValue: { shortcuts: signal(shortcuts) } },
        {
          provide: TaskUndoService,
          useValue: { canUndo: signal(false), canRedo: signal(false) },
        },
      ],
    });
    return TestBed.runInInjectionContext(() => new DialogKeyboardShortcutsComponent());
  };

  it('should use the h3 heading for the task section and skip the info paragraph', () => {
    const rows = setup({ taskEditTitle: 'Enter' }).rows();

    expect(rows).toContain({ heading: T.GCF.KEYBOARD.TASK_SHORTCUTS });
    expect(rows).toContain({ label: T.GCF.KEYBOARD.TASK_EDIT_TITLE, combo: 'Enter' });
    expect(rows).toContain({ label: T.GCF.KEYBOARD.TASK_DUPLICATE, combo: undefined });
  });

  it('should include the showHelp shortcut', () => {
    const rows = setup({ showHelp: '?' }).rows();

    expect(rows).toContain({ label: T.GCF.KEYBOARD.SHOW_HELP, combo: '?' });
  });

  it('should include registered plugin shortcuts', () => {
    const pluginKey = 'plugin_my-plugin:doIt';
    const rows = setup({ [pluginKey]: 'Ctrl+P' }, [
      { pluginId: 'my-plugin', id: 'doIt', label: 'Do it', onExec: () => undefined },
    ]).rows();

    expect(rows).toContain({ heading: T.GCF.KEYBOARD.PLUGIN_SHORTCUTS });
    expect(rows).toContain({ label: 'Do it (my-plugin)', combo: 'Ctrl+P' });
  });

  it('shows conflicting saved bindings and fixed navigation without changing them', () => {
    const rows = setup({
      taskScheduleDeadline: 'Shift+S',
      goToScheduledView: 'Shift+S',
    }).rows();
    expect(rows).toContain({
      label: T.GCF.KEYBOARD.TASK_SCHEDULE_DEADLINE,
      combo: 'Shift+S',
      conflict: true,
    });
    expect(rows).toContain(
      jasmine.objectContaining({
        label: T.GCF.KEYBOARD.GO_TO_SCHEDULED_VIEW,
        combo: 'Shift+S',
        conflict: true,
        suggested: 'Shift+C',
      }),
    );
    expect(rows).toContain({
      label: T.GCF.KEYBOARD.FIXED_TASK_SELECT_RANGE,
      combo: 'Shift+↑ / Shift+↓',
    });
  });

  it('warns when a configured key collides with the default redo alternative', () => {
    const combo = IS_MAC ? 'Meta+Shift+Z' : 'Ctrl+Shift+Z';
    const rows = setup({ redo: 'Ctrl+Y', taskDelete: combo }).rows();
    expect(rows).toContain(
      jasmine.objectContaining({
        label: T.GCF.KEYBOARD.TASK_DELETE,
        combo,
        conflict: true,
      }),
    );
  });
});
