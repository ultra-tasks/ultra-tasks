import { HttpClient } from '@angular/common/http';
import { PluginLog } from '../../core/log';
import { PluginManifest } from '../plugin-api.model';

export interface BuiltInPluginAssets {
  manifest?: PluginManifest;
  icon?: string;
  error?: unknown;
}

/**
 * Fetch a bundled plugin's manifest and its optional icon. Never rejects: the
 * caller applies the results later, one plugin at a time, and a rejection that
 * nobody awaits yet would surface as an unhandled promise rejection. A failed
 * manifest request comes back as `error` instead.
 */
export const fetchBuiltInPluginAssets = async (
  http: HttpClient,
  path: string,
): Promise<BuiltInPluginAssets> => {
  let manifest: PluginManifest | undefined;
  try {
    manifest = await http.get<PluginManifest>(`${path}/manifest.json`).toPromise();
  } catch (error) {
    return { error };
  }
  if (!manifest) {
    return {};
  }

  const iconUrl = `${path}/${manifest.icon || 'icon.svg'}`;
  try {
    const icon = await http.get(iconUrl, { responseType: 'text' }).toPromise();
    return { manifest, icon: icon || undefined };
  } catch {
    // Icon is optional - silently ignore 404s and other errors
    PluginLog.debug(`Icon not found for plugin ${manifest.id}: ${iconUrl}`);
    return { manifest };
  }
};
