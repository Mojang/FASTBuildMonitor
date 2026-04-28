// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri, Webview } from 'vscode';

export function getUri(webview: Webview, extensionUri: Uri, pathList: string[]): Uri {
    return webview.asWebviewUri(Uri.joinPath(extensionUri, ...pathList));
}
