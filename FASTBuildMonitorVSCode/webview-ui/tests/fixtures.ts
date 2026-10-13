// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BuildJobStatus, type BuildJob, type BuildSession, type MonitorSnapshot } from '../src/monitor_panel/types';

export function job(overrides: Partial<BuildJob> = {}): BuildJob {
    return {
        hostName: 'local', eventName: 'src/file.cpp', startTime: 1000,
        endTime: 3000, status: BuildJobStatus.Success, ...overrides,
    };
}

export function session(overrides: Partial<BuildSession> = {}): BuildSession {
    return {
        processId: 42, logVersion: 1, startTime: 1000, endTime: 11000,
        progress: 100, jobs: [job()], ...overrides,
    };
}

export function snapshot(overrides: Partial<MonitorSnapshot> = {}): MonitorSnapshot {
    return { isMonitoring: false, logPath: '', workers: [], ...overrides };
}
