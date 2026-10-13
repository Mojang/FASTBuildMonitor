// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Toolbar, { getStatusText } from '../src/monitor_panel/components/Toolbar';
import SidePanel from '../src/monitor_panel/components/SidePanel';
import RecentJobs from '../src/monitor_panel/components/RecentJobs';
import { BuildJobStatus, STATUS_TEXT_COLORS } from '../src/monitor_panel/types';
import { job, session, snapshot } from './fixtures';

describe('toolbar', () => {
    it('describes idle, waiting, running, completed and failed builds', () => {
        expect(getStatusText(snapshot())).toBe('Idle - Waiting for FASTBuild...');
        expect(getStatusText(snapshot({ isMonitoring: true }))).toBe('Monitoring - Waiting for FASTBuild...');
        expect(getStatusText(snapshot({ session: session({ endTime: undefined }) }))).toBe('Building (PID: 42)...');
        expect(getStatusText(snapshot({ session: session() }))).toBe('Build completed - 1 jobs - 00:00:10');
        const jobs = [
            job({ status: BuildJobStatus.Failed }), job({ status: BuildJobStatus.Error }),
            job({ status: BuildJobStatus.Success }),
        ];
        expect(getStatusText(snapshot({ session: session({ jobs }) }))).toBe('Build FAILED - 2 error(s) - 00:00:10');
    });

    it('renders status and elapsed time, updates its toggle and invokes each action', () => {
        const props = {
            isMonitoring: false, statusText: 'Ready', elapsedTime: '01:02:03',
            onToggle: vi.fn(), onZoomIn: vi.fn(), onZoomOut: vi.fn(), onZoomReset: vi.fn(),
        };
        const { rerender } = render(<Toolbar {...props} />);
        expect(screen.getByText('Ready')).toBeInTheDocument();
        expect(screen.getByText('01:02:03')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Start Monitoring/ }));
        fireEvent.click(screen.getByTitle('Zoom In'));
        fireEvent.click(screen.getByTitle('Zoom Out'));
        fireEvent.click(screen.getByTitle('Reset Zoom'));
        for (const callback of [props.onToggle, props.onZoomIn, props.onZoomOut, props.onZoomReset]) {
            expect(callback).toHaveBeenCalledOnce();
        }
        rerender(<Toolbar {...props} isMonitoring />);
        expect(screen.getByRole('button', { name: /Stop Monitoring/ })).toBeInTheDocument();
    });
});

describe('statistics and worker panel', () => {
    it('shows zero counts before a build', () => {
        const { container } = render(<SidePanel workers={[]} />);
        expect([...container.querySelectorAll('.stat-value')].map(el => el.textContent)).toEqual(['0', '0', '0', '0', '0']);
        expect(container.querySelectorAll('.worker-card')).toHaveLength(0);
    });

    it('counts every status correctly and renders per-worker totals and theme-aware colors', () => {
        const jobs = Object.values(BuildJobStatus).map(status => job({ status }));
        const { container } = render(<SidePanel session={session({ jobs })} workers={[
            { hostName: 'remote', totalJobs: 10, activeJobs: 3, cachedJobs: 2 },
            { hostName: 'local', totalJobs: 7, activeJobs: 1, cachedJobs: 0 },
        ]} />);
        expect([...container.querySelectorAll('.stat-value')].map(el => el.textContent)).toEqual(['9', '1', '3', '1', '2']);
        expect(screen.getByText('10 total / 2 cached')).toBeInTheDocument();
        expect(screen.getByText('7 total / 0 cached')).toBeInTheDocument();
        expect(screen.getByText('3 active')).toBeInTheDocument();
        expect(container.querySelectorAll('.worker-card')).toHaveLength(2);
        expect(container.querySelectorAll<HTMLElement>('.stat-value')[1].style.color).toBe(STATUS_TEXT_COLORS.Building);
    });
});

describe('recent jobs', () => {
    it('renders an empty list before a build', () => {
        const { container } = render(<RecentJobs />);
        expect(screen.getByRole('heading', { name: 'Recent Jobs' })).toBeInTheDocument();
        expect(container.querySelectorAll('.job-row')).toHaveLength(0);
    });

    it('shows the newest 100 jobs first without changing the original order', () => {
        const jobs = Array.from({ length: 105 }, (_, i) => job({
            eventName: `src/job-${i}.cpp`, startTime: 1000 + i,
        }));
        const original = [...jobs];
        const { container } = render(<RecentJobs session={session({ jobs })} />);
        const rows = container.querySelectorAll<HTMLElement>('.job-row');
        expect(rows).toHaveLength(100);
        expect(within(rows[0]).getByText('job-104.cpp')).toBeInTheDocument();
        expect(within(rows[99]).getByText('job-5.cpp')).toBeInTheDocument();
        expect(screen.queryByText('job-4.cpp')).not.toBeInTheDocument();
        expect(jobs).toEqual(original);
    });

    it('updates active durations and displays job status, host and filename', () => {
        vi.useFakeTimers();
        vi.setSystemTime(6500);
        const build = session({ jobs: [job({
            eventName: 'C:\\src\\file.cpp', hostName: 'remote',
            endTime: undefined, status: BuildJobStatus.Building,
        })] });
        const { container, rerender } = render(<RecentJobs session={build} />);
        expect(screen.getByText('file.cpp')).toBeInTheDocument();
        expect(screen.getByText('remote')).toBeInTheDocument();
        expect(screen.getByText('5.5s')).toBeInTheDocument();
        expect(container.querySelector<HTMLElement>('.job-status')?.style.color).toBe(STATUS_TEXT_COLORS.Building);
        vi.setSystemTime(7500);
        rerender(<RecentJobs session={build} />);
        expect(screen.getByText('6.5s')).toBeInTheDocument();
    });
});
