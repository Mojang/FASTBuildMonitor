// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect, test } from 'vitest';
import { getCoreRows, getWorkerSummary } from '../src/monitor_panel/coreRows';
import { BuildJobStatus } from '../src/monitor_panel/types';
import type { BuildJob, BuildSession } from '../src/monitor_panel/types';

function job(hostName: string, startTime: number, endTime?: number): BuildJob {
    return {
        hostName, startTime, endTime, eventName: `${hostName}-${startTime}`,
        status: endTime === undefined ? BuildJobStatus.Building : BuildJobStatus.Success,
    };
}

function session(jobs: BuildJob[], endTime?: number): BuildSession {
    return { processId: 1, logVersion: 1, startTime: 0, progress: 0, jobs, endTime };
}

test('no session or an empty build has zero workers and cores', () => {
    const expected = { workerCount: 0, remoteCores: 0, localCores: 0 };
    expect(getWorkerSummary(getCoreRows())).toStrictEqual(expected);
    expect(getWorkerSummary(getCoreRows(session([])))).toStrictEqual(expected);
});

test('local jobs do not count as remote workers and adjacent jobs reuse a core', () => {
    const rows = getCoreRows(session([
        job('LOCAL', 10, 20), job('local', 0, 10), job('Local', 5, 15),
    ]));
    expect(getWorkerSummary(rows)).toStrictEqual({ workerCount: 0, remoteCores: 0, localCores: 2 });
    expect(rows[0].jobs.map(j => j.startTime)).toStrictEqual([0, 10]);
});

test('remote core counts sum per-host peaks, not simultaneous global activity', () => {
    const build = session([
        job('worker-b', 20, 30), job('worker-a', 0, 10),
        job('WORKER-A', 5, 15), job('worker-b', 21, 31), job('worker-b', 22, 32),
    ], 32);
    const originalOrder = [...build.jobs];
    const rows = getCoreRows(build);
    expect(getWorkerSummary(rows)).toStrictEqual({ workerCount: 2, remoteCores: 5, localCores: 0 });
    expect(build.jobs).toStrictEqual(originalOrder);
    expect(rows.map(r => r.coreIndex)).toStrictEqual([0, 1, 0, 1, 2]);
    expect(rows.map(r => r.hostName)).toStrictEqual([
        'worker-a', 'worker-a', 'worker-b', 'worker-b', 'worker-b',
    ]);
});

test('active jobs occupy separate cores and completed builds retain peak counts', () => {
    const build = session([job('local', 0), job('worker', 1), job('WORKER', 2)]);
    const expected = { workerCount: 1, remoteCores: 2, localCores: 1 };
    expect(getWorkerSummary(getCoreRows(build))).toStrictEqual(expected);
    for (const j of build.jobs) {
        j.endTime = 10;
        j.status = BuildJobStatus.Stopped;
    }
    build.endTime = 10;
    expect(getWorkerSummary(getCoreRows(build))).toStrictEqual(expected);
    expect(getWorkerSummary(getCoreRows(session([job('local', 20, 30)])))).toStrictEqual(
        { workerCount: 0, remoteCores: 0, localCores: 1 });
});

test('matches the standalone example: 10 workers, 30 remote cores, 64 local cores', () => {
    const jobs = Array.from({ length: 64 }, () => job('local', 0, 100));
    for (let i = 0; i < 10; i++) {
        jobs.push(...Array.from({ length: 3 }, () => job(`worker-${i}`, 0, 100)));
    }
    const rows = getCoreRows(session(jobs, 100));
    expect(getWorkerSummary(rows)).toStrictEqual({ workerCount: 10, remoteCores: 30, localCores: 64 });
    expect(rows.length).toBe(94);
    expect(rows[0].hostName).toBe('local');
});
