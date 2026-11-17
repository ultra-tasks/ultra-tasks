import { keepCentered } from './keep-centered.util';
import { fakeAsync, tick } from '@angular/core/testing';

describe('keepCentered', () => {
  let container: HTMLElement;
  let rows: HTMLElement[];
  let stop: (() => void) | undefined;

  const centeredTopOf = (el: HTMLElement) => (): number | null => {
    if (!el.isConnected) {
      return null;
    }
    const containerCenterOffset = container.clientHeight / 2;
    const elementCenterOffset = el.offsetHeight / 2;
    return Math.max(el.offsetTop - containerCenterOffset + elementCenterOffset, 0);
  };
  /** How far the middle of `el` is from the middle of the container, in px. */
  const offCenter = (el: HTMLElement): number => {
    const rect = el.getBoundingClientRect();
    const containerHalf = container.clientHeight / 2;
    const elHalf = rect.height / 2;
    const containerMid = container.getBoundingClientRect().top + containerHalf;
    const elMid = rect.top + elHalf;
    return Math.abs(elMid - containerMid);
  };

  beforeEach(() => {
    container = document.createElement('div');
    container.style.cssText =
      'position:relative;height:200px;overflow-y:auto;width:200px;scroll-behavior:auto;overflow-anchor:none;';
    rows = Array.from({ length: 100 }, () => {
      const row = document.createElement('div');
      row.style.height = '40px';
      container.appendChild(row);
      return row;
    });
    document.body.appendChild(container);
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    container.remove();
  });

  it('re-centres a row that moved after the first jump', fakeAsync(() => {
    const target = rows[80];
    // The first jump, from estimated heights
    container.scrollTop = centeredTopOf(target)() as number;
    // Rows above it then render at their real, taller height
    rows.slice(40, 70).forEach((row) => (row.style.height = '60px'));
    expect(offCenter(target)).toBeGreaterThan(100);

    stop = keepCentered(container, centeredTopOf(target));
    tick(250);

    expect(offCenter(target)).toBeLessThanOrEqual(1);
  }));

  it('follows rows that keep changing over several frames', fakeAsync(() => {
    const target = rows[70];
    container.scrollTop = centeredTopOf(target)() as number;
    stop = keepCentered(container, centeredTopOf(target));
    for (let i = 0; i < 4; i++) {
      const rowIndex = 10 * (i + 1);
      rows[rowIndex].style.height = '90px';
      tick(40);
    }
    tick(200);

    expect(offCenter(target)).toBeLessThanOrEqual(1);
  }));

  it('stops when the element is gone', fakeAsync(() => {
    const target = rows[50];
    const getTop = jasmine.createSpy('getTop').and.callFake(centeredTopOf(target));
    stop = keepCentered(container, getTop);
    tick(50);
    target.remove();
    const calls = getTop.calls.count();
    tick(100);

    // one more frame found it gone; after that nothing ran
    expect(getTop.calls.count()).toBeLessThanOrEqual(calls + 1);
  }));

  it('stops after the frame budget even when the position never settles', fakeAsync(() => {
    const getTop = jasmine.createSpy('getTop').and.returnValue(1_000_000);
    stop = keepCentered(container, getTop, 5);
    tick(250);

    expect(getTop.calls.count()).toBe(5);
  }));

  it('can be cancelled', fakeAsync(() => {
    const getTop = jasmine.createSpy('getTop').and.returnValue(1_000_000);
    stop = keepCentered(container, getTop);
    stop();
    tick(100);

    expect(getTop).not.toHaveBeenCalled();
  }));
});
