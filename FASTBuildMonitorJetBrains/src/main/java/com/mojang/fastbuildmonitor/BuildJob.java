// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.mojang.fastbuildmonitor;

import java.awt.Color;

public record BuildJob(String hostName, String eventName, long startTime,
                       long endTime, Status status, String message) {
    public enum Status {
        BUILDING("#2196F3"),
        FAILED("#F44336"),
        ERROR("#E91E63"),
        TIMEOUT("#FF9800"),
        STOPPED("#607D8B"),
        SUCCESS("#4CAF50"),
        SUCCESS_CACHED("#8BC34A"),
        SUCCESS_PREPROCESSED("#CDDC39"),
        RACED_OUT("#9E9E9E");

        private final Color color;

        Status(String color) {
            this.color = Color.decode(color);
        }

        public Color getColor() {
            return color;
        }

        @Override
        public String toString() {
            return name().replace('_', ' ');
        }
    }

    public BuildJob(String hostName, String eventName, long startTime) {
        this(hostName, eventName, startTime, 0, Status.BUILDING, null);
    }

    public BuildJob finish(long time, Status result, String message) {
        return new BuildJob(hostName, eventName, startTime, time, result, message);
    }

    public long durationAt(long now) {
        return Math.max(0, (endTime == 0 ? now : endTime) - startTime);
    }

    public boolean failed() {
        return status == Status.FAILED || status == Status.ERROR || status == Status.TIMEOUT;
    }

    public String getDisplayName() {
        int slash = Math.max(eventName.lastIndexOf('/'), eventName.lastIndexOf('\\'));
        return slash >= 0 ? eventName.substring(slash + 1) : eventName;
    }
}
