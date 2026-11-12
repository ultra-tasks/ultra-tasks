import { TestBed } from '@angular/core/testing';
import { FirstRunGateService, FirstRunOutcome } from './first-run-gate.service';

describe('FirstRunGateService', () => {
  let gate: FirstRunGateService;
  let seen: FirstRunOutcome[];

  beforeEach(() => {
    gate = TestBed.inject(FirstRunGateService);
    seen = [];
  });

  it('resolves at once as not-offered when nobody holds the gate', () => {
    gate.whenReleased$().subscribe((outcome) => seen.push(outcome));
    expect(seen).toEqual(['not-offered']);
  });

  it('waits while held and emits the released outcome once', () => {
    gate.hold();
    gate.whenReleased$().subscribe((outcome) => seen.push(outcome));
    expect(seen).toEqual([]);
    gate.release('fresh');
    gate.release('skip');
    expect(seen).toEqual(['fresh']);
  });

  it('keeps the outcome for a late subscriber', () => {
    gate.hold();
    gate.release('restore');
    gate.whenReleased$().subscribe((outcome) => seen.push(outcome));
    expect(seen).toEqual(['restore']);
  });

  it('carries the sync outcome like any other', () => {
    gate.hold();
    gate.whenReleased$().subscribe((outcome) => seen.push(outcome));
    gate.release('sync');
    expect(seen).toEqual(['sync']);
  });
});
