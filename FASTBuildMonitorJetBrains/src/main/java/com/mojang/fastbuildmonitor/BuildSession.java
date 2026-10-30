// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.mojang.fastbuildmonitor;

import java.util.ArrayList;
import java.util.List;

public record BuildSession(int processId, int logVersion, long startTime,
                           long endTime, double progress, List<BuildJob> jobs,
                           String distributionUnavailableReason) {
    public BuildSession(int processId, int logVersion, long startTime) {
        this(processId, logVersion, startTime, 0, 0, new ArrayList<>(), null);
    }

    public BuildSession withProgress(double progress) {
        return new BuildSession(processId, logVersion, startTime, endTime, progress, jobs,
                distributionUnavailableReason);
    }

    public BuildSession withDistributionUnavailableReason(String reason) {
        return new BuildSession(processId, logVersion, startTime, endTime, progress, jobs, reason);
    }

    public BuildSession finish(long time) {
        jobs.replaceAll(job -> job.status() == BuildJob.Status.BUILDING
                ? job.finish(time, BuildJob.Status.STOPPED, null) : job);
        return new BuildSession(processId, logVersion, startTime, time, 100, jobs, distributionUnavailableReason);
    }

    public BuildSession resume() {
        return new BuildSession(processId, logVersion, startTime, 0, progress, jobs, distributionUnavailableReason);
    }

    public BuildSession copy() {
        return new BuildSession(processId, logVersion, startTime, endTime, progress, List.copyOf(jobs),
                distributionUnavailableReason);
    }
}
