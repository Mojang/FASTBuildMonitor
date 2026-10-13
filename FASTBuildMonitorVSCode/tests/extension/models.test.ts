// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, vi } from 'vitest';
import {
    BuildJobStatus, type BuildSession, formatDuration, getJobDisplayName,
    getJobDurationMs, getStatusColor, sessionActiveJobs, sessionCachedJobs,
    sessionFailedJobs, sessionSuccessJobs, sessionTotalJobs,
} from '../../src/models';

describe('build models', () => {
    it.each([
        ['file.cpp', 'file.cpp'], ['src/file.cpp', 'file.cpp'],
        ['C:\\src\\file.cpp', 'file.cpp'], ['src\\nested/file.cpp', 'file.cpp'], ['', ''],
    ])('extracts the display name from %s', (input, expected) => {
        expect(getJobDisplayName(input)).toBe(expected);
    });

    it.each([[0, '0.0s'], [1234, '1.2s'], [60000, '1:00.0'], [125600, '2:05.6']])(
        'formats %i milliseconds', (input, expected) => expect(formatDuration(input)).toBe(expected),
    );

    it('uses the current time only for unfinished jobs, including a zero end time', () => {
        vi.useFakeTimers();
        vi.setSystemTime(5000);
        const job = { hostName: 'local', eventName: 'a', startTime: -1000, status: BuildJobStatus.Building };
        expect(getJobDurationMs(job)).toBe(6000);
        expect(getJobDurationMs({ ...job, endTime: 0 })).toBe(1000);
        expect(getJobDurationMs({ ...job, endTime: 2000 })).toBe(3000);
    });

    it.each([
        [BuildJobStatus.Building, '#2196F3'], [BuildJobStatus.Success, '#4CAF50'],
        [BuildJobStatus.SuccessCached, '#8BC34A'], [BuildJobStatus.SuccessPreprocessed, '#CDDC39'],
        [BuildJobStatus.Failed, '#F44336'], [BuildJobStatus.Error, '#E91E63'],
        [BuildJobStatus.Timeout, '#FF9800'], [BuildJobStatus.RacedOut, '#9E9E9E'],
        [BuildJobStatus.Stopped, '#607D8B'],
    ])('keeps the %s status color stable', (status, color) => {
        expect(getStatusColor(status)).toBe(color);
    });

    it('counts successful variants, failures, and active jobs independently', () => {
        const session: BuildSession = {
            processId: 1, logVersion: 1, startTime: 0, progress: 0,
            jobs: Object.values(BuildJobStatus).map(status => ({
                status, hostName: 'local', eventName: status, startTime: 0,
            })),
        };
        expect(sessionTotalJobs(session)).toBe(9);
        expect(sessionActiveJobs(session)).toBe(1);
        expect(sessionSuccessJobs(session)).toBe(3);
        expect(sessionCachedJobs(session)).toBe(1);
        expect(sessionFailedJobs(session)).toBe(2);
        session.jobs = [];
        for (const count of [sessionTotalJobs, sessionActiveJobs, sessionSuccessJobs, sessionCachedJobs, sessionFailedJobs]) {
            expect(count(session)).toBe(0);
        }
    });
});
