import { afterEach, describe, expect, it, vi } from 'vitest';

const streamer = vi.hoisted(() => ({
    connect: vi.fn(() => Promise.resolve({})),
    sendMessage: vi.fn(() => Promise.resolve({})),
    terminate: vi.fn(() => Promise.resolve({
        action: "terminate",
        status: "success",
        info: "stream terminated",
    })),
    streamStatus: 0,
    resize: vi.fn(() => Promise.resolve({})),
}));

vi.mock('./harness/streamer', () => ({
    getStreamer: () => streamer,
}));

import AppStream from './AppStream';
import StreamConfig from '../stream.config.json';

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
        vi.useRealTimers();
        streamer.connect.mockReset().mockResolvedValue({});
        streamer.sendMessage.mockReset().mockResolvedValue({});
        streamer.terminate.mockReset().mockResolvedValue({
            action: "terminate",
            status: "success",
            info: "stream terminated",
        });
        streamer.streamStatus = 0;
        streamer.resize.mockReset().mockResolvedValue({});
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

    it('waits for physical streamer teardown before a remounted instance connects', async () => {
        let releaseTerminate!: () => void;
        streamer.terminate.mockReturnValueOnce(new Promise((resolve) => {
            releaseTerminate = () => resolve({
                action: "terminate",
                status: "success",
                info: "stream terminated",
            });
        }));
        const oldStream = new AppStream(makeProps());
        oldStream.componentWillUnmount();

        const replacement = new AppStream(makeProps());
        replacement.componentDidMount();
        await Promise.resolve();
        expect(streamer.connect).not.toHaveBeenCalled();

        releaseTerminate();
        await Promise.resolve();
        await Promise.resolve();
        expect(streamer.connect).toHaveBeenCalledOnce();

        replacement.componentWillUnmount();
    });

    it('waits for an in-progress SDK teardown until the singleton reports none', async () => {
        vi.useFakeTimers();
        streamer.streamStatus = 3;
        streamer.terminate.mockResolvedValueOnce({
            action: "terminate",
            status: "inProgress",
            info: "stream is still connecting",
        });
        const oldStream = new AppStream(makeProps());
        oldStream.componentWillUnmount();

        const props = makeProps();
        const replacement = new AppStream(props);
        replacement.componentDidMount();
        await Promise.resolve();
        expect(streamer.connect).not.toHaveBeenCalled();
        expect(props.onStreamFailed).not.toHaveBeenCalled();

        streamer.streamStatus = 0;
        await vi.advanceTimersByTimeAsync(25);

        expect(streamer.connect).toHaveBeenCalledOnce();
        expect(props.onStreamFailed).not.toHaveBeenCalled();
        replacement.componentWillUnmount();
    });

    it('fails closed when an in-progress SDK teardown never reaches none before its deadline', async () => {
        vi.useFakeTimers();
        streamer.streamStatus = 3;
        streamer.terminate.mockResolvedValueOnce({
            action: "terminate",
            status: "inProgress",
            info: "stream teardown stalled",
        });
        const oldStream = new AppStream(makeProps());
        oldStream.componentWillUnmount();

        const props = makeProps();
        const replacement = new AppStream(props);
        replacement.componentDidMount();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(5_000);

        expect(streamer.connect).not.toHaveBeenCalled();
        expect(props.onStreamFailed).toHaveBeenCalledOnce();
        replacement.componentWillUnmount();
    });

    it('allows GFN remounts to reconnect without invoking unsupported AppStreamer teardown', async () => {
        const mutableConfig = StreamConfig as { source: string };
        const previousSource = mutableConfig.source;
        const previousGfn = Object.getOwnPropertyDescriptor(globalThis, 'GFN');
        mutableConfig.source = 'gfn';
        Object.defineProperty(globalThis, 'GFN', { configurable: true, value: {} });
        try {
            const oldStream = new AppStream(makeProps());
            oldStream.componentWillUnmount();

            const props = makeProps();
            const replacement = new AppStream(props);
            await replacement._initStream();

            expect(streamer.terminate).not.toHaveBeenCalled();
            expect(streamer.connect).toHaveBeenCalledOnce();
            expect(props.onStreamFailed).not.toHaveBeenCalled();
            replacement.componentWillUnmount();
        } finally {
            mutableConfig.source = previousSource;
            if (previousGfn) Object.defineProperty(globalThis, 'GFN', previousGfn);
            else delete (globalThis as { GFN?: unknown }).GFN;
        }
    });

    it('fails closed when physical streamer teardown fulfills with error', async () => {
        streamer.streamStatus = 0;
        streamer.terminate.mockResolvedValueOnce({
            action: "terminate",
            status: "error",
            info: "stream termination failed",
        });
        const oldStream = new AppStream(makeProps());
        oldStream.componentWillUnmount();

        const props = makeProps();
        const replacement = new AppStream(props);
        replacement.componentDidMount();
        await Promise.resolve();
        await Promise.resolve();

        expect(streamer.connect).not.toHaveBeenCalled();
        expect(props.onStreamFailed).toHaveBeenCalledOnce();

        replacement.componentWillUnmount();
    });

    it('fails closed when physical streamer teardown rejects', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        streamer.streamStatus = 0;
        streamer.terminate.mockRejectedValueOnce(new Error('terminate failed'));
        const oldStream = new AppStream(makeProps());
        oldStream.componentWillUnmount();

        const props = makeProps();
        const replacement = new AppStream(props);
        replacement.componentDidMount();
        await Promise.resolve();
        await Promise.resolve();

        expect(streamer.connect).not.toHaveBeenCalled();
        expect(props.onStreamFailed).toHaveBeenCalledOnce();
        expect(errorSpy).toHaveBeenCalledOnce();

        replacement.componentWillUnmount();
    });

    it('allows a later fresh mount after a failed teardown once the singleton is none', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        streamer.streamStatus = 0;
        streamer.terminate.mockRejectedValueOnce(new Error('terminate failed'));
        const oldStream = new AppStream(makeProps());
        oldStream.componentWillUnmount();

        const failedProps = makeProps();
        const failedReplacement = new AppStream(failedProps);
        failedReplacement.componentDidMount();
        await Promise.resolve();
        await Promise.resolve();

        expect(streamer.connect).not.toHaveBeenCalled();
        expect(failedProps.onStreamFailed).toHaveBeenCalledOnce();
        expect(errorSpy).toHaveBeenCalledOnce();

        const retryProps = makeProps();
        const retry = new AppStream(retryProps);
        retry.componentDidMount();
        await Promise.resolve();
        await Promise.resolve();

        expect(streamer.connect).toHaveBeenCalledOnce();
        expect(retryProps.onStreamFailed).not.toHaveBeenCalled();
        failedReplacement.componentWillUnmount();
        retry.componentWillUnmount();
    });
});
