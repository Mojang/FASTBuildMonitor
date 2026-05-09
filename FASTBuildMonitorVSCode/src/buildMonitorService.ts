// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter } from "events";
import {
  BuildWatcher,
  StartBuildEvent,
  StopBuildEvent,
  StartJobEvent,
  FinishJobEvent,
  ReportProgressEvent,
} from "./buildWatcher";
import { BuildJob, BuildJobStatus, BuildSession, WorkerInfo } from "./models";
import { Logger } from "./utilities/logger";

/**
 * Service that tracks build state from FASTBuild log events.
 * Emits: 'sessionStarted', 'sessionStopped', 'jobStarted', 'jobFinished', 'progressChanged', 'stateChanged'
 */
export class BuildMonitorService extends EventEmitter {
  private readonly watcher: BuildWatcher;
  private readonly sessions: BuildSession[] = [];
  private readonly workers = new Map<string, WorkerInfo>();
  private currentSession: BuildSession | undefined;
  private monitoring = false;

  constructor(private logger: Logger, customLogPath?: string) {
    super();
    this.watcher = new BuildWatcher(customLogPath);

    this.watcher.on("sessionStarted", (e: StartBuildEvent) =>
      this.onSessionStarted(e),
    );
    this.watcher.on("sessionStopped", (e: StopBuildEvent) =>
      this.onSessionStopped(e),
    );
    this.watcher.on("jobStarted", (e: StartJobEvent) => this.onJobStarted(e));
    this.watcher.on("jobFinished", (e: FinishJobEvent) =>
      this.onJobFinished(e),
    );
    this.watcher.on("progressChanged", (e: ReportProgressEvent) =>
      this.onProgressChanged(e),
    );
  }

  public getLogPath(): string {
    return this.watcher.getLogPath();
  }

  public getCurrentSession(): BuildSession | undefined {
    return this.currentSession;
  }

  public getSessions(): ReadonlyArray<BuildSession> {
    return this.sessions;
  }

  public getWorkers(): ReadonlyMap<string, WorkerInfo> {
    return this.workers;
  }

  public isMonitoring(): boolean {
    return this.monitoring;
  }

  public start(pollIntervalMs?: number): void {
    if (this.monitoring) {
      return;
    }
    this.logger.info("Starting build monitoring...");
    this.monitoring = true;
    this.watcher.start(pollIntervalMs);
    this.emit("stateChanged");
  }

  public stop(): void {
    if (!this.monitoring) {
      return;
    }
    this.logger.info("Stopping build monitoring...");
    this.monitoring = false;
    this.watcher.stop();
    this.emit("stateChanged");
  }

  /** Get a serializable snapshot of the current state for the webview */
  public getSnapshot(): MonitorSnapshot {
    const session = this.currentSession;
    return {
      isMonitoring: this.monitoring,
      logPath: this.watcher.getLogPath(),
      session: session,
      workers: Array.from(this.workers.values()).map((w) => ({
        hostName: w.hostName,
        activeJobs: w.jobs.filter((j) => j.status === BuildJobStatus.Building)
          .length,
        totalJobs: w.jobs.length,
        cachedJobs: w.jobs.filter(
          (j) => j.status === BuildJobStatus.SuccessCached,
        ).length,
      })),
    };
  }

  private onSessionStarted(e: StartBuildEvent): void {
    const session: BuildSession = {
      processId: e.processId,
      logVersion: e.logVersion,
      startTime: e.time,
      endTime: undefined,
      jobs: [],
      progress: 0,
    };

    this.currentSession = session;
    this.sessions.push(session);
    this.workers.clear();

    this.emit("sessionStarted", session);
    this.emit("stateChanged");
  }

  private onSessionStopped(e: StopBuildEvent): void {
    if (this.currentSession) {
      this.currentSession.endTime = e.time;

      // Mark still-building jobs as stopped
      for (const job of this.currentSession.jobs) {
        if (job.status === BuildJobStatus.Building) {
          job.status = BuildJobStatus.Stopped;
          job.endTime = e.time;
        }
      }

      this.emit("sessionStopped", this.currentSession);
      this.emit("stateChanged");
    }
  }

  private onJobStarted(e: StartJobEvent): void {
    if (!this.currentSession) {
      return;
    }

    const job: BuildJob = {
      hostName: e.hostName,
      eventName: e.jobName,
      startTime: e.time,
      status: BuildJobStatus.Building,
    };

    this.currentSession.endTime = undefined; // Clear end time if new job starts after session end (can happen with multiple sessions)
    this.currentSession.jobs.push(job);
    this.getOrCreateWorker(e.hostName).jobs.push(job);

    this.emit("jobStarted", job);
    this.emit("stateChanged");
  }

  private onJobFinished(e: FinishJobEvent): void {
    if (!this.currentSession) {
      return;
    }

    // Find matching active job (last one with same name/host still building)
    for (let i = this.currentSession.jobs.length - 1; i >= 0; i--) {
      const job = this.currentSession.jobs[i];
      if (
        job.eventName === e.jobName &&
        job.hostName.toLowerCase() === e.hostName.toLowerCase() &&
        job.status === BuildJobStatus.Building
      ) {
        job.endTime = e.time;
        job.status = e.result;
        job.message = e.message;

        this.emit("jobFinished", job);
        this.emit("stateChanged");
        return;
      }
    }
  }

  private onProgressChanged(e: ReportProgressEvent): void {
    if (this.currentSession) {
      this.currentSession.progress = e.progress;
    }
    this.emit("progressChanged", e.progress);
    this.emit("stateChanged");
  }

  private getOrCreateWorker(hostName: string): WorkerInfo {
    const key = hostName.toLowerCase();
    let worker = this.workers.get(key);
    if (!worker) {
      worker = { hostName, jobs: [] };
      this.workers.set(key, worker);
    }
    return worker;
  }
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
}
