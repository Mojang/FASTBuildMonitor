// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export enum BuildJobStatus {
    Building = 'Building',
    Success = 'Success',
    SuccessCached = 'SuccessCached',
    SuccessPreprocessed = 'SuccessPreprocessed',
    Failed = 'Failed',
    Error = 'Error',
    Timeout = 'Timeout',
    RacedOut = 'RacedOut',
    Stopped = 'Stopped',
}

export interface BuildJob {
    hostName: string;
    eventName: string;
    startTime: number; // ms timestamp
    endTime?: number;  // ms timestamp
    status: BuildJobStatus;
    message?: string;
}

export interface BuildSession {
    processId: number;
    logVersion: number;
    startTime: number;
    endTime?: number;
    jobs: BuildJob[];
    progress: number;
}

export interface WorkerInfo {
    hostName: string;
    jobs: BuildJob[];
}

export function getJobDisplayName(eventName: string): string {
    const lastSlash = Math.max(eventName.lastIndexOf('/'), eventName.lastIndexOf('\\'));
    return lastSlash >= 0 ? eventName.substring(lastSlash + 1) : eventName;
}

export function getJobDurationMs(job: BuildJob): number {
    return (job.endTime ?? Date.now()) - job.startTime;
}

export function formatDuration(ms: number): string {
    const totalSeconds = ms / 1000;
    if (totalSeconds >= 60) {
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds - m * 60;
        return `${m}:${s.toFixed(1).padStart(4, '0')}`;
    }
    return `${totalSeconds.toFixed(1)}s`;
}

export function getStatusColor(status: BuildJobStatus): string {
    switch (status) {
        case BuildJobStatus.Building: return '#2196F3';
        case BuildJobStatus.Success: return '#4CAF50';
        case BuildJobStatus.SuccessCached: return '#8BC34A';
        case BuildJobStatus.SuccessPreprocessed: return '#CDDC39';
        case BuildJobStatus.Failed: return '#F44336';
        case BuildJobStatus.Error: return '#E91E63';
        case BuildJobStatus.Timeout: return '#FF9800';
        case BuildJobStatus.RacedOut: return '#9E9E9E';
        case BuildJobStatus.Stopped: return '#607D8B';
        default: return '#9E9E9E';
    }
}

// Session aggregate helpers
export function sessionTotalJobs(s: BuildSession): number {
    return s.jobs.length;
}
export function sessionActiveJobs(s: BuildSession): number {
    return s.jobs.filter(j => j.status === BuildJobStatus.Building).length;
}
export function sessionSuccessJobs(s: BuildSession): number {
    return s.jobs.filter(j =>
        j.status === BuildJobStatus.Success ||
        j.status === BuildJobStatus.SuccessCached ||
        j.status === BuildJobStatus.SuccessPreprocessed
    ).length;
}
export function sessionCachedJobs(s: BuildSession): number {
    return s.jobs.filter(j => j.status === BuildJobStatus.SuccessCached).length;
}
export function sessionFailedJobs(s: BuildSession): number {
    return s.jobs.filter(j =>
        j.status === BuildJobStatus.Failed ||
        j.status === BuildJobStatus.Error
    ).length;
}
