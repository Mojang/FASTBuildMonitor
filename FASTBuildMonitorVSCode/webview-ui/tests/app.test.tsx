// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/monitor_panel/App';
import { BuildJobStatus, type MonitorSnapshot } from '../src/monitor_panel/types';
import { job, session, snapshot } from './fixtures';
import { vscodeApi } from './setup';

const timeline = vi.hoisted(() => vi.fn());
vi.mock('../src/monitor_panel/components/Timeline', () => ({
    default: (props: { timeScale: number; onTimeScaleChange: (value: number) => void }) => {
        timeline(props);
        return <button onClick={() => props.onTimeScaleChange(75)}>Timeline zoom</button>;
    },
}));

function sendSnapshot(data: MonitorSnapshot) {
    act(() => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'snapshot', data } }));
    });
}

describe('monitor application', () => {
    it('requests initial state and sends start/stop commands for the current monitoring state', () => {
        render(<App />);
        expect(vscodeApi.postMessage).toHaveBeenCalledExactlyOnceWith({ command: 'requestSnapshot' });
        expect(screen.getByText('Idle - Waiting for FASTBuild...')).toBeInTheDocument();
        expect(screen.getByText('Log: (unknown)')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Start Monitoring/ }));
        expect(vscodeApi.postMessage).toHaveBeenLastCalledWith({ command: 'start' });
        sendSnapshot(snapshot({ isMonitoring: true, logPath: 'C:\\build\\FastBuildLog.log' }));
        fireEvent.click(screen.getByRole('button', { name: /Stop Monitoring/ }));
        expect(vscodeApi.postMessage).toHaveBeenLastCalledWith({ command: 'stop' });
        expect(screen.getByText('Log: C:\\build\\FastBuildLog.log')).toBeInTheDocument();
    });

    it('updates progress, statistics, jobs, elapsed time and workers from snapshots', () => {
        vi.useFakeTimers();
        vi.setSystemTime(6500);
        render(<App />);
        sendSnapshot(snapshot({
            isMonitoring: true,
            session: session({
                endTime: undefined, progress: 42.5,
                jobs: [job({ status: BuildJobStatus.Building, endTime: undefined })],
            }),
            workers: [{ hostName: 'worker', totalJobs: 5, activeJobs: 1, cachedJobs: 2 }],
        }));
        expect(screen.getByText('Building (PID: 42)...')).toBeInTheDocument();
        expect(screen.getByText('00:00:05')).toBeInTheDocument();
        expect(screen.getAllByText('42.5%')).toHaveLength(2);
        expect(screen.getByText('file.cpp')).toBeInTheDocument();
        expect(screen.getByText('5 total / 2 cached')).toBeInTheDocument();
        sendSnapshot(snapshot({ session: session() }));
        expect(screen.getByText('00:00:10')).toBeInTheDocument();
        expect(screen.getByText('Build completed - 1 jobs - 00:00:10')).toBeInTheDocument();
        sendSnapshot(snapshot({ session: session({ processId: 43, jobs: [], progress: 0, endTime: undefined }) }));
        expect(screen.queryByText('file.cpp')).not.toBeInTheDocument();
        expect(screen.getAllByText('0.0%')).toHaveLength(2);
    });

    it('applies and removes legacy colors and ignores unrelated messages', () => {
        render(<App />);
        sendSnapshot(snapshot({ useLegacyColors: true }));
        expect(document.body).toHaveClass('legacy-colors');
        expect(document.querySelector('.using-legacy-colors')).toBeInTheDocument();
        act(() => {
            window.dispatchEvent(new MessageEvent('message', { data: { type: 'unrelated', data: {} } }));
        });
        expect(document.body).toHaveClass('legacy-colors');
        sendSnapshot(snapshot({ useLegacyColors: false }));
        expect(document.body).not.toHaveClass('legacy-colors');
        expect(document.querySelector('.not-using-legacy-colors')).toBeInTheDocument();
    });

    it('clamps toolbar zoom, resets it, and accepts timeline zoom changes', () => {
        render(<App />);
        for (let i = 0; i < 20; i++) fireEvent.click(screen.getByTitle('Zoom In'));
        expect(timeline).toHaveBeenLastCalledWith(expect.objectContaining({ timeScale: 200 }));
        for (let i = 0; i < 30; i++) fireEvent.click(screen.getByTitle('Zoom Out'));
        expect(timeline).toHaveBeenLastCalledWith(expect.objectContaining({ timeScale: 1 }));
        fireEvent.click(screen.getByTitle('Reset Zoom'));
        expect(timeline).toHaveBeenLastCalledWith(expect.objectContaining({ timeScale: 20 }));
        fireEvent.click(screen.getByRole('button', { name: 'Timeline zoom' }));
        expect(timeline).toHaveBeenLastCalledWith(expect.objectContaining({ timeScale: 75 }));
    });

    it('removes its message listener when unmounted', () => {
        const add = vi.spyOn(window, 'addEventListener');
        const remove = vi.spyOn(window, 'removeEventListener');
        const { unmount } = render(<App />);
        const listener = add.mock.calls.find(([name]) => name === 'message')?.[1];
        expect(listener).toBeDefined();
        unmount();
        expect(remove).toHaveBeenCalledWith('message', listener);
    });
});
