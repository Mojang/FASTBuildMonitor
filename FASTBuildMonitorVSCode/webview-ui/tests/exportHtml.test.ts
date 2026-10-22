// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from 'vitest';
import { buildViewerData, exportTimelineHtml, type ExportColors } from '../src/monitor_panel/exportHtml';
import { getCoreRows } from '../src/monitor_panel/coreRows';
import { BuildJobStatus, STATUS_COLORS } from '../src/monitor_panel/types';
import { job, session } from './fixtures';

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
        }, 20);
        expect(data.colors).toMatchObject({ background: '#1e1e1e', headerBackground: '#1e1e1e', text: '#ccc', border: '#333' });
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
