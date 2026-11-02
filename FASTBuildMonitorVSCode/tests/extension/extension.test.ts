// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activate, deactivate } from '../../src/extension';
import { BuildMonitorService } from '../../src/buildMonitorService';
import { MonitorPanelProvider } from '../../src/monitorPanelProvider';
import { ConfigManager, type ConfigIssue } from '../../src/utilities/configManager';
import { Logger } from '../../src/utilities/logger';
import {
    commands, configuration, configurationChanged, createContext, outputChannel,
    registeredCommands, statusBar, window,
} from '../mocks/vscode';
import { BuildJobStatus, type BuildSession } from '../../src/models';

const panel = vi.hoisted(() => ({
    show: vi.fn(), start: vi.fn(), stop: vi.fn(), refresh: vi.fn(),
}));
vi.mock('../../src/monitorPanelProvider', () => ({
    MonitorPanelProvider: {
        getOrCreate: vi.fn(() => panel),
        getInstance: vi.fn(() => panel),
    },
}));
vi.mock('../../src/utilities/configManager', () => ({
    ConfigManager: vi.fn(class {
        onConfigurationError = vi.fn();
        checkConfigAndSetDefaults = vi.fn<() => Promise<ConfigIssue[]>>().mockResolvedValue([]);
        dispose = vi.fn();
    }),
}));
vi.mock('../../src/buildMonitorService', async () => {
    const { EventEmitter } = await import('node:events');
    return {
        BuildMonitorService: vi.fn(class extends EventEmitter {
            on = super.on.bind(this);
            emit = super.emit.bind(this);
            getLogPath = vi.fn(() => 'build.log');
            getCurrentSession = vi.fn<() => BuildSession | undefined>();
            getIsRestoringHistory = vi.fn(() => false);
            stop = vi.fn();
        }),
    };
});

let context = createContext();
beforeEach(() => { context = createContext(); });
afterEach(() => {
    deactivate();
    for (const disposable of context.subscriptions) disposable.dispose();
    Logger.getInstance().dispose();
});

function configResult(issues: ConfigIssue[]) {
    vi.mocked(ConfigManager).mockImplementationOnce(function () {
        return {
            onConfigurationError: vi.fn(),
            checkConfigAndSetDefaults: vi.fn().mockResolvedValue(issues),
            dispose: vi.fn(),
        } as Partial<ConfigManager> as ConfigManager;
    });
}

describe('extension lifecycle', () => {
    it('registers commands and disposables, uses the configured log path, and stops on deactivation', async () => {
        configuration.set('logPath', 'custom.log');
        await activate(context);
        expect(BuildMonitorService).toHaveBeenCalledWith(Logger.getInstance(), 'custom.log');
        expect([...registeredCommands.keys()]).toEqual([
            'fbuildMonitor.show', 'fbuildMonitor.start', 'fbuildMonitor.stop',
        ]);
        expect(statusBar).toMatchObject({
            text: '$(tools) FASTBuild', tooltip: 'Open FASTBuild Monitor', command: 'fbuildMonitor.show',
        });
        expect(statusBar.show).toHaveBeenCalledOnce();
        expect(context.subscriptions).toContain(outputChannel);
        registeredCommands.get('fbuildMonitor.show')!();
        expect(panel.show).toHaveBeenCalledOnce();
        registeredCommands.get('fbuildMonitor.start')!();
        expect(panel.start).toHaveBeenCalledOnce();
        expect(panel.show).toHaveBeenCalledTimes(2);
        registeredCommands.get('fbuildMonitor.stop')!();
        expect(panel.stop).toHaveBeenCalledOnce();
        deactivate();
        expect(vi.mocked(BuildMonitorService).mock.instances[0].stop).toHaveBeenCalledOnce();
    });

    it('updates the status bar for running, failed, successful, and absent sessions', async () => {
        await activate(context);
        expect(BuildMonitorService).toHaveBeenCalledWith(Logger.getInstance(), undefined);
        const service = vi.mocked(BuildMonitorService).mock.instances[0];
        const session: BuildSession = { processId: 1, logVersion: 1, startTime: 100, progress: 42.75, jobs: [] };
        vi.mocked(service.getCurrentSession).mockReturnValue(session);
        service.emit('stateChanged');
        expect(statusBar.text).toBe('$(sync~spin) FASTBuild 42.8%');
        session.endTime = 200;
        service.emit('stateChanged');
        expect(statusBar.text).toBe('$(check) FASTBuild Done');
        for (const status of [BuildJobStatus.Failed, BuildJobStatus.Error]) {
            session.jobs = [{ hostName: 'local', eventName: 'a', startTime: 100, status }];
            service.emit('stateChanged');
            expect(statusBar.text).toBe('$(error) FASTBuild FAILED');
        }
        vi.mocked(service.getCurrentSession).mockReturnValue(undefined);
        service.emit('stateChanged');
        expect(statusBar.text).toBe('$(tools) FASTBuild');
    });

    it('flags the status bar while distributed compilation is unavailable', async () => {
        await activate(context);
        const service = vi.mocked(BuildMonitorService).mock.instances[0];
        const session: BuildSession = {
            processId: 1, logVersion: 1, startTime: 100, progress: 42.75, jobs: [], distributionProblem: 'No workers found',
        };
        vi.mocked(service.getCurrentSession).mockReturnValue(session);
        service.emit('stateChanged');
        expect(statusBar).toMatchObject({
            text: '$(sync~spin) FASTBuild 42.8% $(warning)',
            tooltip: 'Distributed compilation is unavailable. No workers found\n\nOpen FASTBuild Monitor',
        });
        session.endTime = 200;
        service.emit('stateChanged');
        expect(statusBar.text).toBe('$(check) FASTBuild Done $(warning)');
        session.distributionProblem = undefined;
        service.emit('stateChanged');
        expect(statusBar).toMatchObject({ text: '$(check) FASTBuild Done', tooltip: 'Open FASTBuild Monitor' });
    });

    it('notifies when distributed compilation becomes unavailable, but not for replayed builds', async () => {
        await activate(context);
        const service = vi.mocked(BuildMonitorService).mock.instances[0];
        const session: BuildSession = {
            processId: 1, logVersion: 1, startTime: 100, progress: 10, jobs: [], distributionProblem: 'No workers found',
        };
        vi.mocked(service.getIsRestoringHistory).mockReturnValue(true);
        service.emit('distributionUnavailable', session);
        expect(window.showWarningMessage).not.toHaveBeenCalled();
        vi.mocked(service.getIsRestoringHistory).mockReturnValue(false);
        window.showWarningMessage.mockResolvedValue('Show Monitor');
        service.emit('distributionUnavailable', session);
        await Promise.resolve();
        expect(window.showWarningMessage).toHaveBeenCalledExactlyOnceWith(
            'Distributed compilation is unavailable. No workers found', 'Show Monitor',
        );
        expect(commands.executeCommand).toHaveBeenCalledExactlyOnceWith('fbuildMonitor.show');
        window.showWarningMessage.mockResolvedValue(undefined);
        service.emit('distributionUnavailable', session);
        await Promise.resolve();
        expect(commands.executeCommand).toHaveBeenCalledOnce();
    });

    it('refreshes only on theme or color-setting changes', async () => {
        await activate(context);
        configuration.set('useLegacyColors', true);
        for (const key of ['workbench.colorTheme', 'fbuildMonitor.useLegacyColors', 'editor.fontSize']) {
            configurationChanged.fire({ affectsConfiguration: setting => setting === key });
        }
        expect(panel.refresh).toHaveBeenCalledTimes(2);
        expect(panel.refresh).toHaveBeenLastCalledWith(true);
        configuration.delete('useLegacyColors');
        configurationChanged.fire({ affectsConfiguration: setting => setting === 'workbench.colorTheme' });
        expect(panel.refresh).toHaveBeenLastCalledWith(false);
    });

    it('reports configuration errors and offers to open the affected setting', async () => {
        await activate(context);
        window.showErrorMessage.mockResolvedValue('Open Settings');
        const manager = vi.mocked(ConfigManager).mock.instances[0];
        const listener = vi.mocked(manager.onConfigurationError).mock.calls[0][0];
        listener({ setting: 'fbuildMonitor.logPath', value: 42, message: 'Expected a string' });
        await Promise.resolve();
        expect(window.showErrorMessage).toHaveBeenCalledWith(
            'Invalid fbuildMonitor.logPath setting: Expected a string', 'Open Settings',
        );
        expect(commands.executeCommand).toHaveBeenCalledWith('workbench.action.openSettings', 'fbuildMonitor.logPath');
        commands.executeCommand.mockClear();
        window.showErrorMessage.mockResolvedValue(undefined);
        listener({ setting: 'fbuildMonitor.logPath', value: 42, message: 'Expected a string' });
        await Promise.resolve();
        expect(commands.executeCommand).not.toHaveBeenCalled();
    });

    it('allows warnings and recommendations while showing a detailed report on request', async () => {
        configResult([
            { severity: 'warning', setting: 'one', message: 'First warning' },
            { severity: 'warning', setting: '', message: 'Second warning' },
            { severity: 'info', setting: 'two', message: 'Recommendation' },
            { severity: 'info', setting: '', message: 'Another recommendation' },
        ]);
        window.showWarningMessage.mockResolvedValue('View Details');
        await activate(context);
        expect(window.showWarningMessage).toHaveBeenCalledWith('First warning\nSecond warning', 'View Details');
        expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Overall Status: PASSED'));
        expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('RECOMMENDATIONS:'));
        expect(outputChannel.show).toHaveBeenCalledOnce();
        expect(MonitorPanelProvider.getOrCreate).toHaveBeenCalled();
    });

    it('uses a single warning message and does not open details when dismissed', async () => {
        configResult([{ severity: 'warning', setting: '', message: 'Warning' }]);
        await activate(context);
        expect(window.showWarningMessage).toHaveBeenCalledWith('Warning', 'View Details');
        expect(outputChannel.show).not.toHaveBeenCalled();
    });

    it('allows info-only configuration and missing extension versions', async () => {
        configResult([{ severity: 'info', setting: '', message: 'Recommendation' }]);
        context = createContext('');
        await activate(context);
        expect(window.showWarningMessage).not.toHaveBeenCalled();
        expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('vunknown'));
    });

    it.each([1, 2])('blocks activation for %i configuration errors and offers the output log', async count => {
        configResult(Array.from({ length: count }, (_, i) => ({
            severity: 'error', setting: i === 0 ? 'logPath' : '', message: `Invalid ${i}`,
        })));
        window.showErrorMessage.mockResolvedValueOnce('View Details').mockResolvedValueOnce('View Output');
        await expect(activate(context)).rejects.toThrow('Extension activation blocked');
        expect(BuildMonitorService).not.toHaveBeenCalled();
        expect(window.showErrorMessage.mock.calls[0][0]).toContain('Invalid 0');
        expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Overall Status: FAILED'));
        expect(outputChannel.show).toHaveBeenCalledTimes(2);
    });

    it('logs and rethrows activation failures even when notifications are dismissed', async () => {
        const error = new Error('Registration failed');
        vi.mocked(MonitorPanelProvider.getOrCreate).mockImplementationOnce(() => { throw error; });
        await expect(activate(context)).rejects.toBe(error);
        expect(window.showErrorMessage).toHaveBeenCalledWith(
            'FASTBuild Monitor failed to activate. Check the output panel for details.', 'View Output',
        );
        expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('ERROR: Failed to activate'));
        expect(outputChannel.show).not.toHaveBeenCalled();
    });
});
