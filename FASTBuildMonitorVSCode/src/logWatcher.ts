// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';

/**
 * Watches the FASTBuild log file for new entries.
 * Reads %TEMP%\FASTBuild\FastBuildLog.log (or FASTBUILD_TEMP_PATH).
 */
export class LogWatcher extends EventEmitter {
    private readonly logPath: string;
    private fileStreamPosition = 0;
    private currentFileTime = 0;
    private messageBuffer = '';
    private timer: ReturnType<typeof setInterval> | undefined;
    private isRestoringHistory = false;

    constructor(customLogPath?: string) {
        super();

        if (customLogPath && customLogPath.length > 0) {
            this.logPath = customLogPath;
        } else {
            let basePath = os.tmpdir();
            const fastbuildTempPath = process.env['FASTBUILD_TEMP_PATH'];
            if (fastbuildTempPath && fs.existsSync(fastbuildTempPath)) {
                basePath = fastbuildTempPath;
            }
            this.logPath = path.join(basePath, 'FASTBuild', 'FastBuildLog.log');
        }
    }

    public getLogPath(): string {
        return this.logPath;
    }

    public getIsRestoringHistory(): boolean {
        return this.isRestoringHistory;
    }

    public start(pollIntervalMs = 500): void {
        const logDir = path.dirname(this.logPath);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        if (fs.existsSync(this.logPath)) {
            this.isRestoringHistory = true;
            this.emit('historyRestorationStarted');
        }

        this.fileStreamPosition = 0;
        this.timer = setInterval(() => this.readLogs(), pollIntervalMs);
        // Do an immediate first read
        this.readLogs();
    }

    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    private readLogs(): void {
        try {
            if (!fs.existsSync(this.logPath)) {
                this.fileStreamPosition = 0;
                return;
            }

            const stat = fs.statSync(this.logPath);
            const fileTime = stat.mtimeMs;

            if (fileTime !== this.currentFileTime && stat.size < this.fileStreamPosition) {
                // Log file was reset
                this.fileStreamPosition = 0;
                this.emit('logReset');
                this.currentFileTime = fileTime;
            }

            const bytesToRead = stat.size - this.fileStreamPosition;
            if (bytesToRead <= 0) {
                if (this.isRestoringHistory) {
                    this.isRestoringHistory = false;
                    this.emit('historyRestorationEnded');
                }
                return;
            }

            const fd = fs.openSync(this.logPath, 'r');
            try {
                const buffer = Buffer.alloc(bytesToRead);
                fs.readSync(fd, buffer, 0, bytesToRead, this.fileStreamPosition);
                this.fileStreamPosition += bytesToRead;

                const text = buffer.toString('utf-8');
                for (const ch of text) {
                    if (ch === '\n') {
                        this.flushMessage();
                        continue;
                    }
                    if (ch !== '\r') {
                        this.messageBuffer += ch;
                    }
                }
            } finally {
                fs.closeSync(fd);
            }

            if (this.isRestoringHistory) {
                this.isRestoringHistory = false;
                this.emit('historyRestorationEnded');
            }
        } catch {
            // File may be in use, retry next tick
        }
    }

    private flushMessage(): void {
        if (this.messageBuffer.length > 0) {
            this.emit('logReceived', this.messageBuffer);
            this.messageBuffer = '';
        }
    }
}
