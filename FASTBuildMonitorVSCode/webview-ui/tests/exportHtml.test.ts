// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildViewerData, exportTimelineHtml, timelineViewer, type ExportColors, type ViewerData,
} from '../src/monitor_panel/exportHtml';
import { getCoreRows } from '../src/monitor_panel/coreRows';
import { BuildJobStatus, STATUS_COLORS, type BuildJob } from '../src/monitor_panel/types';
import { job, session } from './fixtures';
import { createCanvasContext, getContext, ResizeObserverMock } from './setup';

const colors: ExportColors = {
    background: '#181818', altRowBackground: '#202020', headerBackground: '#2a2a2a',
    border: '#333', rowSeparator: '#3a3a3a', gridLine: '#444',
    text: '#eee', textDim: '#aaa', textMuted: '#999',
};

function embeddedData(html: string) {
    const match = /<script id="timeline-data" type="application\/json">(.*?)<\/script>/s.exec(html);
    expect(match).toBeTruthy();
    return JSON.parse(match![1]) as ReturnType<typeof buildViewerData>;
}

describe('HTML timeline export', () => {
    it('stores compact rows with millisecond offsets, statuses, colors and shared names', () => {
        const jobs = Object.values(BuildJobStatus).map((status, i) =>
            job({ status, startTime: 1123 + i * 1000, endTime: 1567 + i * 1000 }));
        jobs.push(job({ hostName: 'worker', startTime: 1000, endTime: 5000 }));
        const build = session({ jobs });
        const original = structuredClone(build);
        const data = buildViewerData(build, getCoreRows(build), colors, 35, 99999);
        expect(data.statuses).toEqual(Object.keys(STATUS_COLORS));
        expect(data.statusColors).toEqual(Object.values(STATUS_COLORS));
        expect(data.names).toEqual(['file.cpp']);
        expect(data.rows.map(row => `${row.host}:${row.core}`)).toEqual(['local:0', 'worker:0']);
        expect(data.rows[0].jobs.slice(0, 8)).toEqual([123, 567, 0, 0, 1123, 1567, 1, 0]);
        expect(data.rows[1].jobs).toEqual([0, 4000, 1, 0]);
        expect(data).toMatchObject({
            title: 'FASTBuild timeline - PID 42', jobCount: jobs.length,
            durationMs: 10000, timeScale: 35, exportedAt: 99999, colors,
        });
        expect(build).toEqual(original);
    });

    it('captures running jobs and running builds at the export time', () => {
        const build = session({ endTime: undefined, jobs: [job({ endTime: undefined, status: BuildJobStatus.Building })] });
        const data = buildViewerData(build, getCoreRows(build), colors, 20, 6789);
        expect(data.rows[0].jobs).toEqual([0, 5789, 0, 0]);
        expect(data.durationMs).toBe(5789);
    });

    it('replaces transparent theme colors with opaque fallbacks', () => {
        const data = buildViewerData(session(), getCoreRows(session()), {
            ...colors, background: '#00000000', headerBackground: 'rgba(0, 0, 0, 0)', text: 'transparent',
            altRowBackground: '#0000', border: ' ', gridLine: 'rgba(1, 2, 3, 0.0)',
        }, 20);
        expect(data.colors).toMatchObject({
            background: '#1e1e1e', headerBackground: '#1e1e1e', altRowBackground: '#1e1e1e',
            text: '#ccc', border: '#333', gridLine: '#2a2a2a', textDim: '#aaa',
        });
    });

    it('keeps an opaque theme background for transparent row backgrounds', () => {
        const data = buildViewerData(session(), getCoreRows(session()), { ...colors, altRowBackground: 'transparent' }, 20);
        expect(data.colors.altRowBackground).toBe('#181818');
    });

    it('adds unknown statuses with a neutral color and uses a minimum one-second duration', () => {
        const build = session({ endTime: 1000, jobs: [
            job({ status: 'Mystery' as BuildJob['status'], startTime: 1000, endTime: 1000 }),
            job({ status: 'Mystery' as BuildJob['status'], startTime: 1000, endTime: 1000, hostName: 'other' }),
        ] });
        const data = buildViewerData(build, getCoreRows(build), colors, 20);
        expect(data.statuses.at(-1)).toBe('Mystery');
        expect(data.statuses.filter(status => status === 'Mystery')).toHaveLength(1);
        expect(data.statusColors.at(-1)).toBe('#9E9E9E');
        expect(data.rows.map(row => row.jobs[2])).toEqual([data.statuses.length - 1, data.statuses.length - 1]);
        expect(data.durationMs).toBe(1000);
    });

    it('produces a self-contained page that cannot be broken out of by job names', () => {
        const build = session({ jobs: [job({
            hostName: 'host</script><b>', eventName: 'dir/<!--<script>alert(1)\u2028.cpp',
        })] });
        const html = exportTimelineHtml(build, getCoreRows(build), colors, 20);
        expect(html).toMatch(/^<!DOCTYPE html>/);
        expect(html).toContain("default-src 'none'");
        expect(html).not.toMatch(/\b(src|href)=/);
        expect(html.match(/<\/script>/g)).toHaveLength(2);
        expect(html).not.toContain('<!--');
        expect(html).not.toContain('\u2028');
        const data = embeddedData(html);
        expect(data.rows[0].host).toBe('host</script><b>');
        expect(data.names[0]).toBe('<!--<script>alert(1)\u2028.cpp');
        expect(html).toContain('function timelineViewer(');
    });
});

const viewerData: ViewerData = {
    title: 'FASTBuild timeline - PID 7',
    exportedAt: 0,
    durationMs: 4_000_000,
    jobCount: 4,
    timeScale: 20,
    colors,
    statuses: ['Success', 'Failed'],
    statusColors: ['#4CAF50', '#F44336'],
    names: ['a.cpp', 'b.cpp'],
    rows: [
        { host: 'local', core: 0, jobs: [0, 10_000, 0, 0, 20_000, 20_050, 1, 1, 200_000, 210_000, 0, 1] },
        { host: 'worker', core: 1, jobs: [5000, 80_000, 1, 0] },
    ],
};

type ViewerContext = ReturnType<typeof createCanvasContext> & {
    measureText: ReturnType<typeof vi.fn>;
    roundRect?: ReturnType<typeof vi.fn>;
};

let frames: FrameRequestCallback[];

function mountViewer(data: ViewerData = viewerData, options: { roundRect?: boolean; width?: number } = {}) {
    const page = new DOMParser().parseFromString(exportTimelineHtml(session(), [], colors, 20), 'text/html');
    for (const script of page.querySelectorAll('script')) script.remove();
    document.body.innerHTML = page.body.innerHTML;
    const scroller = document.getElementById('scroller')!;
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: options.width ?? 880 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 400 });
    let captured: number | undefined;
    scroller.setPointerCapture = vi.fn((id: number) => { captured = id; });
    scroller.hasPointerCapture = vi.fn((id: number) => captured === id);
    scroller.releasePointerCapture = vi.fn(() => { captured = undefined; });
    const context: ViewerContext = {
        ...createCanvasContext(),
        measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
        ...(options.roundRect === false ? {} : { roundRect: vi.fn() }),
    };
    getContext.mockReturnValueOnce(context);
    timelineViewer(data);
    const spacer = document.getElementById('spacer')!;
    return { scroller, spacer, context };
}

function pointer(element: EventTarget, type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
    const event = Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...init }), {
        pointerId: init.pointerId ?? 1, pointerType: init.pointerType ?? 'mouse',
    });
    fireEvent(element as Element, event);
    return event;
}

function hover(scroller: HTMLElement, clientX: number, clientY: number) {
    pointer(scroller, 'pointermove', { clientX, clientY, buttons: 0 });
    return scroller.title;
}

function texts(context: ViewerContext) {
    return context.fillText.mock.calls.map(call => call[0] as string);
}

describe('exported HTML viewer', () => {
    beforeEach(() => {
        frames = [];
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => frames.push(callback)));
    });

    it('fills the page header, legend and scroll extent from the export data', () => {
        const { spacer } = mountViewer();
        expect(document.title).toBe('FASTBuild timeline - PID 7');
        expect(document.getElementById('title')).toHaveTextContent('FASTBuild timeline - PID 7');
        expect(document.getElementById('summary')).toHaveTextContent(/^4 jobs - 1:06:40 - exported /);
        const legend = [...document.querySelectorAll('#legend span')];
        expect(legend.map(item => item.textContent)).toEqual(['Success', 'Failed']);
        expect(legend[1].querySelector('i')).toHaveStyle({ background: '#F44336' });
        expect(document.body).toHaveStyle({ background: colors.background, color: colors.text });
        expect(spacer.style.width).toBe(`${180 + 80_000 + 100}px`);
        expect(spacer.style.height).toBe(`${32 + 2 * 28 + 8}px`);
    });

    it('draws visible rows, labels, ticks and only labels bars wide enough for text', () => {
        const { context } = mountViewer();
        expect(context.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
        const labels = texts(context);
        expect(labels).toEqual(expect.arrayContaining(['local (Core # 0)', 'worker (Core # 1)', 'a.cpp', '0:00', '0:05', '0:30']));
        expect(labels).not.toContain('b.cpp');
        expect(context.roundRect).toHaveBeenCalledWith(180, 36, 200, 20, 3);
        expect(context.roundRect).toHaveBeenCalledWith(580, 36, 2, 20, 3);
        expect(context.roundRect).toHaveBeenCalledTimes(3);
        // The first tick label is kept clear of the row label column.
        expect(context.fillText).toHaveBeenCalledWith('0:00', 180 + 12 + 2, 16);
    });

    it('falls back to rectangles and a device pixel ratio of one', () => {
        vi.stubGlobal('devicePixelRatio', 0);
        const { context } = mountViewer(viewerData, { roundRect: false });
        expect(context.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
        expect(context.rect).toHaveBeenCalledWith(180, 36, 200, 20);
    });

    it('scales the canvas for high-density displays', () => {
        vi.stubGlobal('devicePixelRatio', 2);
        mountViewer();
        const canvas = document.getElementById('chart') as HTMLCanvasElement;
        expect([canvas.width, canvas.height]).toEqual([1760, 800]);
        expect(canvas.style.width).toBe('880px');
    });

    it('stops quietly when the canvas has no 2D context', () => {
        document.title = 'unchanged';
        getContext.mockReturnValueOnce(null);
        const page = new DOMParser().parseFromString(exportTimelineHtml(session(), [], colors, 20), 'text/html');
        document.body.innerHTML = page.body.innerHTML;
        timelineViewer(viewerData);
        expect(document.title).toBe('unchanged');
        expect(document.getElementById('legend')).toBeEmptyDOMElement();
    });

    it('coalesces scroll and resize redraws into one animation frame', () => {
        const { scroller, context } = mountViewer();
        scroller.scrollLeft = 500;
        fireEvent.scroll(scroller);
        fireEvent.scroll(scroller);
        ResizeObserverMock.instances.at(-1)!.trigger();
        expect(frames).toHaveLength(1);
        context.roundRect!.mockClear();
        frames[0](0);
        // The 20 s job ends left of the viewport, so it is skipped.
        expect(context.roundRect).not.toHaveBeenCalledWith(80, 36, 2, 20, 3);
        expect(context.roundRect).toHaveBeenCalledWith(-220, 64, 1500, 20, 3);
        fireEvent.scroll(scroller);
        expect(frames).toHaveLength(2);
    });

    it('formats ticks past one hour with hours', () => {
        const { scroller, context } = mountViewer();
        scroller.scrollLeft = 3700 * 20;
        fireEvent.scroll(scroller);
        frames[0](0);
        expect(texts(context)).toContain('1:02:00');
    });

    it('zooms with the toolbar buttons and fits the build in the view', () => {
        const { scroller, spacer } = mountViewer();
        const width = () => Number.parseInt(spacer.style.width);
        fireEvent.click(document.getElementById('zoom-in')!);
        expect(width()).toBe(180 + 120_000 + 100);
        fireEvent.click(document.getElementById('zoom-out')!);
        fireEvent.click(document.getElementById('zoom-out')!);
        expect(width()).toBe(180 + Math.ceil(4000 * 20 / 1.5) + 100);
        fireEvent.click(document.getElementById('zoom-reset')!);
        expect(width()).toBe(180 + 80_000 + 100);
        scroller.scrollLeft = 1000;
        fireEvent.click(document.getElementById('zoom-fit')!);
        expect(width()).toBe(880);
        expect(scroller.scrollLeft).toBe(0);
    });

    it('zooms around the mouse with Ctrl+wheel and ignores plain wheel scrolling', () => {
        const { scroller, spacer } = mountViewer();
        const plain = new WheelEvent('wheel', { deltaY: -100, cancelable: true, clientX: 380 });
        scroller.dispatchEvent(plain);
        expect(plain.defaultPrevented).toBe(false);
        scroller.scrollLeft = 1000;
        const zoomIn = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true, clientX: 380 });
        scroller.dispatchEvent(zoomIn);
        expect(zoomIn.defaultPrevented).toBe(true);
        // The time under the mouse (60 s) stays 200 px into the body.
        expect(scroller.scrollLeft).toBeCloseTo(60 * 23 - 200);
        scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, cancelable: true, clientX: 100 }));
        expect(spacer.style.width).toBe(`${180 + 80_000 + 100}px`);
        expect(scroller.scrollLeft).toBeCloseTo(1180 * 20 / 23);
    });

    it('limits zoom to keep very long builds within browser size limits', () => {
        const { spacer } = mountViewer({ ...viewerData, durationMs: 1e9, timeScale: 200 });
        expect(spacer.style.width).toBe(`${180 + 30_000_000 + 100}px`);
        fireEvent.click(document.getElementById('zoom-in')!);
        expect(spacer.style.width).toBe(`${180 + 30_000_000 + 100}px`);
    });

    it('shows job tooltips over bars only', () => {
        const { scroller } = mountViewer();
        expect(hover(scroller, 280, 46)).toBe('a.cpp (local) - Success - 10.0s');
        expect(hover(scroller, 280, 74)).toBe('a.cpp (worker) - Failed - 1:15.0');
        expect(hover(scroller, 581, 46)).toBe('b.cpp (local) - Failed - 0.1s');
        expect(hover(scroller, 480, 46)).toBe('');
        expect(hover(scroller, 280, 33)).toBe('');
        expect(hover(scroller, 100, 46)).toBe('');
        expect(hover(scroller, 280, 10)).toBe('');
        expect(hover(scroller, 280, 200)).toBe('');
    });

    it('pans while the left button is held and shows the move cursor', () => {
        const { scroller } = mountViewer();
        scroller.title = 'tooltip';
        scroller.scrollLeft = 100;
        scroller.scrollTop = 20;
        const down = pointer(scroller, 'pointerdown', { clientX: 300, clientY: 200 });
        expect(down.defaultPrevented).toBe(true);
        expect(scroller).toHaveClass('dragging');
        expect(document.activeElement).toBe(scroller);
        expect(scroller.setPointerCapture).toHaveBeenCalledWith(1);
        expect(scroller.title).toBe('');
        pointer(scroller, 'pointermove', { clientX: 250, clientY: 190 });
        expect([scroller.scrollLeft, scroller.scrollTop]).toEqual([150, 30]);
        pointer(scroller, 'pointermove', { clientX: 270, clientY: 200 });
        expect([scroller.scrollLeft, scroller.scrollTop]).toEqual([130, 20]);
        expect(scroller.title).toBe('');
        pointer(scroller, 'pointerup', { buttons: 0 });
        expect(scroller).not.toHaveClass('dragging');
        expect(scroller.releasePointerCapture).toHaveBeenCalledWith(1);
        pointer(scroller, 'pointerup', { buttons: 0 });
        expect(scroller.releasePointerCapture).toHaveBeenCalledOnce();
    });

    it('ignores other buttons, touch, scrollbar presses and unrelated pointers', () => {
        const { scroller } = mountViewer();
        pointer(scroller, 'pointerdown', { button: 2 });
        pointer(scroller, 'pointerdown', { pointerType: 'touch' });
        pointer(scroller, 'pointerdown', { clientX: 885, clientY: 10 });
        pointer(scroller, 'pointerdown', { clientX: 10, clientY: 405 });
        expect(scroller.setPointerCapture).not.toHaveBeenCalled();
        pointer(scroller, 'pointerdown', { clientX: 300, clientY: 200 });
        pointer(scroller, 'pointerdown', { pointerId: 2, clientX: 300, clientY: 200 });
        pointer(scroller, 'pointermove', { pointerId: 2, clientX: 100, clientY: 100 });
        expect(scroller.scrollLeft).toBe(0);
        expect(scroller.setPointerCapture).toHaveBeenCalledOnce();
        expect(scroller).toHaveClass('dragging');
    });

    it.each(['pointercancel', 'lostpointercapture', 'blur', 'pointermove'])('ends dragging on %s', type => {
        const { scroller } = mountViewer();
        pointer(scroller, 'pointerdown', { clientX: 300, clientY: 200 });
        if (type === 'blur') fireEvent.blur(window);
        else pointer(scroller, type, { buttons: 0, clientX: 0, clientY: 0 });
        expect(scroller).not.toHaveClass('dragging');
        expect(scroller.releasePointerCapture).toHaveBeenCalledWith(1);
        expect(scroller.scrollLeft).toBe(0);
    });

    it('ends dragging without releasing a capture the browser already dropped', () => {
        const { scroller } = mountViewer();
        pointer(scroller, 'pointerdown', { clientX: 300, clientY: 200 });
        vi.mocked(scroller.hasPointerCapture).mockReturnValue(false);
        pointer(scroller, 'lostpointercapture');
        expect(scroller).not.toHaveClass('dragging');
        expect(scroller.releasePointerCapture).not.toHaveBeenCalled();
    });
});
