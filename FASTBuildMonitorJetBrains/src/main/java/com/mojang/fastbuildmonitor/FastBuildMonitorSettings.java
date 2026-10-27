// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.mojang.fastbuildmonitor;

import com.intellij.openapi.components.PersistentStateComponent;
import com.intellij.openapi.components.State;
import com.intellij.openapi.components.Storage;
import org.jetbrains.annotations.Nullable;

@State(name = "FastBuildMonitorSettings", storages = @Storage("fastBuildMonitor.xml"))
public final class FastBuildMonitorSettings implements PersistentStateComponent<FastBuildMonitorSettings.State> {
    public static final int DEFAULT_POLL_INTERVAL_MS = 500;

    private State state = new State();

    @Override
    public @Nullable State getState() {
        return state;
    }

    @Override
    public void loadState(State state) {
        this.state = state;
        if (this.state.pollIntervalMs < 100 || this.state.pollIntervalMs > 5000) {
            this.state.pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
        }
        if (this.state.logPath == null) {
            this.state.logPath = "";
        }
    }

    public String getLogPath() {
        return state.logPath.trim();
    }

    public void setLogPath(String logPath) {
        state.logPath = logPath == null ? "" : logPath.trim();
    }

    public int getPollIntervalMs() {
        return state.pollIntervalMs;
    }

    public void setPollIntervalMs(int pollIntervalMs) {
        state.pollIntervalMs = Math.max(100, Math.min(5000, pollIntervalMs));
    }

    public boolean isAutoStart() {
        return state.autoStart;
    }

    public void setAutoStart(boolean autoStart) {
        state.autoStart = autoStart;
    }

    public static final class State {
        public String logPath = "";
        public int pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
        public boolean autoStart = true;
    }
}
