// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
/* eslint-disable @typescript-eslint/restrict-template-expressions */

import * as vscode from 'vscode';
import { BuildMonitorService } from './buildMonitorService';
import { getNonce } from './utilities/getNonce';
import { getUri } from './utilities/getUri';

export class MonitorPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'fbuildMonitor.fbuildMonitorView';
    private _view?: vscode.WebviewView;
    private static instance: MonitorPanelProvider | undefined;

    private readonly service: BuildMonitorService;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];
    private refreshTimer: ReturnType<typeof setInterval> | undefined;
    private isMonitoringOverride: boolean = false;

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
            (message: { command: string }) => this.handleWebviewMessage(message),
            undefined,
            this.disposables,
        );

        // When the panel is disposed
        webviewView.onDidDispose(() => this.dispose(), undefined, this.disposables);

        // Listen for visibility changes, stop monitoring when hidden, start monitoring when shown (if override is set).
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                if(this.isMonitoringOverride) {
                    this.start(true /* force */);
                }
                this.sendSnapshot();
            } else {
                this.stop(false /* don't override */);
            }
        });

        // Listen for state changes from the service
        this.service.on('stateChanged', () => this.sendSnapshot());

        // Periodic refresh for running timers (active jobs durations, elapsed time)
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }
        this.refreshTimer = setInterval(() => {
            if (
              this.service.isMonitoring() &&
              this.service.getCurrentSession() &&
              !this.service.getCurrentSession()?.endTime
            ) {
              this.sendSnapshot();
            }
        }, 1000);

        // Auto-start if configured
        const config = vscode.workspace.getConfiguration('fbuildMonitor');
        if (config.get<boolean>('autoStart', true)) {
            this.start();
        }

        // Send initial snapshot
        this.sendSnapshot();
    }

    private handleWebviewMessage(message: { command: string }): void {
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
        }
    }

    private sendSnapshot(): void {
        const snapshot = this.service.getSnapshot();
        this._view?.webview.postMessage({ type: 'snapshot', data: snapshot });
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

    public stop(override: boolean = true){
        this.service.stop();
        if (override) {
            this.isMonitoringOverride = false;
        }
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
