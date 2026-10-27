// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.mojang.fastbuildmonitor;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

final class TimelineLayout {
    record CoreRow(String hostName, int coreIndex, List<BuildJob> jobs) {}

    static List<CoreRow> rows(BuildSession session, long now) {
        if (session == null) {
            return List.of();
        }

        Map<String, List<Lane>> hosts = new TreeMap<>(Comparator
                .comparing((String host) -> !host.equalsIgnoreCase("local"))
                .thenComparing(String.CASE_INSENSITIVE_ORDER));
        session.jobs().stream()
                .sorted(Comparator.comparingLong(BuildJob::startTime))
                .forEach(job -> {
                    List<Lane> lanes = hosts.computeIfAbsent(job.hostName(), ignored -> new ArrayList<>());
                    long endTime = job.endTime() == 0 ? now : job.endTime();
                    Lane availableLane = lanes.stream()
                            .filter(lane -> lane.endTime <= job.startTime())
                            .findFirst()
                            .orElse(null);
                    if (availableLane == null) {
                        lanes.add(new Lane(job, endTime));
                    } else {
                        availableLane.jobs.add(job);
                        availableLane.endTime = endTime;
                    }
                });

        List<CoreRow> rows = new ArrayList<>();
        hosts.forEach((host, lanes) -> {
            for (int index = 0; index < lanes.size(); index++) {
                rows.add(new CoreRow(host, index, List.copyOf(lanes.get(index).jobs)));
            }
        });
        return List.copyOf(rows);
    }

    private static final class Lane {
        private final List<BuildJob> jobs = new ArrayList<>();
        private long endTime;

        private Lane(BuildJob job, long endTime) {
            jobs.add(job);
            this.endTime = endTime;
        }
    }

    private TimelineLayout() {}
}
