// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from 'path';
import type * as VSCode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDiagnostic } from '../../src/diagnosticNavigation';
import { BuildJobStatus, type BuildSession } from '../../src/models';
import { workspace, window, Uri, FileSystemError } from '../mocks/vscode';

const request = { processId: 42, sessionStartTime: 1000, jobIndex: 0, lineIndex: 1 };
const build: BuildSession = {
    processId: 42, startTime: 1000, progress: 100, logVersion: 1,
    jobs: [{
        hostName: 'worker', eventName: 'target.obj', startTime: 2000, status: BuildJobStatus.Failed,
        message: 'compiler output\nsrc/file.cpp(42,7): error: failed',
    }],
};
const document = { validateRange: vi.fn((range: VSCode.Range) => range) } as Partial<VSCode.TextDocument>;
const fileStat: VSCode.FileStat = { type: 1, size: 10, ctime: 0, mtime: 0 };

beforeEach(() => {
    workspace.workspaceFolders = [{ uri: Uri.file(path.resolve('workspace')), name: 'workspace', index: 0 }];
    workspace.fs.stat.mockResolvedValue(fileStat);
    workspace.openTextDocument.mockResolvedValue(document as VSCode.TextDocument);
});

describe('opening diagnostic source', () => {
    it('resolves relative workspace files and selects the zero-based line and column', async () => {
        await openDiagnostic(build, request);
        expect(workspace.openTextDocument.mock.calls[0][0].toString()).toMatch(/workspace\/src\/file.cpp$/);
        expect(window.showTextDocument).toHaveBeenCalledWith(document, {
            preview: false,
            selection: expect.objectContaining({ start: { line: 41, character: 6 }, end: { line: 41, character: 6 } }),
        });
        expect(document.validateRange).toHaveBeenCalled();
    });

    it('opens absolute paths without searching workspace folders', async () => {
        const absolute = path.resolve('source', 'file.cpp');
        await openDiagnostic({ ...build, jobs: [{ ...build.jobs[0], message: `${absolute}:3: error` }] }, { ...request, lineIndex: 0 });
        expect(workspace.openTextDocument).toHaveBeenCalledWith(Uri.file(absolute));
        expect(workspace.fs.stat).not.toHaveBeenCalled();
    });

    it('asks which matching file to open in a multi-root workspace', async () => {
        workspace.workspaceFolders!.push({ uri: Uri.file(path.resolve('other')), name: 'other', index: 1 });
        window.showQuickPick.mockImplementation(async items => items[1]);
        await openDiagnostic(build, request);
        expect(window.showQuickPick).toHaveBeenCalledOnce();
        expect(workspace.openTextDocument.mock.calls[0][0].toString()).toMatch(/other\/src\/file.cpp$/);
    });

    it('respects cancellation when choosing a source file', async () => {
        workspace.workspaceFolders!.push({ uri: Uri.file(path.resolve('other')), name: 'other', index: 1 });
        await openDiagnostic(build, request);
        expect(workspace.openTextDocument).not.toHaveBeenCalled();
        expect(window.showErrorMessage).not.toHaveBeenCalled();
    });

    it.each([undefined, null, {}, { ...request, processId: 0 }, { ...request, sessionStartTime: 0 },
        { ...request, jobIndex: -1 }, { ...request, lineIndex: -1 }, { ...request, jobIndex: 0.5 },
        { ...request, lineIndex: '1' }])('rejects invalid or stale selections: %j', async invalid => {
        await openDiagnostic(build, invalid);
        expect(workspace.openTextDocument).not.toHaveBeenCalled();
        expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('invalid or belongs to a previous build'));
    });

    it('rejects a selection when no build is active', async () => {
        await openDiagnostic(undefined, request);
        expect(window.showErrorMessage).toHaveBeenCalled();
    });

    it.each([{ ...request, lineIndex: 0 }, { ...request, lineIndex: 20 }, { ...request, jobIndex: 99 }])(
        'rejects lines without a valid source location', async invalid => {
            await openDiagnostic(build, invalid);
            expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('supported source location'));
        },
    );

    it.each(['missing', 'directory', 'no workspace'])('reports unresolved paths: %s', async mode => {
        if (mode === 'missing') workspace.fs.stat.mockRejectedValue(new FileSystemError('FileNotFound'));
        if (mode === 'directory') workspace.fs.stat.mockResolvedValue({ ...fileStat, type: 2 });
        if (mode === 'no workspace') workspace.workspaceFolders = undefined;
        await openDiagnostic(build, request);
        expect(workspace.openTextDocument).not.toHaveBeenCalled();
        expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Cannot find'));
    });

    it.each(['stat', 'open', 'show'])('reports %s failures', async stage => {
        const error = new Error('Access denied');
        if (stage === 'stat') workspace.fs.stat.mockRejectedValue(error);
        if (stage === 'open') workspace.openTextDocument.mockRejectedValue(error);
        if (stage === 'show') window.showTextDocument.mockRejectedValue(error);
        await openDiagnostic(build, request);
        expect(window.showErrorMessage).toHaveBeenCalledWith('Failed to open diagnostic source: Access denied');
    });
});
