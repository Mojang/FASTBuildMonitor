// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JobTooltip, { useJobTooltip } from '../src/monitor_panel/components/JobTooltip';
import RecentJobs from '../src/monitor_panel/components/RecentJobs';
import { BuildJobStatus } from '../src/monitor_panel/types';
import { job, session } from './fixtures';
import { ResizeObserverMock } from './setup';

const callbacks = {
    id: 'job-tooltip',
    onMouseEnter: vi.fn(),
    onMouseLeave: vi.fn(),
};

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(11000);
});

describe('rich job tooltips', () => {
    it('renders sectioned details, relative timing and compiler output as plain text', () => {
        const event = job({
            eventName: 'C:\\project\\src\\file.cpp', startTime: 2000, endTime: 6500,
            status: BuildJobStatus.Failed, message: '<script>alert("error")</script>\ncompiler: error C1234',
        });
        const build = session({ jobs: [event] });
        const { container } = render(<JobTooltip hover={{ job: event, session: build, x: 20, y: 20, coreIndex: 2 }}
            session={build} {...callbacks} />);
        const tooltip = screen.getByRole('tooltip');
        expect(container).toBeEmptyDOMElement();
        expect(tooltip).toHaveTextContent(event.eventName);
        for (const heading of ['File / Target', 'Execution', 'Timing', 'Output / Diagnostics']) {
            expect(within(tooltip).getByRole('heading', { name: heading })).toBeInTheDocument();
        }
        expect(tooltip).toHaveTextContent('Failed');
        expect(tooltip).toHaveTextContent('#2');
        expect(tooltip).toHaveTextContent('4.5s');
        expect(tooltip).toHaveTextContent('+1.0s');
        expect(tooltip).toHaveTextContent('+5.5s');
        expect(tooltip.querySelector('pre')?.textContent).toBe(event.message);
        expect(tooltip.querySelector('script')).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('ticks every 100 ms without pointer movement and resolves new status and output', () => {
        const event = job({ endTime: undefined, status: BuildJobStatus.Building });
        const build = session({ jobs: [event], endTime: undefined });
        const hover = { job: event, session: build, x: 20, y: 20 };
        const { rerender, unmount } = render(<JobTooltip hover={hover} session={build} {...callbacks} />);
        expect(screen.getByRole('tooltip')).toHaveTextContent('Time Elapsed10.0s');
        act(() => vi.advanceTimersByTime(100));
        expect(screen.getByRole('tooltip')).toHaveTextContent('Time Elapsed10.1s');
        const completed = session({ jobs: [{
            ...event, endTime: 11100, status: BuildJobStatus.Failed, message: 'Compilation failed',
        }] });
        rerender(<JobTooltip hover={hover} session={completed} {...callbacks} />);
        expect(screen.getByRole('tooltip')).toHaveTextContent('Failed');
        expect(screen.getByRole('tooltip')).toHaveTextContent('Duration10.1s');
        expect(screen.getByRole('tooltip')).toHaveTextContent('Compilation failed');
        expect(vi.getTimerCount()).toBe(0);
        act(() => vi.advanceTimersByTime(1000));
        expect(screen.getByRole('tooltip')).toHaveTextContent('Duration10.1s');
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('freezes unfinished jobs at session end without inventing a job end time', () => {
        const event = job({ endTime: undefined, status: BuildJobStatus.Stopped });
        const build = session({ jobs: [event], endTime: 8000 });
        render(<JobTooltip hover={{ job: event, session: build, x: 0, y: 0 }} session={build} {...callbacks} />);
        expect(screen.getByRole('tooltip')).toHaveTextContent('Duration7.0s');
        expect(screen.getByRole('tooltip')).toHaveTextContent('Not reported');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('hides removed events and tooltips from previous builds with reused event identities', () => {
        const event = job();
        const build = session();
        const hover = { job: event, session: build, x: 20, y: 20 };
        const { rerender } = render(<JobTooltip hover={hover} session={build} {...callbacks} />);
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
        for (const replacement of [undefined, session({ jobs: [] }), session({ processId: 43 }), session({ startTime: 2000 })]) {
            rerender(<JobTooltip hover={hover} session={replacement} {...callbacks} />);
            expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        }
    });

    it('resolves events by host, full target and start time instead of filename alone', () => {
        const event = job({ hostName: 'remote', startTime: 2000, eventName: 'other/file.cpp' });
        const build = session({ jobs: [job(), job({ ...event, hostName: 'local' }), job({ ...event, startTime: 3000 }), event] });
        render(<JobTooltip hover={{ job: event, session: build, x: 20, y: 20 }} session={build} {...callbacks} />);
        expect(screen.getByRole('tooltip')).toHaveTextContent('remote');
        expect(screen.getByRole('tooltip')).toHaveTextContent('other/file.cpp');
        expect(screen.getByRole('tooltip')).toHaveTextContent('Duration1.0s');
    });

    it('flips at viewport edges and repositions after content or viewport resize', () => {
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 250, width: 300, height: 250,
            toJSON: () => ({}),
        });
        const build = session();
        const hover = { job: build.jobs[0], session: build, x: window.innerWidth - 10, y: window.innerHeight - 10 };
        const { rerender } = render(<JobTooltip hover={hover} session={build} {...callbacks} />);
        expect(screen.getByRole('tooltip')).toHaveStyle({
            left: `${window.innerWidth - 324}px`, top: `${window.innerHeight - 274}px`,
        });
        rerender(<JobTooltip hover={{ ...hover, x: 0, y: 0 }} session={build} {...callbacks} />);
        expect(screen.getByRole('tooltip')).toHaveStyle({ left: '14px', top: '14px' });
        act(() => ResizeObserverMock.instances.at(-1)!.trigger());
        expect(screen.getByRole('tooltip')).toHaveStyle({ left: '14px', top: '14px' });
        vi.stubGlobal('innerWidth', 200);
        vi.stubGlobal('innerHeight', 100);
        fireEvent.resize(window);
        expect(screen.getByRole('tooltip')).toHaveStyle({ left: '8px', top: '8px' });
    });

    it('cleans up live timers and resize observers on unmount', () => {
        const event = job({ status: BuildJobStatus.Building, endTime: undefined });
        const build = session({ jobs: [event], endTime: undefined });
        const { unmount } = render(<JobTooltip hover={{ job: event, session: build, x: 20, y: 20 }}
            session={build} {...callbacks} />);
        expect(vi.getTimerCount()).toBe(1);
        unmount();
        expect(vi.getTimerCount()).toBe(0);
        expect(ResizeObserverMock.instances.at(-1)!.disconnect).toHaveBeenCalledOnce();
    });

    it('shares live details with Recent Jobs and dismisses on collapse, sort, scroll and leave', () => {
        const event = job({ status: BuildJobStatus.Building, endTime: undefined });
        const build = session({ jobs: [job({ eventName: 'src/previous.cpp' }), event], endTime: undefined });
        const { container, rerender, unmount } = render(<RecentJobs session={build} />);
        const show = () => {
            fireEvent.mouseMove(screen.getAllByRole('row')[1], { clientX: 50, clientY: 50 });
            act(() => vi.advanceTimersByTime(350));
            expect(screen.getByRole('tooltip')).toHaveTextContent('src/file.cpp');
        };
        show();
        act(() => vi.advanceTimersByTime(1000));
        expect(screen.getByRole('tooltip')).toHaveTextContent('11.3s');
        fireEvent.mouseLeave(screen.getAllByRole('row')[1]);
        act(() => vi.advanceTimersByTime(300));
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        show();
        fireEvent.scroll(container.querySelector('.recent-jobs-list')!);
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        show();
        fireEvent.click(screen.getByRole('button', { name: 'File' }));
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        show();
        fireEvent.click(screen.getByRole('button', { name: 'Collapse Recent Jobs' }));
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Expand Recent Jobs' }));
        show();
        rerender(<RecentJobs session={session({ jobs: [{ ...event, endTime: 12000, status: BuildJobStatus.Success }] })} />);
        expect(screen.getByRole('tooltip')).toHaveTextContent('Success');
        expect(vi.getTimerCount()).toBe(0);
        rerender(<RecentJobs session={session({ processId: 43 })} />);
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        show();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        show();
        fireEvent.mouseLeave(screen.getAllByRole('row')[1]);
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('renders only one card for multiple recent rows and keeps it open over diagnostics', () => {
        const build = session({ jobs: [job(), job({ eventName: 'other.cpp', message: 'Full compiler output' })] });
        render(<RecentJobs session={build} />);
        const row = screen.getAllByRole('row')[1];
        fireEvent.mouseMove(row, { clientX: 50, clientY: 50 });
        act(() => vi.advanceTimersByTime(350));
        expect(screen.getAllByRole('tooltip')).toHaveLength(1);
        fireEvent.mouseLeave(row);
        act(() => vi.advanceTimersByTime(250));
        fireEvent.mouseEnter(screen.getByRole('tooltip'));
        act(() => vi.advanceTimersByTime(200));
        expect(screen.getByRole('tooltip')).toHaveTextContent('Full compiler output');
        fireEvent.scroll(screen.getByRole('tooltip').querySelector('pre')!);
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
        fireEvent.mouseLeave(screen.getByRole('tooltip'));
        act(() => vi.advanceTimersByTime(300));
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('keeps its position across snapshots and content size changes unless it would overflow', () => {
        const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
        const rect = { x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 250, width: 300, height: 250, toJSON: () => ({}) };
        measure.mockReturnValue(rect);
        const build = session();
        const hover = { job: build.jobs[0], session: build, x: 900, y: 650 };
        const { rerender } = render(<JobTooltip hover={hover} session={build} {...callbacks} />);
        const before = screen.getByRole('tooltip').getAttribute('style');
        measure.mockReturnValue({ ...rect, width: 250, height: 200 });
        rerender(<JobTooltip hover={hover} session={session({ jobs: [job({ message: 'Updated output' })] })} {...callbacks} />);
        act(() => ResizeObserverMock.instances.at(-1)!.trigger());
        expect(screen.getByRole('tooltip')).toHaveTextContent('Updated output');
        expect(screen.getByRole('tooltip').getAttribute('style')).toBe(before);
        measure.mockReturnValue({ ...rect, width: 900, height: 700 });
        act(() => ResizeObserverMock.instances.at(-1)!.trigger());
        expect(screen.getByRole('tooltip')).toHaveStyle({
            left: `${window.innerWidth - 908}px`, top: `${window.innerHeight - 708}px`,
        });
    });
});

describe('tooltip hover timing and anchoring', () => {
    const build = session({ jobs: [job(), job({ eventName: 'other.cpp' })] });
    const target = { job: build.jobs[0], session: build, x: 10, y: 10 };
    const other = { job: build.jobs[1], session: build, x: 20, y: 20 };

    it('waits 350 ms per job, uses the latest pending point, and then stops following the mouse', () => {
        const { result } = renderHook(() => useJobTooltip(build));
        act(() => result.current.show(target));
        act(() => vi.advanceTimersByTime(200));
        act(() => result.current.show({ ...target, x: 30 }));
        act(() => vi.advanceTimersByTime(149));
        expect(result.current.hover).toBeUndefined();
        act(() => vi.advanceTimersByTime(1));
        expect(result.current.hover).toMatchObject({ x: 30, y: 10 });
        const opened = result.current.hover;
        act(() => result.current.show({ ...target, job: { ...target.job }, x: 100, y: 100 }));
        expect(result.current.hover).toBe(opened);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('restarts the delay for another job and preserves the old card until the new one opens', () => {
        const { result } = renderHook(() => useJobTooltip(build));
        act(() => result.current.show(target));
        act(() => vi.advanceTimersByTime(200));
        act(() => result.current.show(other));
        act(() => vi.advanceTimersByTime(349));
        expect(result.current.hover).toBeUndefined();
        act(() => vi.advanceTimersByTime(1));
        expect(result.current.hover).toBe(other);
        act(() => result.current.show(target));
        act(() => vi.advanceTimersByTime(349));
        expect(result.current.hover).toBe(other);
        act(() => vi.advanceTimersByTime(1));
        expect(result.current.hover).toBe(target);
    });

    it('allows 300 ms to enter the card and cancels pending replacements when it is entered', () => {
        const { result } = renderHook(() => useJobTooltip(build));
        act(() => result.current.show(target));
        act(() => vi.advanceTimersByTime(350));
        act(() => result.current.scheduleDismiss());
        act(() => vi.advanceTimersByTime(250));
        expect(result.current.hover).toBe(target);
        act(() => result.current.keepOpen());
        act(() => vi.advanceTimersByTime(400));
        expect(result.current.hover).toBe(target);
        act(() => result.current.show(other));
        act(() => vi.advanceTimersByTime(250));
        act(() => result.current.keepOpen());
        act(() => vi.advanceTimersByTime(400));
        expect(result.current.hover).toBe(target);
        act(() => result.current.scheduleDismiss());
        act(() => vi.advanceTimersByTime(150));
        act(() => result.current.scheduleDismiss());
        act(() => vi.advanceTimersByTime(149));
        expect(result.current.hover).toBe(target);
        act(() => vi.advanceTimersByTime(1));
        expect(result.current.hover).toBeUndefined();
    });

    it.each(['leave', 'Escape', 'blur', 'dismiss', 'unmount', 'new build'])('cancels a pending tooltip on %s', action => {
        const { result, unmount, rerender } = renderHook(({ build }) => useJobTooltip(build), { initialProps: { build } });
        act(() => result.current.show(target));
        act(() => vi.advanceTimersByTime(200));
        switch (action) {
            case 'leave': act(() => result.current.scheduleDismiss()); break;
            case 'Escape': fireEvent.keyDown(window, { key: 'Escape' }); break;
            case 'blur': fireEvent.blur(window); break;
            case 'dismiss': act(() => result.current.dismiss()); break;
            case 'unmount': unmount(); break;
            case 'new build': rerender({ build: { ...build, processId: 43 } }); break;
        }
        act(() => vi.advanceTimersByTime(500));
        expect(result.current.hover).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('ignores unrelated keys but dismisses an open tooltip on blur and Escape', () => {
        const { result, unmount } = renderHook(() => useJobTooltip(build));
        for (const key of ['Escape', 'blur']) {
            act(() => result.current.show(target));
            act(() => vi.advanceTimersByTime(350));
            fireEvent.keyDown(window, { key: 'Enter' });
            expect(result.current.hover).toBe(target);
            if (key === 'blur') fireEvent.blur(window);
            else fireEvent.keyDown(window, { key });
            expect(result.current.hover).toBeUndefined();
        }
        const remove = vi.spyOn(window, 'removeEventListener');
        unmount();
        expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
        expect(remove).toHaveBeenCalledWith('blur', expect.any(Function));
    });
});
