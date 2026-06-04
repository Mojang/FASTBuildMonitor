// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { useEffect, useRef, useCallback } from 'react';
import { BuildJob, BuildSession, STATUS_COLORS, getDisplayName, formatDuration } from '../types';

const ROW_HEIGHT = 28;
const LABEL_WIDTH = 180;
const HEADER_HEIGHT = 32;
const PAD = 4;
const MIN_BODY_HEIGHT = 200 - HEADER_HEIGHT;
const RIGHT_PAD = 100;

interface TimelineProps {
    session?: BuildSession;
    timeScale: number;
    onTimeScaleChange: (scale: number) => void;
}

interface CoreRow {
    hostName: string;
    coreIndex: number;
    jobs: BuildJob[];
}

// Assign jobs to virtual "cores" per host via first-fit scheduling, so that
// each row in the timeline represents a single execution slot that runs at
// most one job at a time. The number of cores per host therefore equals the
// peak number of concurrent jobs that ran on that host.
function getCoreRows(session: BuildSession): CoreRow[] {
    const sortedJobs = [...session.jobs].sort((a, b) => a.startTime - b.startTime);

    interface CoreSlot { jobs: BuildJob[]; lastEndTime: number; }
    const hostCores = new Map<string, CoreSlot[]>();
    const displayNameByKey = new Map<string, string>();

    for (const job of sortedJobs) {
        const key = job.hostName.toLowerCase();
        if (!displayNameByKey.has(key)) {
            displayNameByKey.set(key, job.hostName);
        }
        let cores = hostCores.get(key);
        if (!cores) {
            cores = [];
            hostCores.set(key, cores);
        }

        const jobEnd = job.endTime ?? Date.now();
        let assigned = false;
        for (const core of cores) {
            if (core.lastEndTime <= job.startTime) {
                core.jobs.push(job);
                core.lastEndTime = jobEnd;
                assigned = true;
                break;
            }
        }
        if (!assigned) {
            cores.push({ jobs: [job], lastEndTime: jobEnd });
        }
    }

    // Local host first, then remaining hosts alphabetically.
    const hostKeys = Array.from(hostCores.keys()).sort((a, b) => {
        const aLocal = a === 'local';
        const bLocal = b === 'local';
        if (aLocal && !bLocal) return -1;
        if (!aLocal && bLocal) return 1;
        return a.localeCompare(b);
    });

    const rows: CoreRow[] = [];
    for (const key of hostKeys) {
        const cores = hostCores.get(key)!;
        const displayName = displayNameByKey.get(key) || key;
        cores.forEach((core, idx) => {
            rows.push({ hostName: displayName, coreIndex: idx, jobs: core.jobs });
        });
    }
    return rows;
}

function getMaxTime(session: BuildSession): number {
    let max = Date.now();
    if (session.endTime) {
        max = session.endTime;
    }
    for (const j of session.jobs) {
        const t = j.endTime || Date.now();
        if (t > max) max = t;
    }
    return max;
}

function formatMS(totalSec: number): string {
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    return m + ':' + String(s).padStart(2, '0');
}

function formatHMS(totalSec: number): string {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = Math.floor(totalSec % 60);
    return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function drawJob(
    ctx: CanvasRenderingContext2D,
    job: BuildJob,
    startTime: number,
    rowY: number,
    contentWidth: number,
    timeScale: number
) {
    const jobStart = (job.startTime - startTime) / 1000;
    const jobEnd = ((job.endTime || Date.now()) - startTime) / 1000;
    let jobDuration = jobEnd - jobStart;
    if (jobDuration < 0.1) jobDuration = 0.1;

    const x = jobStart * timeScale;
    const w = Math.max(jobDuration * timeScale, 2);
    const y = rowY + PAD;
    const h = ROW_HEIGHT - PAD * 2;

    // Clip to visible
    if (x + w < 0 || x > contentWidth) return;

    const color = STATUS_COLORS[job.status] || '#9E9E9E';
    ctx.fillStyle = color;
    roundRect(ctx, x, y, w, h, 3);
    ctx.fill();

    // Job text if wide enough
    if (w > 40) {
        ctx.fillStyle = '#fff';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const name = getDisplayName(job.eventName);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.fillText(name, x + 3, y + h / 2);
        ctx.restore();
    }
}

function setupCanvas(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    dpr: number
): CanvasRenderingContext2D | undefined {
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
}

export default function Timeline({
    session,
    timeScale,
    onTimeScaleChange,
}: TimelineProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const cornerCanvasRef = useRef<HTMLCanvasElement>(null);
    const headerCanvasRef = useRef<HTMLCanvasElement>(null);
    const labelsCanvasRef = useRef<HTMLCanvasElement>(null);
    const bodyCanvasRef = useRef<HTMLCanvasElement>(null);

    // True while the viewport is scrolled to (or near) the right edge, so new
    // events keep coming into view automatically during a live build.
    const autoScrollRef = useRef(true);

    const draw = useCallback(() => {
        const container = containerRef.current;
        const corner = cornerCanvasRef.current;
        const header = headerCanvasRef.current;
        const labels = labelsCanvasRef.current;
        const body = bodyCanvasRef.current;
        if (!container || !corner || !header || !labels || !body) return;

        const dpr = window.devicePixelRatio || 1;
        const containerWidth = container.clientWidth;
        const viewportContentWidth = Math.max(0, containerWidth - LABEL_WIDTH);
        const coreRows = session ? getCoreRows(session) : [];
        const bodyHeight = Math.max(MIN_BODY_HEIGHT, coreRows.length * ROW_HEIGHT + PAD * 2);

        const startTime = session ? session.startTime : 0;
        const maxTime = session ? getMaxTime(session) : 0;
        let totalSeconds = session ? (maxTime - startTime) / 1000 : 1;
        if (totalSeconds < 1) totalSeconds = 1;
        const contentWidth = Math.max(
            viewportContentWidth,
            Math.ceil(totalSeconds * timeScale + RIGHT_PAD)
        );

        const cornerCtx = setupCanvas(corner, LABEL_WIDTH, HEADER_HEIGHT, dpr);
        const headerCtx = setupCanvas(header, contentWidth, HEADER_HEIGHT, dpr);
        const labelsCtx = setupCanvas(labels, LABEL_WIDTH, bodyHeight, dpr);
        const bodyCtx = setupCanvas(body, contentWidth, bodyHeight, dpr);
        if (!cornerCtx || !headerCtx || !labelsCtx || !bodyCtx) return;

        // ---- Corner (top-left, fixed) ----
        cornerCtx.fillStyle = '#2D2D30';
        cornerCtx.fillRect(0, 0, LABEL_WIDTH, HEADER_HEIGHT);
        cornerCtx.strokeStyle = '#444';
        cornerCtx.lineWidth = 1;
        cornerCtx.beginPath();
        cornerCtx.moveTo(LABEL_WIDTH - 0.5, 0);
        cornerCtx.lineTo(LABEL_WIDTH - 0.5, HEADER_HEIGHT);
        cornerCtx.moveTo(0, HEADER_HEIGHT - 0.5);
        cornerCtx.lineTo(LABEL_WIDTH, HEADER_HEIGHT - 0.5);
        cornerCtx.stroke();

        // ---- Header (time axis, sticky top) ----
        headerCtx.fillStyle = '#2D2D30';
        headerCtx.fillRect(0, 0, contentWidth, HEADER_HEIGHT);
        headerCtx.strokeStyle = '#444';
        headerCtx.lineWidth = 1;
        headerCtx.beginPath();
        headerCtx.moveTo(0, HEADER_HEIGHT - 0.5);
        headerCtx.lineTo(contentWidth, HEADER_HEIGHT - 0.5);
        headerCtx.stroke();

        // ---- Labels column (sticky left) ----
        labelsCtx.fillStyle = '#1E1E1E';
        labelsCtx.fillRect(0, 0, LABEL_WIDTH, bodyHeight);

        // ---- Body (scrolls both axes) ----
        bodyCtx.fillStyle = '#1E1E1E';
        bodyCtx.fillRect(0, 0, contentWidth, bodyHeight);

        if (!session || coreRows.length === 0) {
            bodyCtx.fillStyle = '#888';
            bodyCtx.font = '16px sans-serif';
            bodyCtx.textAlign = 'center';
            bodyCtx.textBaseline = 'middle';
            bodyCtx.fillText(
                'Waiting for FASTBuild data...',
                Math.min(contentWidth, viewportContentWidth) / 2 + container.scrollLeft,
                bodyHeight / 2
            );
            // Labels right border
            labelsCtx.strokeStyle = '#444';
            labelsCtx.beginPath();
            labelsCtx.moveTo(LABEL_WIDTH - 0.5, 0);
            labelsCtx.lineTo(LABEL_WIDTH - 0.5, bodyHeight);
            labelsCtx.stroke();
            return;
        }

        // Time-axis ticks + vertical grid lines
        headerCtx.font = '10px sans-serif';
        headerCtx.textAlign = 'center';
        headerCtx.textBaseline = 'middle';

        let tickInterval = 1;
        if (timeScale < 5) tickInterval = 30;
        else if (timeScale < 10) tickInterval = 10;
        else if (timeScale < 20) tickInterval = 5;
        else if (timeScale < 40) tickInterval = 2;

        for (let t = 0; t <= totalSeconds; t += tickInterval) {
            const x = t * timeScale;
            if (x > contentWidth) break;

            headerCtx.strokeStyle = '#444';
            headerCtx.lineWidth = 1;
            headerCtx.beginPath();
            headerCtx.moveTo(x, HEADER_HEIGHT - 8);
            headerCtx.lineTo(x, HEADER_HEIGHT);
            headerCtx.stroke();

            headerCtx.fillStyle = '#999';
            const label = t >= 3600 ? formatHMS(t) : formatMS(t);
            headerCtx.fillText(label, x, HEADER_HEIGHT / 2);

            bodyCtx.strokeStyle = '#2A2A2A';
            bodyCtx.lineWidth = 1;
            bodyCtx.beginPath();
            bodyCtx.moveTo(x, 0);
            bodyCtx.lineTo(x, bodyHeight);
            bodyCtx.stroke();
        }

        // Core rows (one row per virtual CPU core per host)
        for (let i = 0; i < coreRows.length; i++) {
            const row = coreRows[i];
            const y = i * ROW_HEIGHT;
            const isAlt = i % 2 === 0;

            // Body row background + separator
            if (isAlt) {
                bodyCtx.fillStyle = '#252526';
                bodyCtx.fillRect(0, y, contentWidth, ROW_HEIGHT);
            }
            bodyCtx.strokeStyle = '#333';
            bodyCtx.lineWidth = 1;
            bodyCtx.beginPath();
            bodyCtx.moveTo(0, y + ROW_HEIGHT - 0.5);
            bodyCtx.lineTo(contentWidth, y + ROW_HEIGHT - 0.5);
            bodyCtx.stroke();

            for (const job of row.jobs) {
                drawJob(bodyCtx, job, startTime, y, contentWidth, timeScale);
            }

            // Labels row background + separator + text
            labelsCtx.fillStyle = isAlt ? '#252526' : '#1E1E1E';
            labelsCtx.fillRect(0, y, LABEL_WIDTH, ROW_HEIGHT);
            labelsCtx.strokeStyle = '#333';
            labelsCtx.lineWidth = 1;
            labelsCtx.beginPath();
            labelsCtx.moveTo(0, y + ROW_HEIGHT - 0.5);
            labelsCtx.lineTo(LABEL_WIDTH, y + ROW_HEIGHT - 0.5);
            labelsCtx.stroke();

            labelsCtx.fillStyle = '#CCC';
            labelsCtx.font = '11px sans-serif';
            labelsCtx.textAlign = 'left';
            labelsCtx.textBaseline = 'middle';
            const label = `${row.hostName} (Core # ${row.coreIndex})`;
            labelsCtx.fillText(label, 4, y + ROW_HEIGHT / 2, LABEL_WIDTH - 8);
        }

        // Labels right border
        labelsCtx.strokeStyle = '#444';
        labelsCtx.lineWidth = 1;
        labelsCtx.beginPath();
        labelsCtx.moveTo(LABEL_WIDTH - 0.5, 0);
        labelsCtx.lineTo(LABEL_WIDTH - 0.5, bodyHeight);
        labelsCtx.stroke();

        // Auto-scroll to the right edge while the user is parked at the end
        if (autoScrollRef.current) {
            const desiredScrollLeft = Math.max(0, contentWidth - viewportContentWidth);
            if (Math.abs(container.scrollLeft - desiredScrollLeft) > 1) {
                container.scrollLeft = desiredScrollLeft;
            }
        }
    }, [session, timeScale]);

    useEffect(() => {
        draw();
    }, [draw]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const observer = new ResizeObserver(() => draw());
        observer.observe(container);
        return () => observer.disconnect();
    }, [draw]);

    // Reset auto-scroll when a new build session starts.
    useEffect(() => {
        autoScrollRef.current = true;
    }, [session?.processId, session?.startTime]);

    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        const c = e.currentTarget;
        const maxScroll = c.scrollWidth - c.clientWidth;
        autoScrollRef.current = maxScroll <= 0 || c.scrollLeft >= maxScroll - 5;
    }, []);

    // Allow mouse wheel zoom on the timeline
    const handleWheel = useCallback(
        (e: React.WheelEvent) => {
            if (e.ctrlKey) {
                e.preventDefault();
                if (e.deltaY < 0) {
                    onTimeScaleChange(Math.min(200, timeScale * 1.15));
                } else {
                    onTimeScaleChange(Math.max(1, timeScale / 1.15));
                }
            }
        },
        [timeScale, onTimeScaleChange]
    );

    // Tooltip on body-canvas hover. Coordinates are local to the body canvas;
    // the labels column lives in a separate canvas and is handled independently.
    const handleMouseMove = useCallback(
        (e: React.MouseEvent<HTMLCanvasElement>) => {
            const canvas = bodyCanvasRef.current;
            if (!canvas || !session || !session.jobs.length) return;

            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const coreRows = getCoreRows(session);
            const startTime = session.startTime;

            let tooltipJob: BuildJob | undefined = undefined;

            for (let i = 0; i < coreRows.length; i++) {
                const yTop = i * ROW_HEIGHT + PAD;
                const yBot = i * ROW_HEIGHT + ROW_HEIGHT - PAD;
                if (my < yTop || my > yBot) continue;

                for (const job of coreRows[i].jobs) {
                    const jobStart = (job.startTime - startTime) / 1000;
                    const jobEnd = ((job.endTime || Date.now()) - startTime) / 1000;
                    const x = jobStart * timeScale;
                    const w = Math.max((jobEnd - jobStart) * timeScale, 2);
                    if (mx >= x && mx <= x + w) {
                        tooltipJob = job;
                        break;
                    }
                }
                if (tooltipJob) break;
            }

            if (tooltipJob) {
                const name = getDisplayName(tooltipJob.eventName);
                const dur = formatDuration((tooltipJob.endTime || Date.now()) - tooltipJob.startTime);
                canvas.title = `${name} (${tooltipJob.hostName}) - ${tooltipJob.status} - ${dur}`;
            } else {
                canvas.title = '';
            }
        },
        [session, timeScale]
    );

    return (
        <div
            className="timeline-container"
            ref={containerRef}
            onWheel={handleWheel}
            onScroll={handleScroll}
        >
            <div className="timeline-corner">
                <canvas ref={cornerCanvasRef} />
            </div>
            <div className="timeline-header">
                <canvas ref={headerCanvasRef} />
            </div>
            <div className="timeline-labels">
                <canvas ref={labelsCanvasRef} />
            </div>
            <div className="timeline-body">
                <canvas id="timeline" ref={bodyCanvasRef} onMouseMove={handleMouseMove} />
            </div>
        </div>
    );
}
