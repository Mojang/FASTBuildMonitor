// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.mojang.fastbuildmonitor;

import com.intellij.notification.NotificationAction;
import com.intellij.notification.NotificationGroupManager;
import com.intellij.notification.NotificationType;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.text.StringUtil;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowManager;
import com.intellij.util.concurrency.AppExecutorUtil;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeSet;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

public final class BuildMonitorService implements Disposable {
    private static final Logger LOG = Logger.getInstance(BuildMonitorService.class);
    private final Project project;
    private final ScheduledExecutorService executor =
            AppExecutorUtil.createBoundedScheduledExecutorService("FASTBuild log monitor", 1);
    private final List<Consumer<BuildSnapshot>> listeners = new CopyOnWriteArrayList<>();
    private final ByteArrayOutputStream partialLine = new ByteArrayOutputStream();
    private final ByteBuffer buffer = ByteBuffer.allocate(8192);
    private volatile BuildSnapshot snapshot;
    private volatile boolean monitoring;
    private ScheduledFuture<?> pollingTask;
    private FileChannel channel;
    private Path activePath;
    private BasicFileAttributes activeAttributes;
    private long filePosition;
    private BuildSession currentSession;
    // Events read while catching up on an existing log are history, so they don't raise notifications.
    private boolean restoringHistory;
    // Re-reading a log replays its builds, so remember which build already reported unavailable distribution.
    private String distributionUnavailableBuild;

    public BuildMonitorService(Project project) {
        this.project = project;
        snapshot = BuildSnapshot.empty(false, resolveLogPath(), "Monitoring stopped");
    }

    public void addListener(Consumer<BuildSnapshot> listener) {
        listeners.add(listener);
        listener.accept(snapshot);
    }

    public void removeListener(Consumer<BuildSnapshot> listener) {
        listeners.remove(listener);
    }

    public BuildSnapshot getSnapshot() {
        return snapshot;
    }

    public synchronized void settingsChanged() {
        if (!snapshot.logPath().equals(resolveLogPath())) {
            closeChannel();
            currentSession = null;
            restoringHistory = true;
        }
        if (monitoring) {
            pollingTask.cancel(false);
            schedulePolling();
        }
        publish(monitoring ? "Looking for FASTBuild log" : "Monitoring stopped");
    }

    public synchronized void start() {
        if (monitoring) {
            return;
        }
        monitoring = true;
        restoringHistory = true;
        publish("Looking for FASTBuild log");
        schedulePolling();
    }

    private void schedulePolling() {
        pollingTask = executor.scheduleWithFixedDelay(
                this::pollSafely, 0, settings().getPollIntervalMs(), TimeUnit.MILLISECONDS);
    }

    public synchronized void stop() {
        monitoring = false;
        if (pollingTask != null) {
            pollingTask.cancel(false);
            pollingTask = null;
        }
        closeChannel();
        publish("Monitoring stopped");
    }

    @Override
    public void dispose() {
        monitoring = false;
        executor.shutdownNow();
        closeChannel();
        listeners.clear();
    }

    private synchronized void pollSafely() {
        if (!monitoring) {
            return;
        }
        try {
            poll();
            restoringHistory = false;
        } catch (IOException | RuntimeException exception) {
            LOG.warn("Unable to read FASTBuild monitor log", exception);
            publish("Unable to read log: " + exception.getMessage());
        }
    }

    private void poll() throws IOException {
        Path path = Path.of(resolveLogPath());
        BasicFileAttributes attributes;
        try {
            attributes = Files.readAttributes(path, BasicFileAttributes.class);
        } catch (NoSuchFileException exception) {
            closeChannel();
            publish("Waiting for FASTBuild log");
            return;
        }
        if (!attributes.isRegularFile()) {
            closeChannel();
            publish("Waiting for FASTBuild log");
            return;
        }
        if (!path.equals(activePath) || channel == null
                || !Objects.equals(activeAttributes.fileKey(), attributes.fileKey())
                || !activeAttributes.creationTime().equals(attributes.creationTime())
                // Windows may expose no file key and preserve creation time when replacing a file.
                || (attributes.fileKey() == null && (attributes.size() != channel.size()
                || (attributes.size() <= filePosition
                && !activeAttributes.lastModifiedTime().equals(attributes.lastModifiedTime()))))) {
            open(path);
        }
        activeAttributes = attributes;

        long size = channel.size();
        if (size < filePosition) {
            filePosition = 0;
            partialLine.reset();
            channel.position(0);
        }
        if (size == filePosition) {
            publish("Monitoring " + path);
            return;
        }

        channel.position(filePosition);
        buffer.clear();
        int bytesRead;
        while ((bytesRead = channel.read(buffer)) > 0) {
            filePosition += bytesRead;
            buffer.flip();
            while (buffer.hasRemaining()) {
                byte value = buffer.get();
                if (value == '\n') {
                    String line = partialLine.toString(StandardCharsets.UTF_8).stripTrailing();
                    partialLine.reset();
                    FastBuildLogParser.parse(line, events);
                } else {
                    partialLine.write(value);
                }
            }
            buffer.clear();
        }
        publish("Monitoring " + path);
    }

    private void open(Path path) throws IOException {
        closeChannel();
        channel = FileChannel.open(path, StandardOpenOption.READ);
        activePath = path;
        filePosition = 0;
        partialLine.reset();
        currentSession = null;
    }

    private final FastBuildLogParser.Events events = new FastBuildLogParser.Events() {
        @Override
        public void startBuild(long time, int logVersion, int processId) {
            currentSession = new BuildSession(processId, logVersion, time);
        }

        @Override
        public void stopBuild(long time) {
            if (currentSession != null) {
                currentSession = currentSession.finish(time);
            }
        }

        @Override
        public void startJob(long time, String host, String name) {
            if (currentSession == null) {
                return;
            }
            if (currentSession.endTime() != 0) {
                currentSession = currentSession.resume();
            }
            // FASTBuild keeps retrying workers, so a remote job means distribution has recovered.
            if (currentSession.distributionUnavailableReason() != null && !host.equalsIgnoreCase("local")) {
                currentSession = currentSession.withDistributionUnavailableReason(null);
            }
            currentSession.jobs().add(new BuildJob(host, name, time));
        }

        @Override
        public void finishJob(long time, BuildJob.Status status, String host, String name, String message) {
            if (currentSession == null) {
                return;
            }
            List<BuildJob> jobs = currentSession.jobs();
            var finishedHosts = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
            for (int index = jobs.size() - 1; index >= 0; index--) {
                BuildJob job = jobs.get(index);
                boolean sameHost = job.hostName().equalsIgnoreCase(host);
                if (job.eventName().equals(name) && job.status() == BuildJob.Status.BUILDING
                        && (sameHost || status != BuildJob.Status.TIMEOUT)
                        && finishedHosts.add(job.hostName())) {
                    jobs.set(index, job.finish(time,
                            sameHost ? status : BuildJob.Status.RACED_OUT, sameHost ? message : null));
                }
            }
        }

        @Override
        public void progress(long time, double value) {
            if (currentSession != null && Double.isFinite(value)) {
                currentSession = currentSession.withProgress(value);
            }
        }

        @Override
        public void distributionUnavailable(long time, String reason) {
            if (currentSession == null) {
                return;
            }
            currentSession = currentSession.withDistributionUnavailableReason(reason);
            String build = currentSession.processId() + "@" + currentSession.startTime();
            if (!build.equals(distributionUnavailableBuild)) {
                distributionUnavailableBuild = build;
                if (!restoringHistory) {
                    notifyDistributionUnavailable(reason);
                }
            }
        }
    };

    static String distributionUnavailableMessage(String reason) {
        return ("Distributed compilation is unavailable. " + reason).stripTrailing();
    }

    private void notifyDistributionUnavailable(String reason) {
        NotificationGroupManager.getInstance().getNotificationGroup("FASTBuild Monitor")
                .createNotification("FASTBuild Monitor",
                        StringUtil.escapeXmlEntities(distributionUnavailableMessage(reason)).replace("\n", "<br>"),
                        NotificationType.WARNING)
                .addAction(NotificationAction.createSimpleExpiring("Show Monitor", () -> {
                    ToolWindow toolWindow = ToolWindowManager.getInstance(project).getToolWindow("FASTBuild Monitor");
                    if (toolWindow != null) {
                        toolWindow.activate(null);
                    }
                }))
                .notify(project);
    }

    private void publish(String message) {
        String path = resolveLogPath();
        Map<String, BuildSnapshot.WorkerSnapshot> workers = new java.util.TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        if (currentSession != null) {
            for (BuildJob job : currentSession.jobs()) {
                workers.compute(job.hostName(), (host, worker) ->
                        (worker == null ? new BuildSnapshot.WorkerSnapshot(host, 0, 0) : worker).add(job));
            }
        }
        snapshot = new BuildSnapshot(monitoring, path, message,
                currentSession == null ? null : currentSession.copy(),
                Map.copyOf(workers));
        BuildSnapshot published = snapshot;
        ApplicationManager.getApplication().invokeLater(() ->
                listeners.forEach(listener -> listener.accept(published)));
    }

    private String resolveLogPath() {
        String configuredPath = settings().getLogPath();
        if (!configuredPath.isEmpty()) {
            return configuredPath;
        }
        return detectedLogPath();
    }

    static String detectedLogPath() {
        String fastBuildTemp = System.getenv("FASTBUILD_TEMP_PATH");
        Path base = fastBuildTemp == null || !Files.isDirectory(Path.of(fastBuildTemp))
                ? Path.of(System.getProperty("java.io.tmpdir"))
                : Path.of(fastBuildTemp);
        return base.resolve("FASTBuild").resolve("FastBuildLog.log").toString();
    }

    private static FastBuildMonitorSettings settings() {
        return ApplicationManager.getApplication().getService(FastBuildMonitorSettings.class);
    }

    private void closeChannel() {
        if (channel != null) {
            try {
                channel.close();
            } catch (IOException exception) {
                LOG.warn("Unable to close FASTBuild monitor log", exception);
            }
            channel = null;
            activePath = null;
            activeAttributes = null;
            filePosition = 0;
            partialLine.reset();
        }
    }
}
