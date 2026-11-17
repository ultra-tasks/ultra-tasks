import { recordSearchNavDebug } from './search-nav-debug';

describe('recordSearchNavDebug', () => {
  const FLAG = 'SP_SEARCH_NAV_DEBUG';

  afterEach(() => {
    localStorage.removeItem(FLAG);
    delete (window as Window & { __spSearchNavDebug?: unknown }).__spSearchNavDebug;
  });

  it('does not build a lazy payload while the debug flag is off', () => {
    const payload = jasmine.createSpy('payload').and.returnValue({ height: 1 });

    recordSearchNavDebug('test:off', payload);

    expect(payload).not.toHaveBeenCalled();
    expect(
      (window as Window & { __spSearchNavDebug?: unknown }).__spSearchNavDebug,
    ).toBeUndefined();
  });

  it('builds and records a lazy payload when the flag is on', () => {
    localStorage.setItem(FLAG, '1');
    const payload = jasmine.createSpy('payload').and.returnValue({ height: 42 });

    recordSearchNavDebug('test:on', payload);

    expect(payload).toHaveBeenCalledTimes(1);
    const entries = (
      window as Window & { __spSearchNavDebug?: { event: string; height: number }[] }
    ).__spSearchNavDebug;
    expect(entries?.at(-1)).toEqual(
      jasmine.objectContaining({ event: 'test:on', height: 42 }),
    );
  });

  it('still records a plain object payload when the flag is on', () => {
    localStorage.setItem(FLAG, '1');

    recordSearchNavDebug('test:object', { taskId: 'a' });

    const entries = (
      window as Window & { __spSearchNavDebug?: { event: string; taskId: string }[] }
    ).__spSearchNavDebug;
    expect(entries?.at(-1)).toEqual(
      jasmine.objectContaining({ event: 'test:object', taskId: 'a' }),
    );
  });
});
