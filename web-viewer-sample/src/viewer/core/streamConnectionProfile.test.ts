import { describe, expect, it, vi } from 'vitest';
import { buildGfnStreamConfig, buildLocalStreamConfig, buildRemoteStreamConfig, type StreamConnectionInputs } from './streamConnectionProfile';

function fixture() {
    const inputs: StreamConnectionInputs = {
        sessionId: 'session-test', backendUrl: 'https://backend.example',
        signalingserver: 'signal.example', signalingport: 443,
        mediaserver: 'media.example', mediaport: 49101, accessToken: 'fixture-token',
    };
    const defaults = { server: 'default.example', signalingPort: 49100 };
    const callbacks = {
        onUpdate: vi.fn(), onStart: vi.fn(), onStreamStats: vi.fn(),
        onCustomEvent: vi.fn(), onStop: vi.fn(), onTerminate: vi.fn(),
    };
    return { inputs, defaults, callbacks };
}

describe('stream connection profiles', () => {
    it('preserves the complete local config and callback identities', () => {
        const f = fixture();
        const config = buildLocalStreamConfig(f.inputs, f.defaults, f.callbacks);
        expect(config).toEqual({
            videoElementId: 'remote-video', audioElementId: 'remote-audio',
            server: 'signal.example', authenticate: true, accessToken: 'fixture-token',
            maxReconnects: 20, signalingServer: 'signal.example', signalingPort: 443,
            mediaServer: 'media.example', mediaPort: 49101, nativeTouchEvents: true,
            ...f.callbacks,
        });
        for (const key of Object.keys(f.callbacks) as Array<keyof typeof f.callbacks>) {
            expect(config[key]).toBe(f.callbacks[key]);
            expect(f.callbacks[key]).not.toHaveBeenCalled();
        }
    });

    it.each([undefined, 0])('omits local mediaPort for %s and preserves local fallback/token omission', mediaport => {
        const f = fixture();
        Object.assign(f.inputs, { signalingserver: '', signalingport: 0, mediaserver: '', accessToken: '', mediaport });
        const config = buildLocalStreamConfig(f.inputs, f.defaults, f.callbacks);
        expect(config).toEqual({
            videoElementId: 'remote-video', audioElementId: 'remote-audio',
            server: 'default.example', authenticate: false, maxReconnects: 20,
            signalingServer: 'default.example', signalingPort: 49100, mediaServer: 'default.example',
            nativeTouchEvents: true, ...f.callbacks,
        });
        expect(Object.prototype.hasOwnProperty.call(config, 'mediaPort')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(config, 'accessToken')).toBe(false);
    });

    it('preserves the complete remote profile without local authentication or stats', () => {
        const f = fixture();
        const config = buildRemoteStreamConfig(f.inputs, f.callbacks);
        expect(config).toEqual({
            signalingServer: 'signal.example', signalingPort: 443, mediaServer: 'media.example',
            mediaPort: 49101, backendUrl: 'https://backend.example', sessionId: 'session-test',
            autoLaunch: true, cursor: 'free', mic: false,
            videoElementId: 'remote-video', audioElementId: 'remote-audio',
            authenticate: false, maxReconnects: 20, nativeTouchEvents: true,
            width: 1920, height: 1080, fps: 60,
            onUpdate: f.callbacks.onUpdate, onStart: f.callbacks.onStart,
            onCustomEvent: f.callbacks.onCustomEvent, onStop: f.callbacks.onStop,
            onTerminate: f.callbacks.onTerminate,
        });
        expect(Object.prototype.hasOwnProperty.call(config, 'onStreamStats')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(config, 'accessToken')).toBe(false);
    });

    it.each([undefined, 0])('omits remote mediaPort for %s without adding fallback endpoints', mediaport => {
        const f = fixture();
        Object.assign(f.inputs, { signalingserver: '', signalingport: 0, mediaserver: '', mediaport });
        const config = buildRemoteStreamConfig(f.inputs, f.callbacks);
        expect(config.signalingServer).toBe('');
        expect(config.signalingPort).toBe(0);
        expect(config.mediaServer).toBe('');
        expect(Object.prototype.hasOwnProperty.call(config, 'mediaPort')).toBe(false);
    });

    it('preserves the complete GFN profile and leaves callbacks/global untouched', () => {
        const f = fixture();
        const global = Object.freeze({ fixture: true });
        const defaults = Object.freeze({ catalogClientId: 'catalog-test', clientId: 'client-test', cmsId: 7 });
        const config = buildGfnStreamConfig(global, defaults, f.callbacks);
        expect(config).toEqual({
            GFN: global, ...defaults,
            onUpdate: f.callbacks.onUpdate, onStart: f.callbacks.onStart,
            onCustomEvent: f.callbacks.onCustomEvent,
        });
        expect(config.GFN).toBe(global);
        for (const callback of Object.values(f.callbacks)) expect(callback).not.toHaveBeenCalled();
    });

    it('does not mutate inputs or share generated config objects', () => {
        const f = fixture();
        Object.freeze(f.inputs); Object.freeze(f.defaults); Object.freeze(f.callbacks);
        const first = buildLocalStreamConfig(f.inputs, f.defaults, f.callbacks);
        const second = buildLocalStreamConfig(f.inputs, f.defaults, f.callbacks);
        expect(first).not.toBe(second);
        first.signalingPort = 123;
        expect(second.signalingPort).toBe(443);
        expect(f.inputs.signalingport).toBe(443);
    });
});
