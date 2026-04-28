// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
/* eslint-disable @typescript-eslint/restrict-template-expressions */

import * as vscode from 'vscode';
import { BuildMonitorService } from './buildMonitorService';
import { getNonce } from './utilities/getNonce';
import { getUri } from './utilities/getUri';

export class MonitorPanel {
    public static readonly viewType = 'fbuildMonitor';
    private static instance: MonitorPanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly service: BuildMonitorService;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];
    private refreshTimer: ReturnType<typeof setInterval> | undefined;

    public static createOrShow(extensionUri: vscode.Uri, service: BuildMonitorService): MonitorPanel {
        const column = vscode.ViewColumn.Beside;

        if (MonitorPanel.instance) {
            MonitorPanel.instance.panel.reveal(column);
            return MonitorPanel.instance;
        }

        const panel = vscode.window.createWebviewPanel(
            MonitorPanel.viewType,
            'FASTBuild Monitor',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'out'),
                    vscode.Uri.joinPath(extensionUri, 'webview-ui/build'),
                ],
            },
        );

        MonitorPanel.instance = new MonitorPanel(panel, extensionUri, service);
        return MonitorPanel.instance;
    }

    public static getInstance(): MonitorPanel | undefined {
        return MonitorPanel.instance;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, service: BuildMonitorService) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.service = service;

        this.panel.webview.html = this.getWebviewContent(this.panel.webview, extensionUri);

        // Listen for messages from the webview
        this.panel.webview.onDidReceiveMessage(
            (message: { command: string }) => this.handleWebviewMessage(message),
            undefined,
            this.disposables,
        );

        // When the panel is disposed
        this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);

        // Listen for state changes from the service
        this.service.on('stateChanged', () => this.sendSnapshot());

        // Periodic refresh for running timers (active jobs durations, elapsed time)
        this.refreshTimer = setInterval(() => {
            if (this.service.getCurrentSession() && !this.service.getCurrentSession()?.endTime) {
                this.sendSnapshot();
            }
        }, 1000);

        // Auto-start if configured
        const config = vscode.workspace.getConfiguration('fbuildMonitor');
        if (config.get<boolean>('autoStart', true)) {
            const pollInterval = config.get<number>('pollIntervalMs', 500);
            this.service.start(pollInterval);
        }

        // Send initial snapshot
        this.sendSnapshot();
    }

    private handleWebviewMessage(message: { command: string }): void {
        switch (message.command) {
            case 'start': {
                const config = vscode.workspace.getConfiguration('fbuildMonitor');
                const pollInterval = config.get<number>('pollIntervalMs', 500);
                this.service.start(pollInterval);
                break;
            }
            case 'stop':
                this.service.stop();
                break;
            case 'requestSnapshot':
                this.sendSnapshot();
                break;
        }
    }

    private sendSnapshot(): void {
        const snapshot = this.service.getSnapshot();
        this.panel.webview.postMessage({ type: 'snapshot', data: snapshot });
    }

    public dispose(): void {
        MonitorPanel.instance = undefined;

        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }

        this.panel.dispose();

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
