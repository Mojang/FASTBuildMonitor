// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as VSCode from 'vscode';
import * as vscodeMock from '../mocks/vscode';
import { BuildMonitorService } from '../../src/buildMonitorService';
import { Logger } from '../../src/utilities/logger';
import type { MonitorPanelProvider as Provider } from '../../src/monitorPanelProvider';
import type { BuildSession } from '../../src/models';

let provider: Provider;
let service: BuildMonitorService;
let monitoring: boolean;
let session: BuildSession | undefined;
let restoring: boolean;
let context: VSCode.ExtensionContext;
let messages: vscodeMock.EventEmitter<{ command: string; content?: unknown }>;
let visibility: vscodeMock.EventEmitter<void>;
let disposed: vscodeMock.EventEmitter<void>;
let view: VSCode.WebviewView;
const postMessage = vi.fn().mockResolvedValue(true);

beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.doMock('vscode', () => vscodeMock);
    const { MonitorPanelProvider } = await import('../../src/monitorPanelProvider');
    monitoring = false;
    session = undefined;
    restoring = false;
    context = vscodeMock.createContext();
    service = new BuildMonitorService(Logger.getInstance(), 'test.log');
    vi.spyOn(service, 'start').mockImplementation(() => { monitoring = true; });
    vi.spyOn(service, 'stop').mockImplementation(() => { monitoring = false; });
    vi.spyOn(service, 'isMonitoring').mockImplementation(() => monitoring);
    vi.spyOn(service, 'getCurrentSession').mockImplementation(() => session);
    vi.spyOn(service, 'getIsRestoringHistory').mockImplementation(() => restoring);
    vi.spyOn(service, 'getSnapshot').mockImplementation(() => ({
        isMonitoring: monitoring, session, workers: [], logPath: 'test.log',
    }));
    expect(MonitorPanelProvider.getInstance()).toBeUndefined();
    provider = MonitorPanelProvider.getOrCreate(context, service);
    expect(MonitorPanelProvider.getInstance()).toBe(provider);
    expect(MonitorPanelProvider.getOrCreate(context, service)).toBe(provider);
    messages = new vscodeMock.EventEmitter();
    visibility = new vscodeMock.EventEmitter();
    disposed = new vscodeMock.EventEmitter();
    const webview: Partial<VSCode.Webview> = {
        options: {}, html: '', cspSource: 'https://webview',
        asWebviewUri: uri => uri, postMessage, onDidReceiveMessage: messages.event,
    };
    view = {
        webview: webview as VSCode.Webview, visible: true,
        onDidDispose: disposed.event, onDidChangeVisibility: visibility.event,
        viewType: 'fbuildMonitor.fbuildMonitorView', show: vi.fn(),
    };
});

afterEach(() => {
    provider.dispose();
    service.removeAllListeners();
    messages.dispose();
    visibility.dispose();
    disposed.dispose();
    for (const subscription of context.subscriptions) subscription.dispose();
    Logger.getInstance().dispose();
});

function resolve() {
    provider.resolveWebviewView(view, { state: undefined }, {
        isCancellationRequested: false, onCancellationRequested: new vscodeMock.EventEmitter<unknown>().event,
    });
}

describe('monitor webview provider', () => {
    it('routes diagnostic selections to the host and reports stale builds', async () => {
        resolve();
        messages.fire({ command: 'openDiagnostic', content: { processId: 42, sessionStartTime: 1000, jobIndex: 0, lineIndex: 0 } });
        await vi.advanceTimersByTimeAsync(0);
        expect(vscodeMock.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('diagnostic selection is invalid'));
    });

    const html = '<!DOCTYPE html><title>Build</title>';
    const exportedFile = () => vscodeMock.workspace.fs.writeFile.mock.calls[0][0];

    it('writes HTML exports to a unique temp file and opens them in the browser', async () => {
        resolve();
        messages.fire({ command: 'exportHtml', content: html });
        await vi.advanceTimersByTimeAsync(0);
        const [folder] = vscodeMock.workspace.fs.createDirectory.mock.calls[0];
        expect(folder.fsPath).toMatch(/\/FASTBuildMonitor$/);
        const [file, bytes] = vscodeMock.workspace.fs.writeFile.mock.calls[0];
        expect(file.toString()).toMatch(/\/FASTBuildMonitor\/timeline-\d{4}-\d\d-\d\dT[\d-]+Z\.html$/);
        expect(Buffer.from(bytes).toString('utf8')).toBe(html);
        expect(vscodeMock.env.openExternal).toHaveBeenCalledExactlyOnceWith(file);
        expect(vscodeMock.window.showInformationMessage).toHaveBeenCalledWith(`Timeline exported to ${file.fsPath}`);
        expect(vscodeMock.workspace.openTextDocument).not.toHaveBeenCalled();
    });

    it.each(['remote', 'declined'])('shows the HTML file in an editor when the browser is %s', async mode => {
        const document = { languageId: 'html' } as VSCode.TextDocument;
        vscodeMock.workspace.openTextDocument.mockResolvedValue(document);
        if (mode === 'remote') vscodeMock.env.remoteName = 'ssh-remote';
        else vscodeMock.env.openExternal.mockResolvedValue(false);
        resolve();
        messages.fire({ command: 'exportHtml', content: html });
        await vi.advanceTimersByTimeAsync(0);
        expect(vscodeMock.env.openExternal).toHaveBeenCalledTimes(mode === 'remote' ? 0 : 1);
        expect(vscodeMock.workspace.openTextDocument).toHaveBeenCalledExactlyOnceWith(exportedFile());
        expect(vscodeMock.window.showTextDocument).toHaveBeenCalledWith(document, { preview: false });
        expect(vscodeMock.window.showWarningMessage).toHaveBeenCalledWith(
            `Timeline exported to ${exportedFile().fsPath}. Open this file in a web browser to view it.`,
        );
    });

    it.each([undefined, '', '  ', 42])('reports invalid export content: %s', async content => {
        resolve();
        messages.fire({ command: 'exportHtml', content });
        await vi.advanceTimersByTimeAsync(0);
        expect(vscodeMock.workspace.fs.writeFile).not.toHaveBeenCalled();
        expect(vscodeMock.window.showErrorMessage).toHaveBeenCalledWith(
            'Failed to export the timeline as HTML: No timeline data was provided.',
        );
    });

    it.each(['createDirectory', 'writeFile'] as const)('reports %s failures during export', async stage => {
        vscodeMock.workspace.fs[stage].mockRejectedValue(new Error('Disk full'));
        resolve();
        messages.fire({ command: 'exportHtml', content: html });
        await vi.advanceTimersByTimeAsync(0);
        expect(vscodeMock.env.openExternal).not.toHaveBeenCalled();
        expect(vscodeMock.window.showErrorMessage).toHaveBeenCalledWith(
            'Failed to export the timeline as HTML: Disk full',
        );
        expect(vscodeMock.outputChannel.appendLine).toHaveBeenCalledWith(
            expect.stringContaining('ERROR: Failed to export'),
        );
    });

    it('registers once and generates restricted HTML with matching script nonces and asset URIs', () => {
        expect(vscodeMock.window.registerWebviewViewProvider).toHaveBeenCalledOnce();
        resolve();
        expect(view.webview.options.enableScripts).toBe(true);
        expect(view.webview.options.localResourceRoots?.map(uri => uri.toString())).toEqual([
            'file:///extension/out', 'file:///extension/webview-ui/build',
        ]);
        expect(view.webview.html).toContain("default-src 'none'");
        expect(view.webview.html).toContain('file:///extension/webview-ui/build/assets/monitorPanel.js');
        expect(view.webview.html).toContain('file:///extension/webview-ui/build/assets/monitorPanel.css');
        const nonce = view.webview.html.match(/script-src 'nonce-([A-Za-z0-9]{32})'/)?.[1];
        expect(nonce).toHaveLength(32);
        expect(view.webview.html).toContain(`nonce="${nonce}"`);
        expect(service.start).toHaveBeenCalledWith(500);
        vi.advanceTimersByTime(100);
        expect(postMessage).toHaveBeenCalledWith({
            type: 'snapshot', data: { isMonitoring: true, session: undefined, workers: [], logPath: 'test.log', useLegacyColors: false },
        });
    });

    it('honors auto-start, poll intervals, start/stop commands and explicit snapshot requests', () => {
        vscodeMock.configuration.set('autoStart', false);
        vscodeMock.configuration.set('pollIntervalMs', 250);
        vscodeMock.configuration.set('useLegacyColors', true);
        resolve();
        expect(service.start).not.toHaveBeenCalled();
        messages.fire({ command: 'start' });
        expect(service.start).toHaveBeenCalledWith(250);
        messages.fire({ command: 'stop' });
        expect(service.stop).toHaveBeenCalledOnce();
        messages.fire({ command: 'requestSnapshot' });
        expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
            data: expect.objectContaining({ isMonitoring: false, useLegacyColors: true }),
        }));
        postMessage.mockClear();
        messages.fire({ command: 'unknown' });
        expect(postMessage).not.toHaveBeenCalled();
        provider.show();
        expect(vscodeMock.commands.executeCommand).toHaveBeenCalledWith('fbuildMonitor.fbuildMonitorView.focus');
    });

    it('defers hidden starts, resumes on visibility, and respects an explicit stop', () => {
        view = { ...view, visible: false };
        resolve();
        expect(service.start).not.toHaveBeenCalled();
        view = Object.assign(view, { visible: true });
        visibility.fire();
        expect(service.start).toHaveBeenCalledOnce();
        Object.assign(view, { visible: false });
        visibility.fire();
        expect(service.stop).toHaveBeenCalledOnce();
        Object.assign(view, { visible: true });
        visibility.fire();
        expect(service.start).toHaveBeenCalledTimes(2);
        provider.stop();
        Object.assign(view, { visible: false });
        visibility.fire();
        Object.assign(view, { visible: true });
        visibility.fire();
        expect(service.start).toHaveBeenCalledTimes(2);
    });

    it('coalesces state updates, suppresses history updates, and refreshes active-build timers', () => {
        vscodeMock.configuration.set('autoStart', false);
        resolve();
        vi.advanceTimersByTime(100);
        postMessage.mockClear();
        service.emit('stateChanged');
        service.emit('stateChanged');
        vi.advanceTimersByTime(100);
        expect(postMessage).toHaveBeenCalledOnce();
        postMessage.mockClear();
        restoring = true;
        service.emit('stateChanged');
        vi.advanceTimersByTime(200);
        expect(postMessage).not.toHaveBeenCalled();
        restoring = false;
        monitoring = true;
        session = { processId: 1, logVersion: 1, startTime: 1, progress: 0, jobs: [] };
        vi.advanceTimersByTime(300);
        expect(postMessage).toHaveBeenCalledTimes(3);
        session.endTime = 100;
        postMessage.mockClear();
        vi.advanceTimersByTime(200);
        expect(postMessage).not.toHaveBeenCalled();
        provider.refresh(true);
        expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ useLegacyColors: true }),
        }));
    });

    it('replaces refresh timers when resolved again and disposes timers and message listeners', () => {
        provider.start();
        expect(service.start).not.toHaveBeenCalled();
        provider.refresh(false);
        expect(postMessage).not.toHaveBeenCalled();
        resolve();
        resolve();
        expect(vi.getTimerCount()).toBe(1);
        disposed.fire();
        expect(vi.getTimerCount()).toBe(0);
        postMessage.mockClear();
        messages.fire({ command: 'requestSnapshot' });
        expect(postMessage).not.toHaveBeenCalled();
    });
});
