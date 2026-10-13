// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildMonitorService } from '../../src/buildMonitorService';
import { BuildWatcher } from '../../src/buildWatcher';
import { BuildJobStatus } from '../../src/models';
import { Logger } from '../../src/utilities/logger';

vi.mock('../../src/buildWatcher', async () => {
    const { EventEmitter } = await import('node:events');
    return {
        BuildWatcher: vi.fn(class extends EventEmitter {
            on = super.on.bind(this);
            emit = super.emit.bind(this);
            getLogPath = vi.fn(() => 'build.log');
            getIsRestoringHistory = vi.fn(() => false);
            start = vi.fn();
            stop = vi.fn();
        }),
    };
});

let service: BuildMonitorService;
let watcher: BuildWatcher;
beforeEach(() => {
    service = new BuildMonitorService(Logger.getInstance(), 'build.log');
    watcher = vi.mocked(BuildWatcher).mock.instances[0];
});
afterEach(() => Logger.getInstance().dispose());

function startSession(time = 1000) {
    watcher.emit('sessionStarted', { time, logVersion: 1, processId: 42 });
}
function startJob(hostName = 'local', jobName = 'a.cpp', time = 1100) {
    watcher.emit('jobStarted', { time, hostName, jobName });
}
function finishJob(hostName: string, jobName: string, result: BuildJobStatus, time = 1200) {
    watcher.emit('jobFinished', { time, hostName, jobName, result, message: 'details' });
}

describe('build monitor state', () => {
    it('starts and stops idempotently, forwarding polling and restoration state', () => {
        const changed = vi.fn();
        service.on('stateChanged', changed);
        expect(service.getSnapshot()).toEqual({
            isMonitoring: false, logPath: 'build.log', session: undefined, workers: [],
        });
        expect(service.getLogPath()).toBe('build.log');
        service.stop();
        service.start(250);
        service.start();
        expect(service.isMonitoring()).toBe(true);
        expect(watcher.start).toHaveBeenCalledExactlyOnceWith(250);
        service.stop();
        service.stop();
        expect(service.isMonitoring()).toBe(false);
        expect(watcher.stop).toHaveBeenCalledOnce();
        expect(changed).toHaveBeenCalledTimes(2);
        expect(service.getIsRestoringHistory()).toBe(false);
        vi.mocked(watcher.getIsRestoringHistory).mockReturnValue(true);
        expect(service.getIsRestoringHistory()).toBe(true);
    });

    it('ignores jobs and stops before a session but still forwards progress events', () => {
        const progress = vi.fn();
        service.on('progressChanged', progress);
        startJob();
        finishJob('local', 'a.cpp', BuildJobStatus.Success);
        watcher.emit('sessionStopped', { time: 2000 });
        watcher.emit('progressChanged', { time: 1500, progress: 20 });
        expect(service.getCurrentSession()).toBeUndefined();
        expect(service.getWorkers().size).toBe(0);
        expect(progress).toHaveBeenCalledWith(20);
    });

    it('tracks job identity, case-insensitive hosts and cached/active totals', () => {
        const started = vi.fn();
        const finished = vi.fn();
        const sessionStarted = vi.fn();
        service.on('jobStarted', started);
        service.on('jobFinished', finished);
        service.on('sessionStarted', sessionStarted);
        startSession();
        startJob('Worker-A', 'a.cpp');
        startJob('WORKER-A', 'b.cpp');
        startJob('local', 'c.cpp');
        finishJob('worker-a', 'a.cpp', BuildJobStatus.SuccessCached);
        watcher.emit('progressChanged', { time: 1500, progress: 55.5 });
        expect(service.getCurrentSession()).toMatchObject({ processId: 42, progress: 55.5 });
        expect(sessionStarted).toHaveBeenCalledWith(service.getCurrentSession());
        expect(started).toHaveBeenCalledTimes(3);
        expect(finished).toHaveBeenCalledWith(expect.objectContaining({
            eventName: 'a.cpp', endTime: 1200, status: BuildJobStatus.SuccessCached, message: 'details',
        }));
        expect(service.getSnapshot().workers).toEqual([
            { hostName: 'Worker-A', activeJobs: 1, totalJobs: 2, cachedJobs: 1 },
            { hostName: 'local', activeJobs: 1, totalJobs: 1, cachedJobs: 0 },
        ]);
        expect(service.getWorkers().get('worker-a')?.jobs[0]).toBe(service.getCurrentSession()?.jobs[0]);
        expect(JSON.parse(JSON.stringify(service.getSnapshot())).workers).toHaveLength(2);
    });

    it('finishes the most recent matching active job and ignores unmatched completions', () => {
        startSession();
        startJob('worker', 'same.cpp', 1100);
        startJob('worker', 'same.cpp', 1150);
        startJob('different', 'same.cpp', 1170);
        finishJob('WORKER', 'same.cpp', BuildJobStatus.Error);
        const jobs = service.getCurrentSession()!.jobs;
        expect(jobs.map(j => j.status)).toEqual([
            BuildJobStatus.Building, BuildJobStatus.Error, BuildJobStatus.Building,
        ]);
        finishJob('worker', 'missing.cpp', BuildJobStatus.Success);
        finishJob('worker', 'same.cpp', BuildJobStatus.Success);
        finishJob('worker', 'same.cpp', BuildJobStatus.Failed);
        expect(jobs[0].status).toBe(BuildJobStatus.Success);
        expect(jobs[1].status).toBe(BuildJobStatus.Error);
        expect(jobs[2].status).toBe(BuildJobStatus.Building);
    });

    it('stops unfinished jobs, preserves finished jobs and keeps prior session history', () => {
        const stopped = vi.fn();
        service.on('sessionStopped', stopped);
        startSession();
        startJob('local', 'completed');
        finishJob('local', 'completed', BuildJobStatus.Success);
        startJob('remote', 'active');
        watcher.emit('sessionStopped', { time: 2000 });
        const previous = service.getCurrentSession()!;
        expect(previous).toMatchObject({ endTime: 2000, progress: 100 });
        expect(previous.jobs[0]).toMatchObject({ status: BuildJobStatus.Success, endTime: 1200 });
        expect(previous.jobs[1]).toMatchObject({ status: BuildJobStatus.Stopped, endTime: 2000 });
        expect(stopped).toHaveBeenCalledWith(previous);
        startJob('local', 'late job', 2100);
        expect(previous.endTime).toBeUndefined();
        startSession(3000);
        expect(service.getSessions()).toEqual([previous, service.getCurrentSession()]);
        expect(service.getCurrentSession()?.jobs).toEqual([]);
        expect(service.getWorkers().size).toBe(0);
        expect(service.getCurrentSession()?.progress).toBe(0);
    });
});
