// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CoreRow } from './coreRows';
import { STATUS_COLORS, getDisplayName, type BuildSession } from './types';

export interface ExportColors {
    background: string;
    altRowBackground: string;
    headerBackground: string;
    border: string;
    rowSeparator: string;
    gridLine: string;
    text: string;
    textDim: string;
    textMuted: string;
}

export interface ViewerData {
    title: string;
    exportedAt: number;
    durationMs: number;
    jobCount: number;
    timeScale: number;
    colors: ExportColors;
    statuses: string[];
    statusColors: string[];
    names: string[];
    // Each row stores its jobs as flat [startMs, endMs, statusIndex, nameIndex] tuples.
    rows: { host: string; core: number; jobs: number[] }[];
}

const LEGACY_COLORS: ExportColors = {
    background: '#1e1e1e',
    altRowBackground: '#252526',
    headerBackground: '#2d2d30',
    border: '#333',
    rowSeparator: '#333',
    gridLine: '#2a2a2a',
    text: '#ccc',
    textDim: '#999',
    textMuted: '#888',
};

function isTransparent(color: string): boolean {
    const value = color.trim().toLowerCase().replace(/\s/g, '');
    return !value || value === 'transparent' || /^#[0-9a-f]{6}00$/.test(value) ||
        /^#[0-9a-f]{3}0$/.test(value) || /^rgba\(.*,0(\.0*)?\)$/.test(value);
}

function opaqueColors(colors: ExportColors): ExportColors {
    const background = isTransparent(colors.background) ? LEGACY_COLORS.background : colors.background;
    const result = { ...colors, background };
    for (const key of Object.keys(LEGACY_COLORS) as (keyof ExportColors)[]) {
        if (isTransparent(result[key])) {
            result[key] = key.endsWith('Background') ? background : LEGACY_COLORS[key];
        }
    }
    return result;
}

export function buildViewerData(
    session: BuildSession,
    coreRows: CoreRow[],
    colors: ExportColors,
    timeScale: number,
    now = Date.now(),
): ViewerData {
    const statuses = Object.keys(STATUS_COLORS);
    const statusColors = Object.values(STATUS_COLORS);
    const statusIndexes = new Map(statuses.map((status, i) => [status, i]));
    const names: string[] = [];
    const nameIndexes = new Map<string, number>();
    let durationMs = (session.endTime ?? now) - session.startTime;
    let jobCount = 0;

    const rows = coreRows.map(row => {
        const jobs: number[] = [];
        for (const job of row.jobs) {
            const start = Math.round(job.startTime - session.startTime);
            const end = Math.round((job.endTime ?? now) - session.startTime);
            let status = statusIndexes.get(job.status);
            if (status === undefined) {
                status = statuses.push(job.status) - 1;
                statusColors.push('#9E9E9E');
                statusIndexes.set(job.status, status);
            }
            const name = getDisplayName(job.eventName);
            let nameIndex = nameIndexes.get(name);
            if (nameIndex === undefined) {
                nameIndex = names.push(name) - 1;
                nameIndexes.set(name, nameIndex);
            }
            jobs.push(start, end, status, nameIndex);
            durationMs = Math.max(durationMs, end);
            jobCount++;
        }
        return { host: row.hostName, core: row.coreIndex, jobs };
    });

    return {
        title: `FASTBuild timeline - PID ${session.processId}`,
        exportedAt: now,
        durationMs: Math.max(1000, durationMs),
        jobCount,
        timeScale,
        colors: opaqueColors(colors),
        statuses,
        statusColors,
        names,
        rows,
    };
}

export function exportTimelineHtml(
    session: BuildSession,
    coreRows: CoreRow[],
    colors: ExportColors,
    timeScale: number,
    now = Date.now(),
): string {
    const data = buildViewerData(session, coreRows, colors, timeScale, now);
    // Escaping "<" keeps job names from closing the data script element.
    const json = JSON.stringify(data)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FASTBuild timeline</title>
<style>
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { display: flex; flex-direction: column; font: 13px sans-serif; overflow: hidden; }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 8px 12px; border-bottom: 1px solid; }
h1 { font-size: 15px; margin: 0; }
#summary { opacity: 0.85; }
#legend { display: flex; flex-wrap: wrap; gap: 4px 12px; flex: 1; }
#legend span { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
#legend i { width: 12px; height: 12px; border-radius: 2px; display: inline-block; }
#controls { display: flex; gap: 4px; }
button { min-width: 30px; height: 28px; border: 1px solid; border-radius: 4px; cursor: pointer; font: inherit; background: transparent; color: inherit; }
main { position: relative; flex: 1; min-height: 0; }
canvas { position: absolute; left: 0; top: 0; display: block; }
#scroller { position: absolute; inset: 0; overflow: auto; outline: none; }
#scroller.dragging { cursor: move; user-select: none; }
#spacer { pointer-events: none; }
</style>
</head>
<body>
<header>
<h1 id="title">FASTBuild timeline</h1>
<span id="summary"></span>
<div id="legend"></div>
<div id="controls">
<button type="button" id="zoom-out" title="Zoom out">&minus;</button>
<button type="button" id="zoom-reset" title="Reset zoom">&#x27F3;</button>
<button type="button" id="zoom-in" title="Zoom in">+</button>
<button type="button" id="zoom-fit" title="Fit the whole build">Fit</button>
</div>
</header>
<main>
<canvas id="chart"></canvas>
<div id="scroller" tabindex="0" role="img" aria-label="Build timeline. Drag to pan, Ctrl+wheel to zoom."><div id="spacer"></div></div>
</main>
<script id="timeline-data" type="application/json">${json}</script>
<script>(${timelineViewer.toString()})(JSON.parse(document.getElementById('timeline-data').textContent));</script>
</body>
</html>
`;
}

// Runs inside the exported page, so it must stay self-contained (no outer references).
export function timelineViewer(data: ViewerData): void {
    const ROW_HEIGHT = 28;
    const LABEL_WIDTH = 180;
    const HEADER_HEIGHT = 32;
    const PAD = 4;
    const RIGHT_PAD = 100;
    const MIN_SCALE = 0.001;
    // Browsers cap element sizes around 33M px, so cap the scrollable width below that.
    const MAX_CONTENT_WIDTH = 30_000_000;
    const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];

    const colors = data.colors;
    const byId = (id: string) => document.getElementById(id) as HTMLElement;
    const canvas = byId('chart') as HTMLCanvasElement;
    const scroller = byId('scroller');
    const spacer = byId('spacer');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const durationSec = data.durationMs / 1000;
    const maxScale = Math.min(200, MAX_CONTENT_WIDTH / durationSec);
    let scale = Math.min(maxScale, Math.max(MIN_SCALE, data.timeScale));
    let pending = false;
    let drag: { id: number; x: number; y: number } | undefined;

    const pad2 = (n: number) => String(n).padStart(2, '0');
    const formatTick = (t: number) => {
        const h = Math.floor(t / 3600);
        const m = Math.floor((t % 3600) / 60);
        const s = Math.floor(t % 60);
        return t >= 3600 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
    };
    const formatDuration = (ms: number) => {
        const s = ms / 1000;
        if (s < 60) return s.toFixed(1) + 's';
        const m = Math.floor(s / 60);
        return m + ':' + (s - m * 60).toFixed(1).padStart(4, '0');
    };

    document.title = data.title;
    document.body.style.background = colors.background;
    document.body.style.color = colors.text;
    const header = document.querySelector('header') as HTMLElement;
    header.style.background = colors.headerBackground;
    header.style.borderColor = colors.border;
    for (const button of document.querySelectorAll('button')) button.style.borderColor = colors.border;
    byId('title').textContent = data.title;
    byId('summary').textContent = `${data.jobCount} jobs - ${formatTick(Math.floor(durationSec))} - exported ${new Date(data.exportedAt).toLocaleString()}`;
    const legend = byId('legend');
    data.statuses.forEach((status, i) => {
        const item = document.createElement('span');
        const swatch = document.createElement('i');
        swatch.style.background = data.statusColors[i];
        item.append(swatch, status);
        legend.append(item);
    });

    const updateExtent = () => {
        spacer.style.width = `${LABEL_WIDTH + Math.ceil(durationSec * scale) + RIGHT_PAD}px`;
        spacer.style.height = `${HEADER_HEIGHT + data.rows.length * ROW_HEIGHT + PAD * 2}px`;
    };

    // Jobs within a core row never overlap and are sorted by start time.
    const firstVisibleJob = (jobs: number[], startMs: number) => {
        let lo = 0;
        let hi = jobs.length / 4;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (jobs[mid * 4] < startMs) lo = mid + 1;
            else hi = mid;
        }
        return Math.max(0, lo - 1);
    };

    const draw = () => {
        pending = false;
        const width = scroller.clientWidth;
        const height = scroller.clientHeight;
        const dpr = window.devicePixelRatio || 1;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const scrollX = scroller.scrollLeft;
        const scrollY = scroller.scrollTop;
        const bodyWidth = Math.max(0, width - LABEL_WIDTH);
        const startSec = scrollX / scale;
        const endSec = (scrollX + bodyWidth) / scale;
        const toX = (sec: number) => LABEL_WIDTH + sec * scale - scrollX;
        const firstRow = Math.max(0, Math.floor(scrollY / ROW_HEIGHT));
        const lastRow = Math.min(data.rows.length - 1, Math.floor((scrollY + height - HEADER_HEIGHT) / ROW_HEIGHT));
        const rowY = (i: number) => HEADER_HEIGHT + i * ROW_HEIGHT - scrollY;

        let step = TICK_STEPS[TICK_STEPS.length - 1];
        for (const candidate of TICK_STEPS) {
            if (candidate * scale >= 70) {
                step = candidate;
                break;
            }
        }
        const ticks: number[] = [];
        for (let t = Math.floor(startSec / step) * step; t <= Math.min(endSec, durationSec); t += step) {
            ticks.push(t);
        }

        ctx.fillStyle = colors.background;
        ctx.fillRect(0, 0, width, height);

        // Body
        ctx.save();
        ctx.beginPath();
        ctx.rect(LABEL_WIDTH, HEADER_HEIGHT, bodyWidth, height - HEADER_HEIGHT);
        ctx.clip();
        for (let i = firstRow; i <= lastRow; i++) {
            const y = rowY(i);
            if (i % 2 === 0) {
                ctx.fillStyle = colors.altRowBackground;
                ctx.fillRect(LABEL_WIDTH, y, bodyWidth, ROW_HEIGHT);
            }
            ctx.strokeStyle = colors.rowSeparator;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(LABEL_WIDTH, y + ROW_HEIGHT - 0.5);
            ctx.lineTo(width, y + ROW_HEIGHT - 0.5);
            ctx.stroke();
        }
        ctx.strokeStyle = colors.gridLine;
        for (const t of ticks) {
            const x = Math.round(toX(t)) + 0.5;
            ctx.beginPath();
            ctx.moveTo(x, HEADER_HEIGHT);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (let i = firstRow; i <= lastRow; i++) {
            const jobs = data.rows[i].jobs;
            const y = rowY(i) + PAD;
            const h = ROW_HEIGHT - PAD * 2;
            for (let j = firstVisibleJob(jobs, startSec * 1000) * 4; j < jobs.length; j += 4) {
                const start = jobs[j] / 1000;
                if (start > endSec) break;
                const duration = Math.max((jobs[j + 1] - jobs[j]) / 1000, 0.1);
                const x = toX(start);
                const w = Math.max(duration * scale, 2);
                if (x + w < LABEL_WIDTH) continue;
                ctx.fillStyle = data.statusColors[jobs[j + 2]];
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(x, y, w, h, 3);
                else ctx.rect(x, y, w, h);
                ctx.fill();
                if (w > 40) {
                    // Black meets 4.5:1 contrast on every status fill.
                    ctx.fillStyle = '#000';
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(x, y, w, h);
                    ctx.clip();
                    ctx.fillText(data.names[jobs[j + 3]], x + 3, y + h / 2);
                    ctx.restore();
                }
            }
        }
        ctx.restore();

        // Time axis
        ctx.fillStyle = colors.headerBackground;
        ctx.fillRect(LABEL_WIDTH, 0, bodyWidth, HEADER_HEIGHT);
        ctx.save();
        ctx.beginPath();
        ctx.rect(LABEL_WIDTH, 0, bodyWidth, HEADER_HEIGHT);
        ctx.clip();
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const t of ticks) {
            const x = toX(t);
            ctx.strokeStyle = colors.border;
            ctx.beginPath();
            ctx.moveTo(x, HEADER_HEIGHT - 8);
            ctx.lineTo(x, HEADER_HEIGHT);
            ctx.stroke();
            ctx.fillStyle = colors.textDim;
            const label = formatTick(t);
            const half = ctx.measureText(label).width / 2;
            ctx.fillText(label, Math.max(x, LABEL_WIDTH + half + 2), HEADER_HEIGHT / 2);
        }
        ctx.restore();

        // Row labels
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, HEADER_HEIGHT, LABEL_WIDTH, height - HEADER_HEIGHT);
        ctx.clip();
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (let i = firstRow; i <= lastRow; i++) {
            const y = rowY(i);
            const row = data.rows[i];
            ctx.fillStyle = i % 2 === 0 ? colors.altRowBackground : colors.background;
            ctx.fillRect(0, y, LABEL_WIDTH, ROW_HEIGHT);
            ctx.strokeStyle = colors.rowSeparator;
            ctx.beginPath();
            ctx.moveTo(0, y + ROW_HEIGHT - 0.5);
            ctx.lineTo(LABEL_WIDTH, y + ROW_HEIGHT - 0.5);
            ctx.stroke();
            ctx.fillStyle = colors.text;
            ctx.fillText(`${row.host} (Core # ${row.core})`, 4, y + ROW_HEIGHT / 2, LABEL_WIDTH - 8);
        }
        ctx.restore();

        // Corner and borders
        ctx.fillStyle = colors.headerBackground;
        ctx.fillRect(0, 0, LABEL_WIDTH, HEADER_HEIGHT);
        ctx.strokeStyle = colors.border;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH - 0.5, 0);
        ctx.lineTo(LABEL_WIDTH - 0.5, height);
        ctx.moveTo(0, HEADER_HEIGHT - 0.5);
        ctx.lineTo(width, HEADER_HEIGHT - 0.5);
        ctx.stroke();
    };

    const requestDraw = () => {
        if (!pending) {
            pending = true;
            requestAnimationFrame(draw);
        }
    };

    // Keeps the time under anchorX (viewport px) fixed while zooming.
    const setScale = (next: number, anchorX = LABEL_WIDTH + (scroller.clientWidth - LABEL_WIDTH) / 2) => {
        const bodyX = Math.max(0, anchorX - LABEL_WIDTH);
        const time = (scroller.scrollLeft + bodyX) / scale;
        scale = Math.min(maxScale, Math.max(MIN_SCALE, next));
        updateExtent();
        scroller.scrollLeft = time * scale - bodyX;
        draw();
    };

    byId('zoom-in').addEventListener('click', () => setScale(scale * 1.5));
    byId('zoom-out').addEventListener('click', () => setScale(scale / 1.5));
    byId('zoom-reset').addEventListener('click', () => setScale(20));
    byId('zoom-fit').addEventListener('click', () => {
        setScale((scroller.clientWidth - LABEL_WIDTH - RIGHT_PAD) / durationSec);
        scroller.scrollLeft = 0;
    });

    scroller.addEventListener('scroll', requestDraw);
    scroller.addEventListener('wheel', e => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        setScale(e.deltaY < 0 ? scale * 1.15 : scale / 1.15, e.clientX - scroller.getBoundingClientRect().left);
    }, { passive: false });

    const endDrag = () => {
        if (!drag) return;
        if (scroller.hasPointerCapture(drag.id)) scroller.releasePointerCapture(drag.id);
        drag = undefined;
        scroller.classList.remove('dragging');
    };
    scroller.addEventListener('pointerdown', e => {
        const rect = scroller.getBoundingClientRect();
        const insideContent = e.clientX - rect.left < scroller.clientWidth && e.clientY - rect.top < scroller.clientHeight;
        if (e.pointerType !== 'mouse' || e.button !== 0 || drag || !insideContent) return;
        e.preventDefault();
        scroller.focus();
        scroller.setPointerCapture(e.pointerId);
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
        scroller.classList.add('dragging');
        scroller.title = '';
    });
    scroller.addEventListener('pointermove', e => {
        if (drag) {
            if (drag.id !== e.pointerId) return;
            if ((e.buttons & 1) === 0) {
                endDrag();
                return;
            }
            scroller.scrollLeft += drag.x - e.clientX;
            scroller.scrollTop += drag.y - e.clientY;
            drag.x = e.clientX;
            drag.y = e.clientY;
            return;
        }
        const rect = scroller.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        let tooltip = '';
        const rowIndex = Math.floor((y - HEADER_HEIGHT + scroller.scrollTop) / ROW_HEIGHT);
        const row = data.rows[rowIndex];
        const rowOffset = (y - HEADER_HEIGHT + scroller.scrollTop) % ROW_HEIGHT;
        if (row && x >= LABEL_WIDTH && y >= HEADER_HEIGHT && rowOffset >= PAD && rowOffset <= ROW_HEIGHT - PAD) {
            const time = (x - LABEL_WIDTH + scroller.scrollLeft) / scale;
            const jobs = row.jobs;
            for (let j = firstVisibleJob(jobs, time * 1000) * 4; j < jobs.length; j += 4) {
                const start = jobs[j] / 1000;
                if (start > time) break;
                const w = Math.max(Math.max((jobs[j + 1] - jobs[j]) / 1000, 0.1) * scale, 2);
                if (time * scale <= start * scale + w) {
                    tooltip = `${data.names[jobs[j + 3]]} (${row.host}) - ${data.statuses[jobs[j + 2]]} - ${formatDuration(jobs[j + 1] - jobs[j])}`;
                }
            }
        }
        scroller.title = tooltip;
    });
    scroller.addEventListener('pointerup', endDrag);
    scroller.addEventListener('pointercancel', endDrag);
    scroller.addEventListener('lostpointercapture', endDrag);
    window.addEventListener('blur', endDrag);

    new ResizeObserver(requestDraw).observe(scroller);
    updateExtent();
    draw();
}
