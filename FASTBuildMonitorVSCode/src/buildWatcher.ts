// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter } from 'events';
import { LogWatcher } from './logWatcher';
import { BuildJobStatus } from './models';

// Event argument interfaces matching the C# events
export interface StartBuildEvent {
    time: number;
    logVersion: number;
    processId: number;
}

export interface StopBuildEvent {
    time: number;
}

export interface StartJobEvent {
    time: number;
    hostName: string;
    jobName: string;
}

export interface FinishJobEvent {
    time: number;
    result: BuildJobStatus;
    hostName: string;
    jobName: string;
    message?: string;
}

export interface ReportProgressEvent {
    time: number;
    progress: number;
}

export interface ReportCounterEvent {
    time: number;
    groupName: string;
    counterName: string;
    unitTag: string;
    value: number;
}

const EVENT_TYPE_INDEX = 1;
const EVENT_ARG_START = 2;
const TIME_INDEX = 0;

function tokenize(message: string): string[] {
    const regex = /"[^"]*"|[^ ]+/g;
    const tokens: string[] = [];
    let match: RegExpExecArray | null;
    // eslint-disable-next-line unicorn/no-null
    while ((match = regex.exec(message)) !== null) {
        tokens.push(match[0].replace(/^"|"$/g, ''));
    }
    return tokens;
}

function parseTime(timeStamp: string): number {
    // FASTBuild uses Windows FILETIME (100-nanosecond intervals since 1601-01-01)
    // Convert to JS timestamp (ms since 1970-01-01)
    const filetime = BigInt(timeStamp);
    const epochDiff = BigInt('116444736000000000'); // 100-ns intervals between 1601 and 1970
    const jsTimestamp = Number((filetime - epochDiff) / BigInt(10000));
    return jsTimestamp;
}

function parseBuildJobResult(result: string): BuildJobStatus {
    switch (result) {
        case 'FAILED': return BuildJobStatus.Failed;
        case 'ERROR': return BuildJobStatus.Error;
        case 'SUCCESS':
        case 'SUCCESS_COMPLETE': return BuildJobStatus.Success;
        case 'SUCCESS_CACHED': return BuildJobStatus.SuccessCached;
        case 'SUCCESS_PREPROCESSED': return BuildJobStatus.SuccessPreprocessed;
        case 'TIMEOUT': return BuildJobStatus.Timeout;
        default: return BuildJobStatus.Error;
    }
}

/**
 * Parses FASTBuild log messages and raises typed build events.
 */
export class BuildWatcher extends EventEmitter {
    private readonly logWatcher: LogWatcher;
    private lastMessageTime = 0;

    constructor(customLogPath?: string) {
        super();
        this.logWatcher = new LogWatcher(customLogPath);

        this.logWatcher.on('historyRestorationStarted', () => this.emit('historyRestorationStarted'));
        this.logWatcher.on('historyRestorationEnded', () => this.emit('historyRestorationEnded'));
        this.logWatcher.on('logReceived', (msg: string) => this.processLog(msg));
        this.logWatcher.on('logReset', () => { /* no-op */ });
    }

    public getLogPath(): string {
        return this.logWatcher.getLogPath();
    }

    public getIsRestoringHistory(): boolean {
        return this.logWatcher.getIsRestoringHistory();
    }

    public getLastMessageTime(): number {
        return this.lastMessageTime;
    }

    public start(pollIntervalMs?: number): void {
        this.logWatcher.start(pollIntervalMs);
    }

    public stop(): void {
        this.logWatcher.stop();
    }

    private processLog(message: string): void {
        const tokens = tokenize(message);
        if (tokens.length < 2) {
            return;
        }

        try {
            const eventType = tokens[EVENT_TYPE_INDEX];

            switch (eventType) {
                case 'START_BUILD': {
                    const ev: StartBuildEvent = {
                        time: parseTime(tokens[TIME_INDEX]),
                        logVersion: parseInt(tokens[EVENT_ARG_START], 10),
                        processId: parseInt(tokens[EVENT_ARG_START + 1], 10),
                    };
                    this.lastMessageTime = ev.time;
                    this.emit('sessionStarted', ev);
                    break;
                }
                case 'STOP_BUILD': {
                    const ev: StopBuildEvent = {
                        time: parseTime(tokens[TIME_INDEX]),
                    };
                    this.lastMessageTime = ev.time;
                    this.emit('sessionStopped', ev);
                    break;
                }
                case 'START_JOB': {
                    const ev: StartJobEvent = {
                        time: parseTime(tokens[TIME_INDEX]),
                        hostName: tokens[EVENT_ARG_START],
                        jobName: tokens[EVENT_ARG_START + 1],
                    };
                    this.lastMessageTime = ev.time;
                    this.emit('jobStarted', ev);
                    break;
                }
                case 'FINISH_JOB': {
                    const ev: FinishJobEvent = {
                        time: parseTime(tokens[TIME_INDEX]),
                        result: parseBuildJobResult(tokens[EVENT_ARG_START]),
                        hostName: tokens[EVENT_ARG_START + 1],
                        jobName: tokens[EVENT_ARG_START + 2],
                        message: tokens.length > EVENT_ARG_START + 3
                            ? tokens[EVENT_ARG_START + 3]
                            : undefined,
                    };
                    this.lastMessageTime = ev.time;
                    this.emit('jobFinished', ev);
                    break;
                }
                case 'PROGRESS_STATUS': {
                    const ev: ReportProgressEvent = {
                        time: parseTime(tokens[TIME_INDEX]),
                        progress: parseFloat(tokens[EVENT_ARG_START]),
                    };
                    this.lastMessageTime = ev.time;
                    this.emit('progressChanged', ev);
                    break;
                }
                case 'GRAPH': {
                    const ev: ReportCounterEvent = {
                        time: parseTime(tokens[TIME_INDEX]),
                        groupName: tokens[EVENT_ARG_START],
                        counterName: tokens[EVENT_ARG_START + 1],
                        unitTag: tokens[EVENT_ARG_START + 2],
                        value: parseFloat(tokens[EVENT_ARG_START + 3]),
                    };
                    this.lastMessageTime = ev.time;
                    this.emit('counterReported', ev);
                    break;
                }
            }
        } catch {
            // Ignore parse errors for malformed log lines
        }
    }
}
