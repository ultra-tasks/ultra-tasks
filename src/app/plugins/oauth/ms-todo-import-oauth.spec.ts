import { buildMsTodoOAuthConfig, isMsTodoOAuthAvailable } from './ms-todo-import-oauth';

describe('Microsoft To Do importer registration', () => {
  it('does not construct a sign-in without a valid public application id', () => {
    expect(buildMsTodoOAuthConfig()).toBeUndefined();
    expect(buildMsTodoOAuthConfig('invalid')).toBeUndefined();
  });

  it('uses fixed Microsoft endpoints and only delegated Tasks.Read', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(buildMsTodoOAuthConfig(id)).toEqual({
      authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      clientId: id,
      webClientId: id,
      scopes: ['Tasks.Read'],
      extraAuthParams: { prompt: 'select_account' },
    });
  });

  it('allows desktop and the exact TLS or local registered origin, not native/preview', () => {
    expect(isMsTodoOAuthAvailable(true, false, 'file://')).toBeTrue();
    expect(
      isMsTodoOAuthAvailable(false, false, 'https://registered.example'),
    ).toBeFalse();
    expect(
      isMsTodoOAuthAvailable(
        false,
        false,
        'https://registered.example',
        'https://registered.example',
      ),
    ).toBeTrue();
    expect(
      isMsTodoOAuthAvailable(
        false,
        false,
        'https://preview.example',
        'https://registered.example',
      ),
    ).toBeFalse();
    expect(
      isMsTodoOAuthAvailable(
        false,
        false,
        'http://registered.example',
        'http://registered.example',
      ),
    ).toBeFalse();
    expect(
      isMsTodoOAuthAvailable(
        false,
        false,
        'http://localhost:4242',
        'http://localhost:4242',
      ),
    ).toBeTrue();
    expect(
      isMsTodoOAuthAvailable(
        false,
        true,
        'http://localhost:4242',
        'http://localhost:4242',
      ),
    ).toBeFalse();
  });
});
