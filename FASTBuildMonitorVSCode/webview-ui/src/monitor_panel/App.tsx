// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MonitorSnapshot } from './types';
import { getCoreRows, getWorkerSummary } from './coreRows';
import Toolbar, { getStatusText, formatElapsedCompact } from './components/Toolbar';
import ProgressBar from './components/ProgressBar';
import Timeline from './components/Timeline';
import SidePanel from './components/SidePanel';
import RecentJobs from './components/RecentJobs';
import './App.css';

const vscode = acquireVsCodeApi();

function App() {
    const [snapshot, setSnapshot] = useState<MonitorSnapshot>({
        isMonitoring: false,
        logPath: '',
        workers: [],
    });
    const [timeScale, setTimeScale] = useState(20);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const msg = event.data as { type: string; data: MonitorSnapshot };
            if (msg.type === 'snapshot') {
                setSnapshot(msg.data);
            }
        };
        window.addEventListener('message', handleMessage);
        vscode.postMessage({ command: 'requestSnapshot' });
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // Toggle the legacy fixed color scheme on the document body so both the CSS
    // and the canvas (which reads computed CSS variables) stay in sync.
    useEffect(() => {
        document.body.classList.toggle('legacy-colors', snapshot.useLegacyColors === true);
    }, [snapshot.useLegacyColors]);

    const handleToggle = useCallback(() => {
        vscode.postMessage({ command: snapshot.isMonitoring ? 'stop' : 'start' });
    }, [snapshot.isMonitoring]);

    const handleZoomIn = useCallback(() => {
        setTimeScale(prev => Math.min(200, prev * 1.5));
    }, []);

    const handleZoomOut = useCallback(() => {
        setTimeScale(prev => Math.max(1, prev / 1.5));
    }, []);

    const handleZoomReset = useCallback(() => {
        setTimeScale(20);
    }, []);

    const session = snapshot.session;
    const coreRows = useMemo(() => getCoreRows(session), [session]);
    const { workerCount, remoteCores, localCores } = getWorkerSummary(coreRows);
    const progress = session ? session.progress : 0;
    const elapsed = session
        ? formatElapsedCompact((session.endTime || Date.now()) - session.startTime)
        : '00:00:00';

    return (
        <>
            <div className="version-info">
                {snapshot.useLegacyColors ? (
                    <span className="using-legacy-colors" />
                ) : (
                    <span className="not-using-legacy-colors" />
                )}
            </div>
            <Toolbar
                isMonitoring={snapshot.isMonitoring}
                statusText={getStatusText(snapshot)}
                elapsedTime={elapsed}
                onToggle={handleToggle}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                onZoomReset={handleZoomReset}
            />
            <ProgressBar progress={progress} />
            <div className="main-content">
                <Timeline
                    session={session}
                    coreRows={coreRows}
                    timeScale={timeScale}
                    onTimeScaleChange={setTimeScale}
                />
                <SidePanel session={session} workers={snapshot.workers} />
            </div>
            <RecentJobs session={session} />
            <div className="monitor-footer">
                <span
                    className="workers-summary"
                    title="Remote worker hosts and peak concurrent job slots per host observed during this build, not hardware core counts."
                >
                    {workerCount} workers - {remoteCores} remote cores - {localCores} local cores
                </span>
                <span className="log-path" title={snapshot.logPath}>
                    Log: {snapshot.logPath || '(unknown)'}
                </span>
            </div>
        </>
    );
}

export default App;
