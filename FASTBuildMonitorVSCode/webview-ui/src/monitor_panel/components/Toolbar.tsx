// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MonitorSnapshot } from '../types';

interface ToolbarProps {
    isMonitoring: boolean;
    statusText: string;
    elapsedTime: string;
    onToggle: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onZoomReset: () => void;
}

function getStatusText(snapshot: MonitorSnapshot): string {
    const session = snapshot.session;
    if (!session) {
        return snapshot.isMonitoring
            ? 'Monitoring - Waiting for FASTBuild...'
            : 'Idle - Waiting for FASTBuild...';
    }
    if (session.endTime) {
        const failedCount = session.jobs.filter(
            j => j.status === 'Failed' || j.status === 'Error'
        ).length;
        const elapsed = formatElapsedCompact(session.endTime - session.startTime);
        return failedCount > 0
            ? `Build FAILED - ${failedCount} error(s) - ${elapsed}`
            : `Build completed - ${session.jobs.length} jobs - ${elapsed}`;
    }
    return `Building (PID: ${session.processId})...`;
}

function formatElapsedCompact(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

export { getStatusText, formatElapsedCompact };

export default function Toolbar({
    isMonitoring,
    statusText,
    elapsedTime,
    onToggle,
    onZoomIn,
    onZoomOut,
    onZoomReset,
}: ToolbarProps) {
    return (
        <div className="toolbar">
            <button
                onClick={onToggle}
                style={{ background: isMonitoring ? '#D32F2F' : '#388E3C' }}
            >
                {isMonitoring ? '\u23F9 Stop Monitoring' : '\u25B6 Start Monitoring'}
            </button>
            <div className="sep" />
            <span className="status">{statusText}</span>
            <span className="elapsed">{elapsedTime}</span>
            <div className="sep" />
            <button className="zoom-btn" onClick={onZoomOut} title="Zoom Out">
                &minus;
            </button>
            <button className="zoom-btn" onClick={onZoomReset} title="Reset Zoom">
                &#x27F3;
            </button>
            <button className="zoom-btn" onClick={onZoomIn} title="Zoom In">
                +
            </button>
        </div>
    );
}
