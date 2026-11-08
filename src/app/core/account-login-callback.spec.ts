import { ReplaySubject, Subject } from 'rxjs';
import {
  parseAccountLoginCallback,
  type AccountLoginCallback,
} from './account-login-callback';
import { routeCapacitorAppUrl } from './app-url-open-router';
import { type AppUriTaskAction } from '../features/tasks/util/parse-app-uri-task-action';
import { type AppUriQuickAction } from './app-uri-actions/parse-app-uri-quick-action';

describe('account login callback ownership', () => {
  const result = 'a'.repeat(43),
    state = 'b'.repeat(43);
  for (const scheme of ['ultratasks', 'app.ultratasks']) {
    it(
      'routes a cold ' + scheme + ' callback once to its retained account consumer',
      () => {
        const accounts = new ReplaySubject<AccountLoginCallback>(1);
        const oauth = new Subject<string>();
        const received: string[] = [];
        oauth.subscribe((v) => received.push(v));
        expect(
          routeCapacitorAppUrl(
            scheme + '://account-login?result=' + result + '&state=' + state,
            new Subject<AppUriTaskAction>(),
            oauth,
            new Subject<AppUriQuickAction>(),
            accounts,
          ),
        ).toBe('account-login');
        const seen: AccountLoginCallback[] = [];
        accounts.subscribe((v) => seen.push(v));
        expect(seen).toEqual([{ result, state }]);
        expect(received).toEqual([]);
      },
    );
  }
  it('rejects forged routes, duplicate state and URL-carried credentials', () => {
    for (const url of [
      'https://account-login?result=' + result + '&state=' + state,
      'app.ultratasks://account-login.evil?result=' + result + '&state=' + state,
      'app.ultratasks://account-login/extra?result=' + result + '&state=' + state,
      'app.ultratasks://account-login?result=' +
        result +
        '&state=' +
        state +
        '&state=' +
        state,
      'app.ultratasks://account-login?result=' +
        result +
        '&state=' +
        state +
        '&token=secret',
      'app.ultratasks://account-login?result=' + result + '&state=' + state + '#secret',
      'app.ultratasks://account-login?result=short&state=' + state,
    ])
      expect(parseAccountLoginCallback(url)).toBeUndefined();
  });
});
