// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Timeline from '../src/monitor_panel/components/Timeline';
import { BuildJobStatus } from '../src/monitor_panel/types';
import { canvasContext, getContext, ResizeObserverMock } from './setup';
import { job, session } from './fixtures';

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(11000);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
});

function canvas(container: HTMLElement, selector: string) {
    const element = container.querySelector<HTMLCanvasElement>(selector);
    if (!element) throw new Error(`Missing canvas: ${selector}`);
    return element;
}

describe('timeline rendering and interaction', () => {
    it('renders an empty state and releases resize observers on unmount', () => {
        const { container, unmount } = render(<Timeline timeScale={20} onTimeScaleChange={vi.fn()} />);
        const body = canvas(container, '.timeline-body canvas');
        expect(canvasContext(body).fillText).toHaveBeenCalledWith('Waiting for FASTBuild data...', 410, 84);
        const observer = ResizeObserverMock.instances[0];
        expect(observer.observe).toHaveBeenCalledWith(container.firstChild);
        act(() => observer.trigger());
        expect(canvasContext(body).fillText).toHaveBeenCalledTimes(2);
        fireEvent.mouseMove(body, { clientX: 10, clientY: 10 });
        expect(body.title).toBe('');
        unmount();
        expect(observer.disconnect).toHaveBeenCalledOnce();
    });

    it('allocates cores by peak concurrency, merges host casing and puts local rows first', () => {
        const jobs = [
            job({ hostName: 'worker-b', startTime: 3000, endTime: 6000 }),
            job({ hostName: 'local', startTime: 2000, endTime: 5000 }),
            job({ hostName: 'worker-a', startTime: 1000, endTime: 3000 }),
            job({ hostName: 'LOCAL', startTime: 1000, endTime: 4000 }),
            job({ hostName: 'WORKER-A', startTime: 3000, endTime: 5000 }),
            job({ hostName: 'worker-b', startTime: 4000, endTime: 6000 }),
        ];
        const original = [...jobs];
        const { container } = render(<Timeline session={session({ jobs })} timeScale={20} onTimeScaleChange={vi.fn()} />);
        const labels = canvasContext(canvas(container, '.timeline-labels canvas'));
        expect(labels.fillText.mock.calls.map(([text]) => text)).toEqual([
            'LOCAL (Core # 0)', 'LOCAL (Core # 1)', 'worker-a (Core # 0)',
            'worker-b (Core # 0)', 'worker-b (Core # 1)',
        ]);
        expect(jobs).toEqual(original);
        expect(canvasContext(canvas(container, '.timeline-body canvas')).fill).toHaveBeenCalledTimes(6);
    });

    it('keeps separate rows for overlapping active jobs and preserves rows after completion', () => {
        const jobs = [
            job({ endTime: undefined, status: BuildJobStatus.Building }),
            job({ startTime: 2000, endTime: undefined, status: BuildJobStatus.Building }),
        ];
        const { container, rerender } = render(
            <Timeline session={session({ jobs, endTime: undefined })} timeScale={20} onTimeScaleChange={vi.fn()} />,
        );
        let labels = canvasContext(canvas(container, '.timeline-labels canvas'));
        expect(labels.fillText).toHaveBeenCalledTimes(2);
        labels.fillText.mockClear();
        rerender(<Timeline session={session({ jobs: jobs.map(j => ({ ...j, endTime: 11000, status: BuildJobStatus.Stopped })) })}
            timeScale={20} onTimeScaleChange={vi.fn()} />);
        labels = canvasContext(canvas(container, '.timeline-labels canvas'));
        expect(labels.fillText).toHaveBeenCalledTimes(2);
    });

    it('shows and clears tooltips using the hovered row, filename, host, status and duration', () => {
        const { container } = render(<Timeline session={session({ jobs: [
            job({ endTime: 6000 }), job({ hostName: 'remote', endTime: 6000 }),
        ] })} timeScale={20} onTimeScaleChange={vi.fn()} />);
        const body = canvas(container, '.timeline-body canvas');
        fireEvent.mouseMove(body, { clientX: 10, clientY: 10 });
        expect(body.title).toBe('file.cpp (local) - Success - 5.0s');
        fireEvent.mouseMove(body, { clientX: 10, clientY: 40 });
        expect(body.title).toBe('file.cpp (remote) - Success - 5.0s');
        fireEvent.mouseMove(body, { clientX: 300, clientY: 40 });
        expect(body.title).toBe('');
        fireEvent.mouseMove(body, { clientX: 10, clientY: 120 });
        expect(body.title).toBe('');
    });

    it('converts viewport hover coordinates into scrolled content coordinates', () => {
        const { container } = render(<Timeline session={session({ jobs: [
            job({ startTime: 11000, endTime: 16000 }),
        ], endTime: 21000 })} timeScale={50} onTimeScaleChange={vi.fn()} />);
        const scroller = container.querySelector<HTMLElement>('.timeline-container')!;
        scroller.scrollLeft = 500;
        const body = canvas(container, '.timeline-body canvas');
        fireEvent.mouseMove(body, { clientX: 10, clientY: 10 });
        expect(body.title).toContain('file.cpp (local)');
    });

    it('zooms only with Ctrl+wheel and clamps scales to 1 through 200', () => {
        const change = vi.fn();
        const { container, rerender } = render(<Timeline timeScale={20} onTimeScaleChange={change} />);
        const scroller = container.querySelector('.timeline-container')!;
        fireEvent.wheel(scroller, { deltaY: -1 });
        expect(change).not.toHaveBeenCalled();
        fireEvent.wheel(scroller, { deltaY: -1, ctrlKey: true });
        expect(change).toHaveBeenLastCalledWith(23);
        fireEvent.wheel(scroller, { deltaY: 1, ctrlKey: true });
        expect(change).toHaveBeenLastCalledWith(20 / 1.15);
        rerender(<Timeline timeScale={200} onTimeScaleChange={change} />);
        fireEvent.wheel(scroller, { deltaY: -1, ctrlKey: true });
        expect(change).toHaveBeenLastCalledWith(200);
        rerender(<Timeline timeScale={1} onTimeScaleChange={change} />);
        fireEvent.wheel(scroller, { deltaY: 1, ctrlKey: true });
        expect(change).toHaveBeenLastCalledWith(1);
    });

    it.each([1, 7, 15, 30, 50])('renders time-axis ticks at scale %i', timeScale => {
        const { container } = render(<Timeline session={session()} timeScale={timeScale} onTimeScaleChange={vi.fn()} />);
        const header = canvasContext(canvas(container, '.timeline-header canvas'));
        expect(header.fillText).toHaveBeenCalledWith('0:00', 0, 16);
    });

    it('keeps large, zoomed timelines viewport-sized and formats hour labels', () => {
        vi.stubGlobal('devicePixelRatio', 2);
        const { container } = render(<Timeline session={session({ endTime: 7201000 })} timeScale={200} onTimeScaleChange={vi.fn()} />);
        const body = canvas(container, '.timeline-body canvas');
        const header = canvas(container, '.timeline-header canvas');
        expect(body.width).toBe(1640);
        expect(header.width).toBe(1640);
        expect(container.querySelector<HTMLElement>('.timeline-body')?.style.width).toBe('1440100px');
        expect(canvasContext(body).setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
        expect(canvasContext(header).fillText.mock.calls.some(([text]) => String(text).startsWith('2:00:'))).toBe(true);
        expect(canvasContext(body).fill).not.toHaveBeenCalled();
    });

    it('stops auto-scroll when the user scrolls back and resumes near the right edge', () => {
        vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(10000);
        const build = session({ endTime: 101000 });
        const { container, rerender } = render(<Timeline session={build} timeScale={20} onTimeScaleChange={vi.fn()} />);
        const scroller = container.querySelector<HTMLElement>('.timeline-container')!;
        expect(scroller.scrollLeft).toBe(1280);
        const body = canvasContext(canvas(container, '.timeline-body canvas'));
        const calls = body.translate.mock.calls.length;
        fireEvent.scroll(scroller);
        expect(body.translate).toHaveBeenCalledTimes(calls);
        scroller.scrollLeft = 50;
        fireEvent.scroll(scroller);
        rerender(<Timeline session={{ ...build, endTime: 201000 }} timeScale={20} onTimeScaleChange={vi.fn()} />);
        expect(scroller.scrollLeft).toBe(50);
        scroller.scrollLeft = 9000;
        fireEvent.scroll(scroller);
        expect(scroller.scrollLeft).toBe(3280);
    });

    it('handles sub-second jobs and job end times beyond the reported session end', () => {
        const { container } = render(<Timeline session={session({ endTime: 1001, jobs: [
            job({ endTime: 1001 }), job({ hostName: 'remote', startTime: 1500, endTime: 61000 }),
        ] })} timeScale={1} onTimeScaleChange={vi.fn()} />);
        const body = canvasContext(canvas(container, '.timeline-body canvas'));
        expect(body.fill).toHaveBeenCalledTimes(2);
        expect(body.fillText).toHaveBeenCalledWith('file.cpp', 3.5, 42);
        expect(body.fillStyle).toBe('#000');
    });

    it('does not draw when the browser cannot provide a canvas context', () => {
        getContext.mockReturnValueOnce(null);
        const { container } = render(<Timeline timeScale={20} onTimeScaleChange={vi.fn()} />);
        expect(canvasContext(canvas(container, '.timeline-body canvas')).fillText).not.toHaveBeenCalled();
    });
});
