import { computed, inject, Injectable, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { from } from 'rxjs';
import { ClientIdService } from '../../core/util/client-id.service';
import { getDeviceLabel } from '../tracking-presence/get-device-label.util';
import { BaseIssueProviderCfg } from './issue.model';

export class IssueConnectionOwnedElsewhereError extends Error {
  readonly isExpectedSyncSkip = true;
}

@Injectable({ providedIn: 'root' })
export class IssueProviderOwnershipService {
  private readonly _client = inject(ClientIdService);
  private readonly _initialId = toSignal(from(this._client.loadClientId()), {
    initialValue: null,
  });
  private readonly _claimedId = signal<string | null>(null);
  readonly clientId = computed(() => this._claimedId() ?? this._initialId());

  isOwner(cfg: Partial<BaseIssueProviderCfg>): boolean {
    return !cfg.integrationOwnerId || cfg.integrationOwnerId === this.clientId();
  }

  async assertOwner(cfg: Partial<BaseIssueProviderCfg>): Promise<void> {
    if (
      cfg.integrationOwnerId &&
      cfg.integrationOwnerId !== (await this._client.loadClientId())
    )
      throw new IssueConnectionOwnedElsewhereError(
        'This connection is managed on another device.',
      );
  }

  async claim(): Promise<
    Pick<BaseIssueProviderCfg, 'integrationOwnerId' | 'integrationOwnerLabel'>
  > {
    const id = await this._client.getOrGenerateClientId();
    this._claimedId.set(id);
    return { integrationOwnerId: id, integrationOwnerLabel: getDeviceLabel() };
  }
}
