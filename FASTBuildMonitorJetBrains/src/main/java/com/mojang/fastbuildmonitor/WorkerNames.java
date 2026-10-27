// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.mojang.fastbuildmonitor;

import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.util.concurrency.AppExecutorUtil;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Map;
import java.util.TreeMap;

final class WorkerNames implements Disposable {
    private static final Logger LOG = Logger.getInstance(WorkerNames.class);
    private final Map<String, String> names = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
    private final Runnable updated;
    private boolean disposed;

    WorkerNames(Runnable updated) {
        this.updated = updated;
    }

    String displayName(String host) {
        String name = computerName(host);
        return name.equalsIgnoreCase(host) ? host : name + " (" + host + ")";
    }

    String computerName(String host) {
        return names.computeIfAbsent(host, key -> {
            AppExecutorUtil.getAppExecutorService().execute(() -> {
                String name = resolve(key);
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (!disposed) {
                        names.put(key, name);
                        updated.run();
                    }
                });
            });
            return key;
        });
    }

    private static String resolve(String host) {
        try {
            boolean local = host.equalsIgnoreCase("local");
            InetAddress address = local ? InetAddress.getLocalHost() : InetAddress.getByName(host);
            String name = local ? address.getHostName() : address.getCanonicalHostName();
            return name.equals(address.getHostAddress()) ? host : name;
        } catch (UnknownHostException exception) {
            LOG.debug("Unable to resolve FASTBuild worker " + host, exception);
            return host;
        }
    }

    @Override
    public void dispose() {
        disposed = true;
    }
}
