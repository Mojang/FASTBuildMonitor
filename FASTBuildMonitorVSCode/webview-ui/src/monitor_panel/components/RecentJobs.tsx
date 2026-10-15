// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { useId, useState } from 'react';
import { BuildJob, BuildSession, STATUS_TEXT_COLORS, getDisplayName, formatDuration } from '../types';

interface RecentJobsProps {
    session?: BuildSession;
}

type SortKey = 'name' | 'host' | 'status' | 'duration';
type SortDirection = 'ascending' | 'descending';

interface SortState {
    key: SortKey;
    direction: SortDirection;
}

interface Column {
    key: SortKey;
    label: string;
}

const COLUMNS: Column[] = [
    { key: 'name', label: 'File' },
    { key: 'host', label: 'Host' },
    { key: 'status', label: 'Status' },
    { key: 'duration', label: 'Duration' },
];

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function getDuration(job: BuildJob, now: number): number {
    return (job.endTime || now) - job.startTime;
}

function compareJobs(a: BuildJob, b: BuildJob, key: SortKey, now: number): number {
    switch (key) {
        case 'name':
            return collator.compare(getDisplayName(a.eventName), getDisplayName(b.eventName));
        case 'host':
            return collator.compare(a.hostName, b.hostName);
        case 'status':
            return collator.compare(a.status, b.status);
        case 'duration':
            return getDuration(a, now) - getDuration(b, now);
    }
}

// Each click on the same column cycles ascending -> descending -> unsorted
// (newest first); clicking a different column starts again at ascending.
function nextSort(current: SortState | undefined, key: SortKey): SortState | undefined {
    if (current?.key !== key) return { key, direction: 'ascending' };
    return current.direction === 'ascending' ? { key, direction: 'descending' } : undefined;
}

export default function RecentJobs({ session }: RecentJobsProps) {
    const [expanded, setExpanded] = useState(true);
    const [sort, setSort] = useState<SortState>();
    const listId = useId();

    const now = Date.now();
    const recent = session ? session.jobs.slice(-100).reverse() : [];
    if (sort) {
        const sign = sort.direction === 'ascending' ? 1 : -1;
        // Array.prototype.sort is stable, so ties keep newest-first order.
        recent.sort((a, b) => sign * compareJobs(a, b, sort.key, now));
    }

    return (
        <div className={`recent-jobs${expanded ? '' : ' collapsed'}`}>
            <div className="recent-jobs-header">
                <button
                    type="button"
                    className="recent-jobs-toggle"
                    aria-expanded={expanded}
                    aria-controls={listId}
                    aria-label={expanded ? 'Collapse Recent Jobs' : 'Expand Recent Jobs'}
                    title={expanded ? 'Collapse Recent Jobs' : 'Expand Recent Jobs'}
                    onClick={() => setExpanded(value => !value)}
                >
                    {expanded ? '\u25BE' : '\u25B8'}
                </button>
                <h3>Recent Jobs</h3>
            </div>
            <div
                id={listId}
                className="recent-jobs-list"
                role="table"
                aria-label="Recent Jobs"
                hidden={!expanded}
            >
                <div className="job-header-group" role="rowgroup">
                    <div className="job-header-row" role="row">
                        {COLUMNS.map(column => {
                            const direction = sort?.key === column.key ? sort.direction : undefined;
                            return (
                                <div
                                    key={column.key}
                                    className={`job-header job-header-${column.key}`}
                                    role="columnheader"
                                    aria-sort={direction ?? 'none'}
                                >
                                    <button
                                        type="button"
                                        className="job-sort-button"
                                        title={`Sort by ${column.label}`}
                                        onClick={() => setSort(current => nextSort(current, column.key))}
                                    >
                                        {column.label}
                                        <span className="job-sort-indicator" aria-hidden="true">
                                            {direction === 'ascending' ? '\u25B2' : direction === 'descending' ? '\u25BC' : ''}
                                        </span>
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
                <div role="rowgroup">
                    {recent.map((job, index) => {
                        const color = STATUS_TEXT_COLORS[job.status];
                        const dur = formatDuration(getDuration(job, now));
                        return (
                            <div className="job-row" role="row" key={`${job.eventName}-${job.startTime}-${index}`}>
                                <div className="job-name" role="cell">{getDisplayName(job.eventName)}</div>
                                <div className="job-host" role="cell">{job.hostName}</div>
                                <div className="job-status" role="cell" style={{ color }}>
                                    {job.status}
                                </div>
                                <div className="job-duration" role="cell">{dur}</div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
