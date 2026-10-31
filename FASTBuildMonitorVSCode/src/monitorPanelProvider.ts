// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
/* eslint-disable @typescript-eslint/restrict-template-expressions */

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BuildMonitorService } from './buildMonitorService';
import { getNonce } from './utilities/getNonce';
import { getUri } from './utilities/getUri';
import { Logger } from './utilities/logger';
import { openDiagnostic } from './diagnosticNavigation';

export class MonitorPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'fbuildMonitor.fbuildMonitorView';
    private _view?: vscode.WebviewView;
    private static instance: MonitorPanelProvider | undefined;

    private readonly service: BuildMonitorService;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];
    private refreshTimer: ReturnType<typeof setInterval> | undefined;
    private isMonitoringOverride: boolean = false;
    private isSnapshotRequestPending: boolean = false;
    private useLegacyColors: boolean = false;

    public static getOrCreate(context: vscode.ExtensionContext, service: BuildMonitorService): MonitorPanelProvider {
        if (MonitorPanelProvider.instance) {
            return MonitorPanelProvider.instance;
        }

        MonitorPanelProvider.instance = new MonitorPanelProvider(context.extensionUri, service);
        context.subscriptions.push(
                vscode.window.registerWebviewViewProvider(MonitorPanelProvider.viewType, MonitorPanelProvider.instance, {
                    webviewOptions: {
                        retainContextWhenHidden: true,
                    },
                })
            );
        return MonitorPanelProvider.instance;
    }

    public static getInstance(): MonitorPanelProvider | undefined {
        return MonitorPanelProvider.instance;
    }

    private constructor(extensionUri: vscode.Uri, service: BuildMonitorService) {
        this.extensionUri = extensionUri;
        this.service = service;
    }

    resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): Thenable<void> | void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'out'),
                vscode.Uri.joinPath(this.extensionUri, 'webview-ui/build'),
            ],
        };

        webviewView.webview.html = this.getWebviewContent(webviewView.webview, this.extensionUri);

        // Listen for messages from the webview
        webviewView.webview.onDidReceiveMessage(
            (message: { command: string; content?: unknown }) => this.handleWebviewMessage(message),
            undefined,
            this.disposables,
        );

        // When the panel is disposed
        webviewView.onDidDispose(() => this.dispose(), undefined, this.disposables);

        // Keep monitoring while hidden, so the status bar and notifications stay current while, say, the terminal running
        // the build is in front. Start monitoring when shown (if override is set) and catch the view up.
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                if(this.isMonitoringOverride) {
                    this.start(true /* force */);
                }
                this.isSnapshotRequestPending = true;
            }
        });

        // Listen for state changes from the service
        this.service.on('stateChanged', () => {
            if(!this.service.getIsRestoringHistory()) {
                this.isSnapshotRequestPending = true;
            }
        });

        // Periodic refresh for running timers (active jobs durations, elapsed time), only while the view can show it
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }
        this.refreshTimer = setInterval(() => {
            if (!this.isViewVisible()) {
                return;
            }
            if (
              this.isSnapshotRequestPending || (
              this.service.isMonitoring() &&
              this.service.getCurrentSession() &&
              !this.service.getCurrentSession()?.endTime)
            ) {
                this.isSnapshotRequestPending = false;
                this.sendSnapshot();
            }
        }, 100);

        // Auto-start if configured
        const config = vscode.workspace.getConfiguration('fbuildMonitor');
        if (config.get<boolean>('autoStart', true)) {
            this.start();
        }
        this.useLegacyColors = config.get<boolean>('useLegacyColors', false);

        // Send initial snapshot
        this.isSnapshotRequestPending = true;
    }

    private handleWebviewMessage(message: { command: string; content?: unknown }): void {
        switch (message.command) {
            case 'start': {
                this.start();
                break;
            }
            case 'stop':
                this.stop();
                break;
            case 'requestSnapshot':
                this.sendSnapshot();
                break;
            case 'exportHtml':
                void this.exportHtml(message.content);
                break;
            case 'openDiagnostic':
                void openDiagnostic(this.service.getCurrentSession(), message.content);
                break;
        }
    }

    private async exportHtml(content: unknown): Promise<void> {
        try {
            if (typeof content !== 'string' || !content.trim()) {
                throw new Error('No timeline data was provided.');
            }
            const folder = vscode.Uri.file(path.join(os.tmpdir(), 'FASTBuildMonitor'));
            await vscode.workspace.fs.createDirectory(folder);
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const file = vscode.Uri.joinPath(folder, `timeline-${stamp}.html`);
            await vscode.workspace.fs.writeFile(file, Buffer.from(content, 'utf8'));

            // A remote extension host writes to the remote machine, which a local browser cannot open.
            const opened = !vscode.env.remoteName && await vscode.env.openExternal(file);
            if (opened) {
                void vscode.window.showInformationMessage(`Timeline exported to ${file.fsPath}`);
                return;
            }
            const document = await vscode.workspace.openTextDocument(file);
            await vscode.window.showTextDocument(document, { preview: false });
            void vscode.window.showWarningMessage(
                `Timeline exported to ${file.fsPath}. Open this file in a web browser to view it.`,
            );
        } catch (error) {
            Logger.getInstance().error('Failed to export the timeline as HTML.', error);
            const detail = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Failed to export the timeline as HTML: ${detail}`);
        }
    }

    private sendSnapshot(): void {
        const snapshot = this.service.getSnapshot();
        this._view?.webview.postMessage({
            type: 'snapshot',
            data: { ...snapshot, useLegacyColors: this.useLegacyColors },
        });
    }

    /** Re-render the webview, e.g. after a theme or color-setting change. */
    public refresh(useLegacyColors: boolean): void {
        if (useLegacyColors !== undefined) {
            this.useLegacyColors = useLegacyColors;
        }

        this.sendSnapshot();
    }

    public start(force: boolean = false) {
        this.isMonitoringOverride = true;
        if (!force && !this.isViewVisible()) {
            return;
        }
        const config = vscode.workspace.getConfiguration("fbuildMonitor");
        const pollInterval = config.get<number>("pollIntervalMs", 500);
        this.service.start(pollInterval);
    }

    public stop(){
        this.service.stop();
        this.isMonitoringOverride = false;
    }

    public show(){
        vscode.commands.executeCommand(`${MonitorPanelProvider.viewType}.focus`);
    }

    private isViewVisible(): boolean {
        return this._view?.visible ?? false;
    }

    public dispose(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }

        // this._view?.dispose();

        while (this.disposables.length) {
            const d = this.disposables.pop();
            d?.dispose();
        }
    }

    private getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
        const stylesUri = getUri(webview, extensionUri, ['webview-ui', 'build', 'assets', 'monitorPanel.css']);
        const scriptUri = getUri(webview, extensionUri, ['webview-ui', 'build', 'assets', 'monitorPanel.js']);
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <meta http-equiv="Content-Security-Policy"
                    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                <link rel="stylesheet" type="text/css" href="${stylesUri}">
                <title>FASTBuild Monitor</title>
            </head>
            <body class="body">
                <div id="root" class="root-layout"></div>
                <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}
