import { TabSeqFrontierService } from './tab-seq-frontier.service';

describe('TabSeqFrontierService (#9438)', () => {
  let service: TabSeqFrontierService;

  beforeEach(() => {
    service = new TabSeqFrontierService();
  });

  it('defaults open while no frontier is established (pre-#9438 behavior)', () => {
    expect(service.isSaveSafeAt(0)).toBe(true);
    expect(service.isSaveSafeAt(42)).toBe(true);
  });

  it('leaves ordinary snapshot checks default-open before a frontier is established', () => {
    service.observeOwnWrite(7);
    expect(service.isSaveSafeAt(7)).toBe(true);
    expect(service.isSaveSafeAt(99)).toBe(true);
  });

  it('allows an empty log and a fresh profile with only contiguous own writes for replacement', () => {
    expect(service.isReplacementSafeAt(null, 0)).toBe(true);
    service.observeOwnWrite(1);
    service.observeOwnWrite(2);
    expect(service.isReplacementSafeAt(1, 2)).toBe(true);
  });

  it('rejects a foreign operation before the first observed own write', () => {
    service.observeOwnWrite(8);
    expect(service.isReplacementSafeAt(7, 8)).toBe(false);
  });

  it('rejects a foreign operation between observed own writes', () => {
    service.observeOwnWrite(7);
    service.observeOwnWrite(9);
    expect(service.isReplacementSafeAt(7, 9)).toBe(false);
  });

  it('rejects a foreign operation after the last observed own write', () => {
    service.observeOwnWrite(7);
    service.observeOwnWrite(8);
    expect(service.isReplacementSafeAt(7, 9)).toBe(false);
  });

  it('fails closed for unknown or truncated ranges', () => {
    expect(service.isReplacementSafeAt(7, 7)).toBe(false);
    service.observeOwnWrite(7);
    service.observeOwnWrite(8);
    expect(service.isReplacementSafeAt(8, 8)).toBe(false);
    expect(service.isReplacementSafeAt(7, 0)).toBe(false);
  });

  it('clears observed ranges after a wipe and accepts the resumed sequence generator', () => {
    service.observeOwnWrite(2);
    service.observeOwnWrite(4);
    service.establishFrontier(0);
    expect(service.isReplacementSafeAt(2, 4)).toBe(false);
    expect(service.isReplacementSafeAt(null, 0)).toBe(true);
    service.observeOwnWrite(20);
    service.observeOwnWrite(21);
    expect(service.isReplacementSafeAt(20, 21)).toBe(true);
  });

  it('is safe exactly at the established frontier', () => {
    service.establishFrontier(10);
    expect(service.isSaveSafeAt(10)).toBe(true);
    expect(service.isSaveSafeAt(11)).toBe(false);
    expect(service.isSaveSafeAt(9)).toBe(false);
  });

  it('advances contiguously through own writes', () => {
    service.establishFrontier(10);
    service.observeOwnWrite(11);
    service.observeOwnWrite(12);
    expect(service.isSaveSafeAt(12)).toBe(true);
  });

  it('ignores re-observed (idempotent) seqs at or below the frontier', () => {
    service.establishFrontier(10);
    service.observeOwnWrite(10);
    service.observeOwnWrite(5);
    expect(service.isSaveSafeAt(10)).toBe(true);
  });

  it('detects a foreign interleave when an own write skips a seq — and stays diverged even though the scalars align again', () => {
    service.establishFrontier(4);
    // Another tab took seq 5; our own append returned 6.
    service.observeOwnWrite(6);
    // Global max now equals what we last wrote — the unsound scalar check
    // would pass here and bake an anchor past the unapplied foreign op 5.
    expect(service.isSaveSafeAt(6)).toBe(false);
  });

  it('stays diverged across further contiguous own writes', () => {
    service.establishFrontier(4);
    service.observeOwnWrite(6);
    service.observeOwnWrite(7);
    expect(service.isSaveSafeAt(7)).toBe(false);
  });

  it('clears divergence on the next establish (re-hydration / baseline install)', () => {
    service.establishFrontier(4);
    service.observeOwnWrite(6);
    service.establishFrontier(6);
    expect(service.isSaveSafeAt(6)).toBe(true);
  });

  it('falls back to default-open after a reset (ops wipe)', () => {
    service.establishFrontier(4);
    service.observeOwnWrite(6);
    service.resetToUnestablished();
    expect(service.isSaveSafeAt(0)).toBe(true);
  });

  it('is unsafe when the global max moved past the frontier without any own write (pure foreign append)', () => {
    service.establishFrontier(10);
    expect(service.isSaveSafeAt(12)).toBe(false);
  });

  it('treats establishFrontier(0) as a reset — ops wipes keep the seq generator, so the next seq is unknowable', () => {
    service.establishFrontier(0);
    // Post-wipe first append continues from the preserved generator (e.g. 4);
    // that must NOT read as a foreign gap.
    service.observeOwnWrite(4);
    expect(service.hasKnownForeignWrites()).toBe(false);
    expect(service.isSaveSafeAt(4)).toBe(true);
  });

  it('establishFrontier(0) also clears an earlier sticky divergence back to default-open', () => {
    service.establishFrontier(4);
    service.observeOwnWrite(6);
    expect(service.hasKnownForeignWrites()).toBe(true);
    service.establishFrontier(0);
    expect(service.hasKnownForeignWrites()).toBe(false);
    expect(service.isSaveSafeAt(99)).toBe(true);
  });

  it('exposes sticky divergence for pre-lock fast-paths', () => {
    service.establishFrontier(4);
    expect(service.hasKnownForeignWrites()).toBe(false);
    service.observeOwnWrite(6);
    expect(service.hasKnownForeignWrites()).toBe(true);
  });
});
