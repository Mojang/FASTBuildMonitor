// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BuildSession, WorkerSnapshot } from '../types';

interface SidePanelProps {
    session?: BuildSession;
    workers: WorkerSnapshot[];
}

function countByStatus(session: BuildSession, status: string): number {
    return session.jobs.filter(j => j.status === status).length;
}

function countSuccess(session: BuildSession): number {
    return session.jobs.filter(
        j => j.status === 'Success' || j.status === 'SuccessCached' || j.status === 'SuccessPreprocessed'
    ).length;
}

function countFailed(session: BuildSession): number {
    return session.jobs.filter(j => j.status === 'Failed' || j.status === 'Error').length;
}

export default function SidePanel({ session, workers }: SidePanelProps) {
    const total = session ? session.jobs.length : 0;
    const active = session ? countByStatus(session, 'Building') : 0;
    const success = session ? countSuccess(session) : 0;
    const cached = session ? countByStatus(session, 'SuccessCached') : 0;
    const failed = session ? countFailed(session) : 0;

    return (
        <div className="side-panel">
            <div className="stats-section">
                <h3>Build Statistics</h3>
                <div className="stats-card">
                    <div className="stat-row">
                        <span className="stat-label">Total Jobs:</span>
                        <span className="stat-value" style={{ color: 'var(--text-bright)' }}>{total}</span>
                    </div>
                    <div className="stat-row">
                        <span className="stat-label">Active:</span>
                        <span className="stat-value" style={{ color: 'var(--accent-blue)' }}>{active}</span>
                    </div>
                    <div className="stat-row">
                        <span className="stat-label">Succeeded:</span>
                        <span className="stat-value" style={{ color: 'var(--accent-green)' }}>{success}</span>
                    </div>
                    <div className="stat-row">
                        <span className="stat-label">Cached:</span>
                        <span className="stat-value" style={{ color: 'var(--accent-lightgreen)' }}>{cached}</span>
                    </div>
                    <div className="stat-row">
                        <span className="stat-label">Failed:</span>
                        <span className="stat-value" style={{ color: 'var(--accent-red)' }}>{failed}</span>
                    </div>
                </div>
            </div>

            <div className="workers-section">
                <h3>Workers</h3>
                <div>
                    {workers.map(w => (
                        <div className="worker-card" key={w.hostName}>
                            <div className="worker-name">{w.hostName}</div>
                            <div className="worker-stats">
                                {w.totalJobs} total / {w.cachedJobs} cached
                            </div>
                            <div className="worker-active">{w.activeJobs} active</div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="legend">
                <div className="legend-item">
                    <div className="legend-swatch" style={{ background: 'var(--accent-blue)' }} />
                    Building
                </div>
                <div className="legend-item">
                    <div className="legend-swatch" style={{ background: 'var(--accent-green)' }} />
                    Success
                </div>
                <div className="legend-item">
                    <div className="legend-swatch" style={{ background: 'var(--accent-lightgreen)' }} />
                    Cached
                </div>
                <div className="legend-item">
                    <div className="legend-swatch" style={{ background: 'var(--accent-red)' }} />
                    Failed
                </div>
                <div className="legend-item">
                    <div className="legend-swatch" style={{ background: 'var(--accent-orange)' }} />
                    Timeout
                </div>
            </div>
        </div>
    );
}
