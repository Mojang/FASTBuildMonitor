// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.mojang.fastbuildmonitor;

import java.math.BigInteger;
import java.util.List;
import java.util.regex.Pattern;

final class FastBuildLogParser {
    private static final Pattern TOKEN = Pattern.compile("\"([^\"]*)\"|(\\S+)");
    private static final BigInteger FILETIME_EPOCH_OFFSET = new BigInteger("116444736000000000");

    interface Events {
        void startBuild(long time, int logVersion, int processId);
        void stopBuild(long time);
        void startJob(long time, String host, String name);
        void finishJob(long time, BuildJob.Status status, String host, String name, String message);
        void progress(long time, double value);
        void distributionUnavailable(long time, String reason);
    }

    static void parse(String line, Events events) {
        List<String> tokens = TOKEN.matcher(line).results()
                .map(match -> match.group(1) == null ? match.group(2) : match.group(1)).toList();
        if (tokens.size() < 2) {
            return;
        }

        try {
            long time = filetimeToEpochMillis(tokens.get(0));
            switch (tokens.get(1)) {
                case "START_BUILD" -> {
                    if (tokens.size() >= 4) {
                        events.startBuild(time, Integer.parseInt(tokens.get(2)), Integer.parseInt(tokens.get(3)));
                    }
                }
                case "STOP_BUILD" -> events.stopBuild(time);
                case "START_JOB" -> {
                    if (tokens.size() >= 4) {
                        events.startJob(time, tokens.get(2), tokens.get(3));
                    }
                }
                case "FINISH_JOB" -> {
                    if (tokens.size() >= 5) {
                        events.finishJob(
                                time,
                                parseStatus(tokens.get(2)),
                                tokens.get(3),
                                tokens.get(4),
                                tokens.size() > 5 ? tokens.get(5).replace('\f', '\n') : null
                        );
                    }
                }
                case "PROGRESS_STATUS" -> {
                    if (tokens.size() >= 3) {
                        events.progress(time, Double.parseDouble(tokens.get(2)));
                    }
                }
                case "DISTRIBUTION_UNAVAILABLE" -> {
                    if (tokens.size() >= 3) {
                        events.distributionUnavailable(time, tokens.get(2).replace('\f', '\n'));
                    }
                }
                default -> {
                }
            }
        } catch (NumberFormatException | ArithmeticException ignored) {
        }
    }

    static long filetimeToEpochMillis(String filetime) {
        return new BigInteger(filetime).subtract(FILETIME_EPOCH_OFFSET)
                .divide(BigInteger.valueOf(10_000)).longValueExact();
    }

    private static BuildJob.Status parseStatus(String result) {
        return switch (result) {
            case "FAILED" -> BuildJob.Status.FAILED;
            case "ERROR" -> BuildJob.Status.ERROR;
            case "SUCCESS", "SUCCESS_COMPLETE" -> BuildJob.Status.SUCCESS;
            case "SUCCESS_CACHED" -> BuildJob.Status.SUCCESS_CACHED;
            case "SUCCESS_PREPROCESSED" -> BuildJob.Status.SUCCESS_PREPROCESSED;
            case "TIMEOUT" -> BuildJob.Status.TIMEOUT;
            default -> BuildJob.Status.ERROR;
        };
    }

    private FastBuildLogParser() {}
}
