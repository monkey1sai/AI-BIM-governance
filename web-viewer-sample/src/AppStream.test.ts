import { afterEach, describe, expect, it, vi } from 'vitest';

import AppStream from './AppStream';

function makeProps(onLoggedIn = vi.fn()) {
    return {
        sessionId: 'session-1',
        backendUrl: 'http://127.0.0.1:8004',
        signalingserver: '127.0.0.1',
        signalingport: 49100,
        mediaserver: '127.0.0.1',
        mediaport: 49101,
        accessToken: 'test-token',
        onStarted: vi.fn(),
        onStreamFailed: vi.fn(),
        onLoggedIn,
        handleCustomEvent: vi.fn(),
        onFocus: vi.fn(),
        onBlur: vi.fn(),
    };
}

describe('AppStream auth updates', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('forwards a string user id after successful authentication', () => {
        const onLoggedIn = vi.fn();
        const stream = new AppStream(makeProps(onLoggedIn));

        stream._onUpdate({
            action: 'authUser',
            status: 'success',
            info: 'operator-1',
        } as Parameters<AppStream['_onUpdate']>[0]);

        expect(onLoggedIn).toHaveBeenCalledOnce();
        expect(onLoggedIn).toHaveBeenCalledWith('operator-1');
    });

    it('reports a non-string success payload without leaking its contents', () => {
        const onLoggedIn = vi.fn();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const stream = new AppStream(makeProps(onLoggedIn));

        stream._onUpdate({
            action: 'authUser',
            status: 'success',
            info: new TypeError('sensitive-auth-detail'),
        } as Parameters<AppStream['_onUpdate']>[0]);

        expect(onLoggedIn).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledOnce();
        expect(errorSpy).toHaveBeenCalledWith('AppStream authUser success ignored: info must be a string');
        expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('sensitive-auth-detail');
    });

    it('reports callback failures without logging the auth payload', () => {
        const onLoggedIn = vi.fn(() => {
            throw new Error('callback-sensitive-detail');
        });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const stream = new AppStream(makeProps(onLoggedIn));

        stream._onUpdate({
            action: 'authUser',
            status: 'success',
            info: 'operator-sensitive-id',
        } as Parameters<AppStream['_onUpdate']>[0]);

        expect(onLoggedIn).toHaveBeenCalledOnce();
        expect(errorSpy).toHaveBeenCalledOnce();
        expect(errorSpy).toHaveBeenCalledWith('AppStream authUser callback failed');
        expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('operator-sensitive-id');
        expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('callback-sensitive-detail');
    });
});
