import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { NativeSyncComponent } from './native-sync.component';
import { NativeSyncService } from './native-sync.service';
import { NativeAccountLoginService } from './native-account-login.service';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { DateService } from '../../core/date/date.service';
import { getAllEnv } from '../../util/env';
import { environment as appEnvironment } from '../../../environments/environment';

describe('UltraTasks Account server selection', () => {
  const official = 'https://accounts.example.test';
  const custom = 'https://self-host.example.test';
  const environment = getAllEnv() as Record<string, string | undefined>;
  let previousOfficial: string | undefined;
  let previousServer: string | null;
  beforeEach(() => {
    previousOfficial = environment['ULTRA_ACCOUNT_URL'];
    previousServer = localStorage.getItem('ultra-native-server');
    environment['ULTRA_ACCOUNT_URL'] = official;
    localStorage.removeItem('ultra-native-server');
    TestBed.configureTestingModule({
      providers: [
        { provide: ActivatedRoute, useValue: {} },
        { provide: MatDialog, useValue: {} },
        { provide: Store, useValue: { selectSignal: () => signal([]) } },
        { provide: NativeSyncService, useValue: {} },
        { provide: NativeAccountLoginService, useValue: {} },
        { provide: StateSnapshotService, useValue: {} },
        { provide: DateService, useValue: {} },
      ],
    });
  });
  afterEach(() => {
    if (previousOfficial === undefined) delete environment['ULTRA_ACCOUNT_URL'];
    else environment['ULTRA_ACCOUNT_URL'] = previousOfficial;
    if (previousServer === null) localStorage.removeItem('ultra-native-server');
    else localStorage.setItem('ultra-native-server', previousServer);
  });
  const create = (): NativeSyncComponent =>
    TestBed.runInInjectionContext(() => new NativeSyncComponent());

  it('defaults new sign-in to the configured official server', () => {
    const component = create();
    expect(component.serverMode).toBe('official');
    expect(component.server).toBe(official);
  });
  it('uses the deployed official origin in production without a build override', () => {
    const build = appEnvironment as { production: boolean };
    const previousProduction = build.production;
    try {
      build.production = true;
      delete environment['ULTRA_ACCOUNT_URL'];
      const component = create();
      expect(component.serverMode).toBe('official');
      expect(component.server).toBe('https://app.ultratasks.app');
    } finally {
      build.production = previousProduction;
    }
  });
  it('preserves an existing self-hosted endpoint', () => {
    localStorage.setItem('ultra-native-server', custom);
    const component = create();
    expect(component.serverMode).toBe('custom');
    expect(component.server).toBe(custom);
  });
  it('keeps a custom endpoint when switching back and forth', () => {
    const component = create();
    component.selectServerMode('custom');
    component.server = custom;
    component.selectServerMode('official');
    expect(component.server).toBe(official);
    component.selectServerMode('custom');
    expect(component.server).toBe(custom);
  });
  it('supports custom-only builds without inventing an official origin', () => {
    delete environment['ULTRA_ACCOUNT_URL'];
    const component = create();
    expect(component.serverMode).toBe('custom');
    expect(component.server).toBe('');
  });
});
