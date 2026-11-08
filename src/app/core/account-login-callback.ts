import { ReplaySubject } from 'rxjs';

export interface AccountLoginCallback {
  result: string;
  state: string;
}
export const pendingAccountLoginCallback$ = new ReplaySubject<AccountLoginCallback>(1);
export const parseAccountLoginCallback = (
  raw: string,
): AccountLoginCallback | undefined => {
  try {
    const url = new URL(raw);
    if (
      !['ultratasks:', 'app.ultratasks:'].includes(url.protocol) ||
      url.hostname.toLowerCase() !== 'account-login' ||
      !['', '/'].includes(url.pathname) ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      [...url.searchParams.keys()].sort().join(',') !== 'result,state'
    )
      return;
    const result = url.searchParams.get('result')!;
    const state = url.searchParams.get('state')!;
    if (!/^[A-Za-z0-9_-]{43}$/.test(result) || !/^[A-Za-z0-9_-]{43}$/.test(state)) return;
    return { result, state };
  } catch {
    return;
  }
};
