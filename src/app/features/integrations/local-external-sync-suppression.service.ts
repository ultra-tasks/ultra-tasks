import { Injectable } from '@angular/core';

/** Local-only intent metadata; replayed actions never trigger provider effects. */
@Injectable({ providedIn: 'root' })
export class LocalExternalSyncSuppressionService {
  private readonly _suppressed = new WeakSet<object>();

  suppress(action: object): void {
    this._suppressed.add(action);
  }

  isSuppressed(action: object): boolean {
    return this._suppressed.has(action);
  }
}
