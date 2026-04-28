// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BuildSession, STATUS_COLORS, getDisplayName, formatDuration } from '../types';

interface RecentJobsProps {
    session?: BuildSession;
}

export default function RecentJobs({ session }: RecentJobsProps) {
    const recent = session ? session.jobs.slice(-100).reverse() : [];

    return (
        <div className="recent-jobs">
            <h3>Recent Jobs</h3>
            <div className="recent-jobs-list">
                {recent.map((job, index) => {
                    const color = STATUS_COLORS[job.status] || '#9E9E9E';
                    const dur = formatDuration((job.endTime || Date.now()) - job.startTime);
                    return (
                        <div className="job-row" key={`${job.eventName}-${job.startTime}-${index}`}>
                            <div className="job-name">{getDisplayName(job.eventName)}</div>
                            <div className="job-host">{job.hostName}</div>
                            <div className="job-status" style={{ color }}>
                                {job.status}
                            </div>
                            <div className="job-duration">{dur}</div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
