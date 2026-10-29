// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.mojang.fastbuildmonitor;

import java.util.Map;

public record BuildSnapshot(
        boolean monitoring,
        String logPath,
        String message,
        BuildSession session,
        Map<String, WorkerSnapshot> workers
) {
    public record WorkerSnapshot(String hostName, int activeJobs, int totalJobs) {
        WorkerSnapshot add(BuildJob job) {
            return new WorkerSnapshot(hostName,
                    activeJobs + (job.status() == BuildJob.Status.BUILDING ? 1 : 0), totalJobs + 1);
        }
    }

    public static BuildSnapshot empty(boolean monitoring, String path, String message) {
        return new BuildSnapshot(monitoring, path, message, null, Map.of());
    }
}
