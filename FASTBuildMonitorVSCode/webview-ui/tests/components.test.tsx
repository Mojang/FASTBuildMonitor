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

    it('collapses and expands the list from the header arrow', () => {
        render(<RecentJobs session={session()} />);
        const toggle = screen.getByRole('button', { name: 'Collapse Recent Jobs' });
        const table = screen.getByRole('table', { name: 'Recent Jobs' });
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(toggle).toHaveAttribute('aria-controls', table.id);
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle).toHaveAccessibleName('Expand Recent Jobs');
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Recent Jobs' })).toBeInTheDocument();
        fireEvent.click(toggle);
        expect(screen.getByRole('table', { name: 'Recent Jobs' })).toBeVisible();
    });

    function names(container: HTMLElement) {
        return [...container.querySelectorAll('.job-row .job-name')].map(el => el.textContent);
    }

    it('cycles each column through ascending, descending and newest-first order', () => {
        vi.useFakeTimers();
        vi.setSystemTime(20000);
        const jobs = [
            job({ eventName: 'src/b10.cpp', hostName: 'worker-2', status: BuildJobStatus.Success, startTime: 1000, endTime: 4000 }),
            job({ eventName: 'src/a.cpp', hostName: 'Worker-10', status: BuildJobStatus.Failed, startTime: 2000, endTime: 3000 }),
            job({ eventName: 'src/b9.cpp', hostName: 'local', status: BuildJobStatus.Building, startTime: 3000, endTime: undefined }),
        ];
        const { container } = render(<RecentJobs session={session({ jobs })} />);
        const header = (label: string) => screen.getByRole('columnheader', { name: new RegExp(label) });
        const newest = ['b9.cpp', 'a.cpp', 'b10.cpp'];
        expect(names(container)).toEqual(newest);
        expect(screen.getAllByRole('columnheader').map(h => h.textContent))
            .toEqual(['File', 'Host', 'Status', 'Duration']);

        fireEvent.click(screen.getByTitle('Sort by File'));
        expect(header('File')).toHaveAttribute('aria-sort', 'ascending');
        expect(names(container)).toEqual(['a.cpp', 'b9.cpp', 'b10.cpp']);
        fireEvent.click(screen.getByTitle('Sort by File'));
        expect(header('File')).toHaveAttribute('aria-sort', 'descending');
        expect(names(container)).toEqual(['b10.cpp', 'b9.cpp', 'a.cpp']);
        fireEvent.click(screen.getByTitle('Sort by File'));
        expect(header('File')).toHaveAttribute('aria-sort', 'none');
        expect(names(container)).toEqual(newest);

        fireEvent.click(screen.getByTitle('Sort by Host'));
        expect(names(container)).toEqual(['b9.cpp', 'b10.cpp', 'a.cpp']);
        fireEvent.click(screen.getByTitle('Sort by Status'));
        expect(header('Host')).toHaveAttribute('aria-sort', 'none');
        expect(header('Status')).toHaveAttribute('aria-sort', 'ascending');
        expect(names(container)).toEqual(['b9.cpp', 'a.cpp', 'b10.cpp']);
        fireEvent.click(screen.getByTitle('Sort by Duration'));
        expect(names(container)).toEqual(['a.cpp', 'b10.cpp', 'b9.cpp']);
        fireEvent.click(screen.getByTitle('Sort by Duration'));
        expect(names(container)).toEqual(['b9.cpp', 'b10.cpp', 'a.cpp']);
        expect(jobs.map(j => j.eventName)).toEqual(['src/b10.cpp', 'src/a.cpp', 'src/b9.cpp']);
    });

    it('keeps newest-first order for ties and sorts only the 100 most recent jobs', () => {
        const jobs = Array.from({ length: 101 }, (_, i) => job({
            eventName: `src/job-${i}.cpp`, hostName: i === 0 ? 'aaa' : 'same', startTime: 1000 + i,
        }));
        const { container } = render(<RecentJobs session={session({ jobs })} />);
        fireEvent.click(screen.getByTitle('Sort by Host'));
        expect(names(container)).toHaveLength(100);
        expect(names(container).slice(0, 2)).toEqual(['job-100.cpp', 'job-99.cpp']);
        expect(screen.queryByText('aaa')).not.toBeInTheDocument();
    });
});
