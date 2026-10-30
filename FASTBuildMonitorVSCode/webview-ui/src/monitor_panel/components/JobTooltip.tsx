// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    BuildJobStatus, STATUS_TEXT_COLORS, formatDuration, getDisplayName,
    type BuildJob, type BuildSession,
} from '../types';

interface JobHover {
    job: BuildJob;
    session: BuildSession;
    x: number;
    y: number;
    coreIndex?: number;
}

function sameJob(a: BuildJob, b: BuildJob): boolean {
    return a.startTime === b.startTime && a.hostName === b.hostName && a.eventName === b.eventName;
}

function sameTarget(a: JobHover | undefined, b: JobHover): boolean {
    return a !== undefined && a.session.processId === b.session.processId &&
        a.session.startTime === b.session.startTime && sameJob(a.job, b.job);
}

export function useJobTooltip(session?: BuildSession) {
    const [hover, setHover] = useState<JobHover>();
    const active = useRef<JobHover>();
    const pending = useRef<JobHover>();
    const showTimer = useRef<number>();
    const hideTimer = useRef<number>();
    const id = useId();
    const cancelShow = useCallback(() => {
        window.clearTimeout(showTimer.current);
        pending.current = undefined;
    }, []);
    const keepOpen = useCallback(() => {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = undefined;
        cancelShow();
    }, [cancelShow]);
    const dismiss = useCallback(() => {
        keepOpen();
        active.current = undefined;
        setHover(undefined);
    }, [keepOpen]);
    const show = useCallback((target: JobHover) => {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = undefined;
        if (sameTarget(active.current, target)) {
            cancelShow();
            return;
        }
        if (sameTarget(pending.current, target)) {
            pending.current = target;
            return;
        }
        cancelShow();
        pending.current = target;
        showTimer.current = window.setTimeout(() => {
            active.current = pending.current;
            pending.current = undefined;
            setHover(active.current);
        }, 350);
    }, [cancelShow]);
    // Allow crossing the gap to select paths and scroll long diagnostics.
    const scheduleDismiss = useCallback(() => {
        cancelShow();
        if (hideTimer.current === undefined) {
            hideTimer.current = window.setTimeout(dismiss, 300);
        }
    }, [dismiss, cancelShow]);

    useEffect(() => {
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') dismiss();
        };
        window.addEventListener('keydown', handleKey);
        window.addEventListener('blur', dismiss);
        return () => {
            keepOpen();
            window.removeEventListener('keydown', handleKey);
            window.removeEventListener('blur', dismiss);
        };
    }, [dismiss, keepOpen]);
    useEffect(dismiss, [dismiss, session?.processId, session?.startTime]);

    return { hover, show, dismiss, scheduleDismiss, keepOpen, id };
}

interface JobTooltipProps {
    hover: JobHover;
    session?: BuildSession;
    id: string;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onShowOutput?: (job: BuildJob) => void;
}

export default function JobTooltip({
    hover, session, id, onMouseEnter, onMouseLeave, onShowOutput,
}: JobTooltipProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [, tick] = useState(0);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    // Snapshots replace objects. Resolve the current event once per snapshot,
    // not on every clock tick, so status/output stay live without scanning jobs.
    const job = useMemo(() =>
        session?.processId === hover.session.processId && session.startTime === hover.session.startTime
            ? session.jobs.find(candidate => sameJob(candidate, hover.job))
            : undefined,
    [session, hover.session, hover.job]);
    const running = job?.status === BuildJobStatus.Building &&
        job.endTime === undefined && session?.endTime === undefined;

    useEffect(() => {
        if (!running) return;
        const timer = window.setInterval(() => tick(value => value + 1), 100);
        return () => window.clearInterval(timer);
    }, [running]);

    const hasJob = job !== undefined;
    useLayoutEffect(() => {
        let anchor: { left: number; top: number } | undefined;
        const place = () => {
            const rect = ref.current?.getBoundingClientRect();
            if (!rect) return;
            const gap = 14;
            const margin = 8;
            // Keep the opening position across live updates; only move enough
            // to stay in the viewport if the card or viewport changes size.
            anchor ??= {
                left: hover.x + gap + rect.width <= window.innerWidth - margin
                    ? hover.x + gap : hover.x - gap - rect.width,
                top: hover.y + gap + rect.height <= window.innerHeight - margin
                    ? hover.y + gap : hover.y - gap - rect.height,
            };
            anchor = {
                left: Math.max(margin, Math.min(anchor.left, window.innerWidth - rect.width - margin)),
                top: Math.max(margin, Math.min(anchor.top, window.innerHeight - rect.height - margin)),
            };
            setPosition(anchor);
        };
        place();
        const observer = new ResizeObserver(place);
        if (ref.current) observer.observe(ref.current);
        window.addEventListener('resize', place);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', place);
        };
    }, [hover, hasJob]);

    if (!job || !session) return;
    const end = job.endTime ?? session.endTime ?? Date.now();
    return createPortal(
        <div
            ref={ref} id={id} className="job-tooltip" role="tooltip" style={position}
            onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
            onWheel={event => event.stopPropagation()}
        >
            <div className="job-tooltip-heading">
                <strong>{getDisplayName(job.eventName)}</strong>
                <span className="job-tooltip-status" style={{ color: STATUS_TEXT_COLORS[job.status] }}>
                    {job.status}
                </span>
            </div>
            <section className="job-tooltip-section">
                <h4>File / Target</h4>
                <div className="job-tooltip-path">{job.eventName}</div>
            </section>
            <section className="job-tooltip-section">
                <h4>Execution</h4>
                <dl>
                    <dt>Host</dt><dd>{job.hostName}</dd>
                    {hover.coreIndex !== undefined && <><dt>Core / Slot</dt><dd>#{hover.coreIndex}</dd></>}
                </dl>
            </section>
            <section className="job-tooltip-section">
                <h4>Timing</h4>
                <dl>
                    <dt>{running ? 'Time Elapsed' : 'Duration'}</dt>
                    <dd>{formatDuration(Math.max(0, end - job.startTime))}</dd>
                    <dt>Start Time (build)</dt>
                    <dd>+{formatDuration(job.startTime - session.startTime)}</dd>
                    <dt>End Time (build)</dt>
                    <dd>{job.endTime !== undefined
                        ? `+${formatDuration(job.endTime - session.startTime)}`
                        : running ? 'In progress' : 'Not reported'}</dd>
                </dl>
            </section>
            {job.message && (
                <section className="job-tooltip-section">
                    <h4>Output / Diagnostics</h4>
                    <pre>{job.message}</pre>
                </section>
            )}
            {onShowOutput && <button type="button" onClick={() => onShowOutput(job)}>Show job output</button>}
        </div>,
        document.body,
    );
}
