// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';

/**
 * Abstraction layer for file system operations to enable testability.
 * Wraps VS Code's file system API for easier mocking in tests.
 */
export interface IFileSystem {
	writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void>;
	delete(uri: vscode.Uri): Promise<void>;
	readFile(uri: vscode.Uri): Promise<Uint8Array>;
	stat(uri: vscode.Uri): Promise<vscode.FileStat>;
}

/**
 * Default implementation that uses VS Code's workspace.fs API.
 */
export class VsCodeFileSystem implements IFileSystem {
	async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
		await vscode.workspace.fs.writeFile(uri, content);
	}

	async delete(uri: vscode.Uri): Promise<void> {
		await vscode.workspace.fs.delete(uri);
	}

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		return await vscode.workspace.fs.readFile(uri);
	}

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		return await vscode.workspace.fs.stat(uri);
	}
}
