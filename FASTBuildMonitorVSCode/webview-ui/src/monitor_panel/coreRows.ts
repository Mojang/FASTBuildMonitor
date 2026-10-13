// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { BuildJob, BuildSession } from './types';

export interface CoreRow {
    hostName: string;
    coreIndex: number;
    jobs: BuildJob[];
}

// Assign jobs to virtual "cores" per host via first-fit scheduling, so that
// each row represents a single execution slot. Core counts are the peak
// concurrency observed in the log, not the host's hardware core count.
export function getCoreRows(session?: BuildSession): CoreRow[] {
    if (!session) return [];
    const sortedJobs = [...session.jobs].sort((a, b) => a.startTime - b.startTime);

    interface CoreSlot { jobs: BuildJob[]; lastEndTime: number; }
    const hostCores = new Map<string, CoreSlot[]>();
    const displayNameByKey = new Map<string, string>();

    for (const job of sortedJobs) {
        const key = job.hostName.toLowerCase();
        if (!displayNameByKey.has(key)) {
            displayNameByKey.set(key, job.hostName);
        }
        let cores = hostCores.get(key);
        if (!cores) {
            cores = [];
            hostCores.set(key, cores);
        }

        const jobEnd = job.endTime ?? Date.now();
        let assigned = false;
        for (const core of cores) {
            if (core.lastEndTime <= job.startTime) {
                core.jobs.push(job);
                core.lastEndTime = jobEnd;
                assigned = true;
                break;
            }
        }
        if (!assigned) {
            cores.push({ jobs: [job], lastEndTime: jobEnd });
        }
    }

    // Local host first, then remaining hosts alphabetically.
    const hostKeys = Array.from(hostCores.keys()).sort((a, b) => {
        const aLocal = a === 'local';
        const bLocal = b === 'local';
        if (aLocal && !bLocal) return -1;
        if (!aLocal && bLocal) return 1;
        return a.localeCompare(b);
    });

    const rows: CoreRow[] = [];
    for (const key of hostKeys) {
        const cores = hostCores.get(key)!;
        const displayName = displayNameByKey.get(key) || key;
        cores.forEach((core, idx) => {
            rows.push({ hostName: displayName, coreIndex: idx, jobs: core.jobs });
        });
    }
    return rows;
}

export function getWorkerSummary(rows: CoreRow[]) {
    const workers = new Set<string>();
    let remoteCores = 0;
    let localCores = 0;
    for (const row of rows) {
        const host = row.hostName.toLowerCase();
        if (host === 'local') {
            localCores++;
        } else {
            workers.add(host);
            remoteCores++;
        }
    }
    return { workerCount: workers.size, remoteCores, localCores };
}
