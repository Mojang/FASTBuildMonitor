// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { useEffect, useRef, useCallback } from 'react';
import { BuildJob, BuildSession, STATUS_COLORS, getDisplayName, formatDuration } from '../types';

const ROW_HEIGHT = 28;
const LABEL_WIDTH = 180;
const HEADER_HEIGHT = 32;
const PAD = 4;

interface TimelineProps {
    session?: BuildSession;
    timeScale: number;
    horizontalOffset: number;
    onHorizontalOffsetChange: (offset: number) => void;
    onTimeScaleChange: (scale: number) => void;
}

function getWorkerNames(session: BuildSession): string[] {
    const seen = new Map<string, string>();
    for (const job of session.jobs) {
        const key = job.hostName.toLowerCase();
        if (!seen.has(key)) {
            seen.set(key, job.hostName);
        }
    }
    return Array.from(seen.values());
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
    viewWidth: number,
    timeScale: number,
    horizontalOffset: number
) {
    const jobStart = (job.startTime - startTime) / 1000;
    const jobEnd = ((job.endTime || Date.now()) - startTime) / 1000;
    let jobDuration = jobEnd - jobStart;
    if (jobDuration < 0.1) jobDuration = 0.1;

    const x = LABEL_WIDTH + jobStart * timeScale - horizontalOffset;
    const w = Math.max(jobDuration * timeScale, 2);
    const y = rowY + PAD;
    const h = ROW_HEIGHT - PAD * 2;

    // Clip to visible
    if (x + w < LABEL_WIDTH || x > viewWidth) return;

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

export default function Timeline({
    session,
    timeScale,
    horizontalOffset,
    onHorizontalOffsetChange,
    onTimeScaleChange,
}: TimelineProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const containerWidth = container.clientWidth;
        const workerNames = session ? getWorkerNames(session) : [];
        const canvasHeight = Math.max(200, HEADER_HEIGHT + workerNames.length * ROW_HEIGHT + PAD * 2);

        canvas.style.width = containerWidth + 'px';
        canvas.style.height = canvasHeight + 'px';
        canvas.width = containerWidth * dpr;
        canvas.height = canvasHeight * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Background
        ctx.fillStyle = '#1E1E1E';
        ctx.fillRect(0, 0, containerWidth, canvasHeight);

        if (!session || workerNames.length === 0) {
            ctx.fillStyle = '#888';
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Waiting for FASTBuild data...', containerWidth / 2, canvasHeight / 2);
            return;
        }

        const startTime = session.startTime;
        const maxTime = getMaxTime(session);
        let totalSeconds = (maxTime - startTime) / 1000;
        if (totalSeconds < 1) totalSeconds = 1;

        // Auto-scroll
        const totalWidth = LABEL_WIDTH + totalSeconds * timeScale + 100;
        if (totalWidth > containerWidth) {
            const newOffset = totalWidth - containerWidth + 100;
            if (Math.abs(newOffset - horizontalOffset) > 1) {
                onHorizontalOffsetChange(newOffset);
            }
        }

        // Time axis header
        ctx.fillStyle = '#2D2D30';
        ctx.fillRect(0, 0, containerWidth, HEADER_HEIGHT);

        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        let tickInterval = 1;
        if (timeScale < 5) tickInterval = 30;
        else if (timeScale < 10) tickInterval = 10;
        else if (timeScale < 20) tickInterval = 5;
        else if (timeScale < 40) tickInterval = 2;

        for (let t = 0; t <= totalSeconds; t += tickInterval) {
            const x = LABEL_WIDTH + t * timeScale - horizontalOffset;
            if (x < LABEL_WIDTH || x > containerWidth) continue;

            ctx.strokeStyle = '#444';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, HEADER_HEIGHT - 8);
            ctx.lineTo(x, HEADER_HEIGHT);
            ctx.stroke();

            ctx.fillStyle = '#999';
            const label = t >= 3600 ? formatHMS(t) : formatMS(t);
            ctx.fillText(label, x, HEADER_HEIGHT / 2);

            // Vertical grid line
            ctx.strokeStyle = '#2A2A2A';
            ctx.beginPath();
            ctx.moveTo(x, HEADER_HEIGHT);
            ctx.lineTo(x, canvasHeight);
            ctx.stroke();
        }

        // Worker rows
        for (let i = 0; i < workerNames.length; i++) {
            const wName = workerNames[i];
            const y = HEADER_HEIGHT + i * ROW_HEIGHT;

            // Alternate background
            if (i % 2 === 0) {
                ctx.fillStyle = '#252526';
                ctx.fillRect(0, y, containerWidth, ROW_HEIGHT);
            }

            // Row separator
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, y + ROW_HEIGHT);
            ctx.lineTo(containerWidth, y + ROW_HEIGHT);
            ctx.stroke();

            // Draw jobs for this worker
            const jobs = session.jobs.filter(
                j => j.hostName.toLowerCase() === wName.toLowerCase()
            );
            for (const job of jobs) {
                drawJob(ctx, job, startTime, y, containerWidth, timeScale, horizontalOffset);
            }

            // Alternate background label
            if (i % 2 === 0) {
                ctx.fillStyle = '#252526';
            } else {
                ctx.fillStyle = '#1E1E1E';
            }
            ctx.fillRect(0, y, LABEL_WIDTH, ROW_HEIGHT);

            // Worker label
            ctx.fillStyle = '#CCC';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(wName, 4, y + ROW_HEIGHT / 2, LABEL_WIDTH - 8);
        }

        // Label column separator
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, 0);
        ctx.lineTo(LABEL_WIDTH, canvasHeight);
        ctx.stroke();
    }, [session, timeScale, horizontalOffset, onHorizontalOffsetChange]);

    useEffect(() => {
        draw();
    }, [draw]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Resize handler
        const observer = new ResizeObserver(() => draw());
        observer.observe(container);
        return () => observer.disconnect();
    }, [draw]);

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

    // Tooltip on canvas hover
    const handleMouseMove = useCallback(
        (e: React.MouseEvent<HTMLCanvasElement>) => {
            const canvas = canvasRef.current;
            if (!canvas || !session || !session.jobs.length) return;

            const rect = canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const mx = (e.clientX - rect.left) * dpr;
            const my = (e.clientY - rect.top) * dpr;
            const workerNames = getWorkerNames(session);
            const startTime = session.startTime;

            let tooltipJob: BuildJob | undefined = undefined;

            for (let i = 0; i < workerNames.length; i++) {
                const yTop = (HEADER_HEIGHT + i * ROW_HEIGHT + PAD) * dpr;
                const yBot = (HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT - PAD) * dpr;
                if (my < yTop || my > yBot) continue;

                const wName = workerNames[i];
                const jobs = session.jobs.filter(
                    j => j.hostName.toLowerCase() === wName.toLowerCase()
                );
                for (const job of jobs) {
                    const jobStart = (job.startTime - startTime) / 1000;
                    const jobEnd = ((job.endTime || Date.now()) - startTime) / 1000;
                    const x = (LABEL_WIDTH + jobStart * timeScale - horizontalOffset) * dpr;
                    const w = Math.max((jobEnd - jobStart) * timeScale * dpr, 2 * dpr);
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
        [session, timeScale, horizontalOffset]
    );

    return (
        <div className="timeline-container" ref={containerRef} onWheel={handleWheel}>
            <canvas id="timeline" ref={canvasRef} onMouseMove={handleMouseMove} />
        </div>
    );
}
