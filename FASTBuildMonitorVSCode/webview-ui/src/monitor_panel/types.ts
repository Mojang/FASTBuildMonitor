// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export enum BuildJobStatus {
    Building = 'Building',
    Success = 'Success',
    SuccessCached = 'SuccessCached',
    SuccessPreprocessed = 'SuccessPreprocessed',
    Failed = 'Failed',
    Error = 'Error',
    Timeout = 'Timeout',
    RacedOut = 'RacedOut',
    Stopped = 'Stopped',
}

export interface BuildJob {
    hostName: string;
    eventName: string;
    startTime: number;
    endTime?: number;
    status: BuildJobStatus;
    message?: string;
}

export interface BuildSession {
    processId: number;
    logVersion: number;
    startTime: number;
    endTime?: number;
    jobs: BuildJob[];
    progress: number;
}

export interface WorkerSnapshot {
    hostName: string;
    activeJobs: number;
    totalJobs: number;
    cachedJobs: number;
}

export interface MonitorSnapshot {
    isMonitoring: boolean;
    logPath: string;
    session?: BuildSession;
    workers: WorkerSnapshot[];
    useLegacyColors?: boolean;
}

export const STATUS_COLORS: Record<string, string> = {
    Building: '#2196F3',
    Success: '#4CAF50',
    SuccessCached: '#8BC34A',
    SuccessPreprocessed: '#CDDC39',
    Failed: '#F44336',
    Error: '#E91E63',
    Timeout: '#FF9800',
    RacedOut: '#9E9E9E',
    Stopped: '#607D8B',
};

/**
 * CSS custom-property names the timeline canvas reads at draw time so it picks
 * up the colors resolved from the active VS Code theme (or the legacy scheme
 * when `fbuildMonitor.useLegacyColors` is enabled).
 */
export const TIMELINE_COLORS = {
    background: '--bg',
    altRowBackground: '--bg-alt',
    headerBackground: '--toolbar-bg',
    border: '--border',
    rowSeparator: '--row-separator',
    gridLine: '--grid-line',
    text: '--text',
    textDim: '--text-dim',
    textMuted: '--text-muted',
    textBright: '--text-bright',
} as const;

const COLOR_FALLBACKS: Record<string, string> = {
    '--bg': '#00000000',
    '--bg-alt': '#00000000',
    '--toolbar-bg': '#00000000',
    '--border': '#00000000',
    '--row-separator': '#00000000',
    '--grid-line': '#00000000',
    '--text': '#00000000',
    '--text-dim': '#00000000',
    '--text-muted': '#00000000',
    '--text-bright': '#00000000',
};

/**
 * Resolve a CSS custom property to a concrete color string usable by the canvas
 * 2D context, falling back to the legacy color when the variable is empty.
 */
export function resolveColor(style: CSSStyleDeclaration, varName: string): string {
    const value = style.getPropertyValue(varName).trim();
    return value || COLOR_FALLBACKS[varName] || '#000';
}

export function getDisplayName(eventName: string): string {
    const i = Math.max(eventName.lastIndexOf('/'), eventName.lastIndexOf('\\'));
    return i >= 0 ? eventName.substring(i + 1) : eventName;
}

export function formatDuration(ms: number): string {
    const s = ms / 1000;
    if (s >= 60) {
        const m = Math.floor(s / 60);
        const sec = s - m * 60;
        return m + ':' + sec.toFixed(1).padStart(4, '0');
    }
    return s.toFixed(1) + 's';
}

export function formatElapsed(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
}

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}
