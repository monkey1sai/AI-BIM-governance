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

    it('reports video readiness when the GFN player is injected after stream startup', async () => {
        const originalSource = StreamConfig.source;
        const onVideoReady = vi.fn();
        const props = { ...makeProps(), onVideoReady };
        const stream = new AppStream(props);
        document.body.innerHTML = '<div id="view"></div>';
        (StreamConfig as { source: string }).source = 'gfn';

        try {
            stream.state = { ...stream.state, streamReady: true };
            stream.componentDidUpdate(props, { ...stream.state, streamReady: false });

            const player = document.createElement('video');
            player.id = 'gfn-stream-player-video';
            vi.spyOn(player, 'play').mockResolvedValue();
            document.getElementById('view')?.appendChild(player);

            await vi.waitFor(() => expect(player.play).toHaveBeenCalledOnce());
            player.dispatchEvent(new Event('loadeddata'));

            expect(onVideoReady).toHaveBeenCalledOnce();
        } finally {
            stream.componentWillUnmount();
            (StreamConfig as { source: string }).source = originalSource;
            document.body.innerHTML = '';
        }
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
        streamer.streamStatus = 2;
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

    it('stops the GFN client SDK before a remounted instance reconnects', async () => {
        const mutableConfig = StreamConfig as { source: string };
        const previousSource = mutableConfig.source;
        const previousGfn = Object.getOwnPropertyDescriptor(globalThis, 'GFN');
        let gfnState = 3;
        const stopGfn = vi.fn(() => { gfnState = 7; });
        mutableConfig.source = 'gfn';
        Object.defineProperty(globalThis, 'GFN', {
            configurable: true,
            value: {
                streamer: {
                    get state() { return gfnState; },
                    stop: stopGfn,
                },
            },
        });
        try {
            const oldStream = new AppStream(makeProps());
            oldStream.componentWillUnmount();

            const props = makeProps();
            const replacement = new AppStream(props);
            await replacement._initStream();

            expect(stopGfn).toHaveBeenCalledOnce();
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

    it('does not call AppStreamer terminate when the singleton is already idle', async () => {
        streamer.streamStatus = 0;
        const oldStream = new AppStream(makeProps());
        oldStream.componentWillUnmount();

        const props = makeProps();
        const replacement = new AppStream(props);
        replacement.componentDidMount();
        await Promise.resolve();
        await Promise.resolve();

        expect(streamer.terminate).not.toHaveBeenCalled();
        expect(streamer.connect).toHaveBeenCalledOnce();
        expect(props.onStreamFailed).not.toHaveBeenCalled();
        replacement.componentWillUnmount();
    });

    it('fails closed when physical streamer teardown fulfills with error', async () => {
        streamer.streamStatus = 2;
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
        streamer.streamStatus = 2;
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
        streamer.streamStatus = 2;
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

        streamer.streamStatus = 0;
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

// #624 exactly-once 緩解：_onCustomEvent 是 gfn / local / stream 三種 source 共用的
// 單一咽喉點，去重放在這裡讓所有下游（stage_loading / stage_management 回應、
// commandRejected 等）一體受惠。
describe('AppStream Kit runtime response dedup (#624)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    function rejectionEvent(requestId: string) {
        return {
            event_type: 'commandRejected',
            payload: {
                request_id: requestId,
                rejected_event_type: 'openStageRequest',
                reason: 'lease_invalid',
                retryable: true,
                runtime_state: 'unchanged',
            },
        };
    }

    it('drops a duplicate (event_type, request_id) response and logs it once', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const props = makeProps();
        const stream = new AppStream(props);

        stream._onCustomEvent(rejectionEvent('req_dup_001'));
        stream._onCustomEvent(rejectionEvent('req_dup_001'));

        expect(props.handleCustomEvent).toHaveBeenCalledOnce();
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy).toHaveBeenCalledWith(
            'AppStream dropped duplicate Kit runtime response',
            { event_type: 'commandRejected', request_id: 'req_dup_001' },
        );
    });

    it('forwards distinct request_ids untouched', () => {
        const props = makeProps();
        const stream = new AppStream(props);

        stream._onCustomEvent(rejectionEvent('req_a'));
        stream._onCustomEvent(rejectionEvent('req_b'));

        expect(props.handleCustomEvent).toHaveBeenCalledTimes(2);
    });

    it('never suppresses events without a request_id', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const props = makeProps();
        const stream = new AppStream(props);
        const selectionChanged = {
            event_type: 'stageSelectionChanged',
            payload: { prim_paths: ['/World/A'] },
        };

        stream._onCustomEvent(selectionChanged);
        stream._onCustomEvent(selectionChanged);
        stream._onCustomEvent(null);

        expect(props.handleCustomEvent).toHaveBeenCalledTimes(3);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('dedupes the wrapped messageRecipient/data wire shape too', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const props = makeProps();
        const stream = new AppStream(props);
        const wrapped = {
            messageRecipient: 'kit',
            data: JSON.stringify({
                event_type: 'openedStageResult',
                payload: { request_id: 'req_wrapped_001', result: 'success' },
            }),
        };

        stream._onCustomEvent(wrapped);
        stream._onCustomEvent(wrapped);

        expect(props.handleCustomEvent).toHaveBeenCalledOnce();
    });

    it('forwards the same key again after the dedup window elapses', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-20T00:00:00.000Z'));
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const props = makeProps();
        const stream = new AppStream(props);

        stream._onCustomEvent(rejectionEvent('req_window_001'));
        stream._onCustomEvent(rejectionEvent('req_window_001'));
        expect(props.handleCustomEvent).toHaveBeenCalledOnce();

        vi.advanceTimersByTime(60_000);
        stream._onCustomEvent(rejectionEvent('req_window_001'));

        expect(props.handleCustomEvent).toHaveBeenCalledTimes(2);
    });

    it('keeps dedup memory per mounted instance so a remount fails open', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const firstProps = makeProps();
        const first = new AppStream(firstProps);
        first._onCustomEvent(rejectionEvent('req_remount_001'));
        first._onCustomEvent(rejectionEvent('req_remount_001'));
        expect(firstProps.handleCustomEvent).toHaveBeenCalledOnce();

        const remountProps = makeProps();
        const remounted = new AppStream(remountProps);
        remounted._onCustomEvent(rejectionEvent('req_remount_001'));

        expect(remountProps.handleCustomEvent).toHaveBeenCalledOnce();
    });
});
