// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LogWatcher } from '../../src/logWatcher';

const file = vi.hoisted(() => ({
    text: '', exists: true, directoryExists: true, mtime: 1, locked: false,
}));
const logPath = path.join(os.tmpdir(), 'unit-test-build', 'build.log');

vi.mock('fs', () => ({
    existsSync: vi.fn((name: string) => name.endsWith('build.log') ? file.exists : file.directoryExists),
    mkdirSync: vi.fn(),
    statSync: vi.fn(() => ({ size: Buffer.byteLength(file.text), mtimeMs: file.mtime })),
    openSync: vi.fn(() => {
        if (file.locked) throw new Error('File is locked');
        return 42;
    }),
    readSync: vi.fn((_fd: number, buffer: Buffer, offset: number, length: number, position: number) =>
        Buffer.from(file.text).copy(buffer, offset, position, position + length)),
    closeSync: vi.fn(),
}));

beforeEach(() => {
    Object.assign(file, { text: '', exists: true, directoryExists: true, mtime: 1, locked: false });
    vi.useFakeTimers();
    vi.stubEnv('FASTBUILD_TEMP_PATH', '');
});

describe('log file polling', () => {
    it('uses explicit paths, existing FASTBUILD_TEMP_PATH, or the OS temp directory', () => {
        expect(new LogWatcher(logPath).getLogPath()).toBe(logPath);
        expect(new LogWatcher().getLogPath()).toBe(path.join(os.tmpdir(), 'FASTBuild', 'FastBuildLog.log'));
        const custom = path.join(os.tmpdir(), 'fastbuild-tests');
        vi.stubEnv('FASTBUILD_TEMP_PATH', custom);
        expect(new LogWatcher().getLogPath()).toBe(path.join(custom, 'FASTBuild', 'FastBuildLog.log'));
        file.directoryExists = false;
        expect(new LogWatcher().getLogPath()).toBe(path.join(os.tmpdir(), 'FASTBuild', 'FastBuildLog.log'));
    });

    it('creates a missing directory, waits for a file, and stops polling', () => {
        file.exists = file.directoryExists = false;
        const watcher = new LogWatcher(logPath);
        const received = vi.fn();
        watcher.on('logReceived', received);
        watcher.start(100);
        expect(fs.mkdirSync).toHaveBeenCalledWith(path.dirname(logPath), { recursive: true });
        file.exists = true;
        file.text = 'first\n';
        vi.advanceTimersByTime(100);
        expect(received).toHaveBeenCalledExactlyOnceWith('first');
        watcher.stop();
        watcher.stop();
        file.text += 'second\n';
        vi.advanceTimersByTime(1000);
        expect(received).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('restores history in order and handles CRLF, blank lines, UTF-8 and partial messages', () => {
        file.text = 'first\r\n\ncaf\u00e9\npart';
        const watcher = new LogWatcher(logPath);
        const events: string[] = [];
        watcher.on('historyRestorationStarted', () => {
            expect(watcher.getIsRestoringHistory()).toBe(true);
            events.push('start');
        });
        watcher.on('logReceived', (message: string) => events.push(message));
        watcher.on('historyRestorationEnded', () => events.push('end'));
        watcher.start();
        expect(events).toEqual(['start', 'first', 'caf\u00e9', 'end']);
        expect(watcher.getIsRestoringHistory()).toBe(false);
        file.text += 'ial\n';
        vi.advanceTimersByTime(500);
        expect(events.at(-1)).toBe('partial');
        vi.advanceTimersByTime(500);
        expect(events).toHaveLength(5);
        expect(fs.closeSync).toHaveBeenCalledTimes(2);
        watcher.stop();
    });

    it('ends restoration for an empty file without opening it', () => {
        const watcher = new LogWatcher(logPath);
        const ended = vi.fn();
        watcher.on('historyRestorationEnded', ended);
        watcher.start();
        expect(ended).toHaveBeenCalledOnce();
        expect(watcher.getIsRestoringHistory()).toBe(false);
        expect(fs.openSync).not.toHaveBeenCalled();
        watcher.stop();
    });

    it('detects truncation and reads the replacement from the beginning', () => {
        file.text = 'long first line\n';
        const watcher = new LogWatcher(logPath);
        const reset = vi.fn();
        const received = vi.fn();
        watcher.on('logReset', reset);
        watcher.on('logReceived', received);
        watcher.start();
        file.text = 'new\n';
        file.mtime++;
        vi.advanceTimersByTime(500);
        expect(reset).toHaveBeenCalledOnce();
        expect(received.mock.calls).toEqual([['long first line'], ['new']]);
        watcher.stop();
    });

    it('retries locked files and resumes when a deleted file is recreated', () => {
        file.locked = true;
        file.text = 'retry\n';
        const watcher = new LogWatcher(logPath);
        const received = vi.fn();
        watcher.on('logReceived', received);
        watcher.start();
        expect(received).not.toHaveBeenCalled();
        file.locked = false;
        vi.advanceTimersByTime(500);
        expect(received).toHaveBeenCalledWith('retry');
        file.exists = false;
        vi.advanceTimersByTime(500);
        file.exists = true;
        file.text = 'recreated\n';
        vi.advanceTimersByTime(500);
        expect(received).toHaveBeenLastCalledWith('recreated');
        watcher.stop();
    });

    it('closes an opened file even if reading throws', () => {
        file.text = 'retry\n';
        vi.mocked(fs.readSync).mockImplementationOnce(() => { throw new Error('Read failed'); });
        const watcher = new LogWatcher(logPath);
        const received = vi.fn();
        watcher.on('logReceived', received);
        watcher.start();
        expect(fs.closeSync).toHaveBeenCalledWith(42);
        vi.advanceTimersByTime(500);
        expect(received).toHaveBeenCalledWith('retry');
        watcher.stop();
    });
});
