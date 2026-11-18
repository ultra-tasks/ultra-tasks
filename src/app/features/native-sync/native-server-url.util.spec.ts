import { isAcceptableServerUrl, normalizeServerUrl } from './native-server-url.util';

describe('normalizeServerUrl', () => {
  it('accepts HTTPS origins and drops one trailing slash', () => {
    expect(normalizeServerUrl('https://accounts.example.test/')).toBe(
      'https://accounts.example.test',
    );
    expect(normalizeServerUrl('https://accounts.example.test:8443')).toBe(
      'https://accounts.example.test:8443',
    );
  });

  it('accepts HTTP for localhost development only', () => {
    expect(normalizeServerUrl('http://localhost:1900')).toBe('http://localhost:1900');
    expect(normalizeServerUrl('http://127.0.0.1:4245/')).toBe('http://127.0.0.1:4245');
    expect(() => normalizeServerUrl('http://remote.example.test')).toThrowError(
      'NATIVE_SYNC.ERROR_URL',
    );
  });

  it('refuses credentials, query strings, fragments and other schemes', () => {
    for (const value of [
      'https://user:secret@accounts.example.test',
      'https://accounts.example.test/?next=1',
      'https://accounts.example.test/#top',
      'javascript:alert(1)',
      'ftp://accounts.example.test',
    ])
      expect(() => normalizeServerUrl(value)).toThrowError('NATIVE_SYNC.ERROR_URL');
  });

  it('reports text that is not a URL as unacceptable', () => {
    expect(isAcceptableServerUrl('sync example')).toBe(false);
    expect(isAcceptableServerUrl('https://accounts.example.test')).toBe(true);
  });
});
