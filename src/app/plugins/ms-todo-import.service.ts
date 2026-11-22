import { inject, Injectable } from '@angular/core';
import { PluginRequestOptions } from '@super-productivity/plugin-api';
import { RawGraphData } from '../../../packages/plugin-dev/ms-todo-import/src/parse/from-graph';
import { loadGraphData } from '../../../packages/plugin-dev/ms-todo-import/src/parse/load-graph-data';
import { MsTodoImportRepeatService } from './ms-todo-import-repeat.service';
import { PluginOAuthBridgeService } from './oauth/plugin-oauth-bridge.service';
import { PluginBridgeService } from './plugin-bridge.service';

@Injectable({ providedIn: 'root' })
export class MsTodoImportService {
  private readonly _oauth = inject(PluginOAuthBridgeService);
  private readonly _bridge = inject(PluginBridgeService);
  private readonly _repeats = inject(MsTodoImportRepeatService);

  async loadData(): Promise<RawGraphData> {
    const accessToken = await this._oauth.authorizeMsTodoImport();
    // No token is saved or returned to the iframe.
    return loadGraphData(
      {
        request: <T>(url: string, options?: PluginRequestOptions) =>
          this._bridge.request<T>(url, options, ['graph.microsoft.com'], ['http']),
      },
      accessToken,
    );
  }

  addRepeat(taskId: unknown, schedule: unknown): Promise<string> {
    return this._repeats.add(taskId, schedule);
  }
}
