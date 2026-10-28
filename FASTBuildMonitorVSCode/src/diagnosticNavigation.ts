// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from 'path';
import * as vscode from 'vscode';
import { parseSourceLocation } from './diagnostics';
import type { BuildSession } from './models';
import { Logger } from './utilities/logger';

export async function openDiagnostic(session: BuildSession | undefined, request: unknown): Promise<void> {
    try {
        if (!session || typeof request !== 'object' || !request ||
            !('processId' in request) || request.processId !== session.processId ||
            !('sessionStartTime' in request) || request.sessionStartTime !== session.startTime ||
            !('jobIndex' in request) || typeof request.jobIndex !== 'number' ||
            !Number.isSafeInteger(request.jobIndex) || request.jobIndex < 0 ||
            !('lineIndex' in request) || typeof request.lineIndex !== 'number' ||
            !Number.isSafeInteger(request.lineIndex) || request.lineIndex < 0) {
            throw new Error('The diagnostic selection is invalid or belongs to a previous build.');
        }
        const text = session.jobs[request.jobIndex]?.message?.split(/\r?\n/)[request.lineIndex];
        const location = text === undefined ? undefined : parseSourceLocation(text);
        if (!location) throw new Error('This output line does not contain a supported source location.');

        let uri: vscode.Uri;
        if (path.isAbsolute(location.path)) {
            uri = vscode.Uri.file(location.path);
        } else {
            if (path.win32.isAbsolute(location.path)) {
                throw new Error(`The worker path "${location.path}" is not accessible on this machine.`);
            }
            const candidates: vscode.Uri[] = [];
            for (const folder of vscode.workspace.workspaceFolders ?? []) {
                const candidate = vscode.Uri.joinPath(folder.uri, location.path.replaceAll('\\', '/'));
                try {
                    const stat = await vscode.workspace.fs.stat(candidate);
                    if ((stat.type & vscode.FileType.File) !== 0) candidates.push(candidate);
                } catch (error) {
                    if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error;
                }
            }
            if (!candidates.length) {
                throw new Error(`Cannot find "${location.path}" in the workspace folders. Open the source workspace or check the build's relative paths.`);
            }
            if (candidates.length === 1) {
                uri = candidates[0];
            } else {
                const selected = await vscode.window.showQuickPick(
                    candidates.map(candidate => ({ label: candidate.fsPath, uri: candidate })),
                    { placeHolder: 'Choose the source file for this diagnostic' },
                );
                if (!selected) return;
                uri = selected.uri;
            }
        }
        const document = await vscode.workspace.openTextDocument(uri);
        const selection = document.validateRange(new vscode.Range(
            location.line - 1, location.column - 1, location.line - 1, location.column - 1,
        ));
        await vscode.window.showTextDocument(document, { preview: false, selection });
    } catch (error) {
        Logger.getInstance().error('Failed to open diagnostic source.', error);
        const detail = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Failed to open diagnostic source: ${detail}`);
    }
}
