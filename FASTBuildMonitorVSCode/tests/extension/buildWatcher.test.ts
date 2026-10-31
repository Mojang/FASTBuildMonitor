// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildWatcher } from '../../src/buildWatcher';
import { LogWatcher } from '../../src/logWatcher';
import { BuildJobStatus } from '../../src/models';

vi.mock('../../src/logWatcher', async () => {
    const { EventEmitter } = await import('node:events');
    return {
        LogWatcher: vi.fn(class extends EventEmitter {
            on = super.on.bind(this);
            emit = super.emit.bind(this);
            getLogPath = vi.fn(() => 'build.log');
            getIsRestoringHistory = vi.fn(() => false);
            start = vi.fn();
            stop = vi.fn();
        }),
    };
});

const timestamp = 1700000000123;
const filetime = (BigInt(timestamp) * 10000n + 116444736000000000n).toString();
let watcher: BuildWatcher;
let log: LogWatcher;

beforeEach(() => {
    watcher = new BuildWatcher('build.log');
    log = vi.mocked(LogWatcher).mock.instances[0];
});

describe('FASTBuild log parser', () => {
    it('delegates polling, paths and restoration state', () => {
        expect(LogWatcher).toHaveBeenCalledWith('build.log');
        watcher.start(250);
        watcher.stop();
        expect(log.start).toHaveBeenCalledWith(250);
        expect(log.stop).toHaveBeenCalledOnce();
        expect(watcher.getLogPath()).toBe('build.log');
        expect(watcher.getIsRestoringHistory()).toBe(false);
        vi.mocked(log.getIsRestoringHistory).mockReturnValue(true);
        expect(watcher.getIsRestoringHistory()).toBe(true);
    });

    it('forwards history events and ignores resets', () => {
        const started = vi.fn();
        const ended = vi.fn();
        watcher.on('historyRestorationStarted', started);
        watcher.on('historyRestorationEnded', ended);
        log.emit('historyRestorationStarted');
        log.emit('historyRestorationEnded');
        log.emit('logReset');
        expect(started).toHaveBeenCalledOnce();
        expect(ended).toHaveBeenCalledOnce();
    });

    it.each([
        ['START_BUILD 3 42', 'sessionStarted', { logVersion: 3, processId: 42 }],
        ['STOP_BUILD', 'sessionStopped', {}],
        ['START_JOB worker "C:\\build path\\file.cpp"', 'jobStarted', { hostName: 'worker', jobName: 'C:\\build path\\file.cpp' }],
        ['PROGRESS_STATUS 42.75', 'progressChanged', { progress: 42.75 }],
        ['GRAPH "CPU group" usage percent 17.5', 'counterReported', { groupName: 'CPU group', counterName: 'usage', unitTag: 'percent', value: 17.5 }],
        ['DISTRIBUTION_UNAVAILABLE "None of the 2 workers in the pool accepted a connection"', 'distributionUnavailable', { reason: 'None of the 2 workers in the pool accepted a connection' }],
    ])('parses %s', (line, event, expected) => {
        const listener = vi.fn();
        watcher.on(event, listener);
        log.emit('logReceived', `${filetime} ${line}`);
        expect(listener).toHaveBeenCalledExactlyOnceWith({ time: timestamp, ...expected });
        expect(watcher.getLastMessageTime()).toBe(timestamp);
    });

    it.each([
        ['FAILED', BuildJobStatus.Failed], ['ERROR', BuildJobStatus.Error],
        ['SUCCESS', BuildJobStatus.Success], ['SUCCESS_COMPLETE', BuildJobStatus.Success],
        ['SUCCESS_CACHED', BuildJobStatus.SuccessCached],
        ['SUCCESS_PREPROCESSED', BuildJobStatus.SuccessPreprocessed],
        ['TIMEOUT', BuildJobStatus.Timeout], ['UNKNOWN', BuildJobStatus.Error],
    ])('maps %s job results and preserves quoted messages', (result, status) => {
        const listener = vi.fn();
        watcher.on('jobFinished', listener);
        log.emit('logReceived', `${filetime} FINISH_JOB ${result} local "a b.obj" "compiler message with spaces"`);
        expect(listener).toHaveBeenCalledExactlyOnceWith({
            time: timestamp, result: status, hostName: 'local',
            jobName: 'a b.obj', message: 'compiler message with spaces',
        });
    });

    it('accepts finish events without an optional message', () => {
        const listener = vi.fn();
        watcher.on('jobFinished', listener);
        log.emit('logReceived', `${filetime} FINISH_JOB SUCCESS local output.obj`);
        expect(listener.mock.calls[0][0]).toEqual({
            time: timestamp, result: BuildJobStatus.Success, hostName: 'local',
            jobName: 'output.obj', message: undefined,
        });

    });

    it('decodes FASTBuild output line separators before publishing diagnostics', () => {
        const listener = vi.fn();
        watcher.on('jobFinished', listener);
        log.emit('logReceived', `${filetime} FINISH_JOB FAILED local file.obj "file.cpp(42,7): error C100\f  source text\fother.h(8): note: declared here"`);
        expect(listener.mock.calls[0][0].message).toBe(
            'file.cpp(42,7): error C100\n  source text\nother.h(8): note: declared here',
        );
    });

    it('decodes line separators in distribution problems and accepts a missing reason', () => {
        const listener = vi.fn();
        watcher.on('distributionUnavailable', listener);
        log.emit('logReceived', `${filetime} DISTRIBUTION_UNAVAILABLE "first\fsecond"`);
        log.emit('logReceived', `${filetime} DISTRIBUTION_UNAVAILABLE`);
        expect(listener.mock.calls.map(([event]) => event)).toEqual([
            { time: timestamp, reason: 'first\nsecond' },
            { time: timestamp, reason: '' },
        ]);
    });

    it('ignores empty, unknown, and invalid timestamp records without advancing time', () => {
        const listener = vi.fn();
        watcher.on('sessionStopped', listener);
        for (const line of ['', 'one-token', `${filetime} UNKNOWN`, 'not-a-time STOP_BUILD']) {
            log.emit('logReceived', line);
        }
        expect(listener).not.toHaveBeenCalled();
        expect(watcher.getLastMessageTime()).toBe(0);
        log.emit('logReceived', `${filetime} STOP_BUILD`);
        expect(listener).toHaveBeenCalledOnce();
    });
});
