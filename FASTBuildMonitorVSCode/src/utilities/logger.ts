// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';

const DEFAULT_LOG_CHANNEL_NAME = 'FASTBuild Monitor';

/**
 * Singleton logger for the extension.
 * Provides centralized logging with timestamps to a dedicated output channel.
 */
export class Logger {
	private static instance: Logger | undefined;
	private outputChannel: vscode.OutputChannel;
	private disposed = false;

	private constructor() {
		const config = vscode.workspace.getConfiguration('fbuildMonitor')
		const channelName = config.get<string>('logChannelName', DEFAULT_LOG_CHANNEL_NAME);
		this.outputChannel = vscode.window.createOutputChannel(channelName);
	}

	/**
	 * Gets the singleton Logger instance.
	 * If the previous instance was disposed, creates a new one.
	 * @returns The Logger singleton instance
	 */
	public static getInstance(): Logger {
		if (!Logger.instance || Logger.instance.disposed) {
			Logger.instance = new Logger();
			Logger.instance.disposed = false; // Ensure flag is reset for new instance
		}
		return Logger.instance;
	}

	public info(message: string): void {
		const timestamp = new Date().toISOString();
		this.outputChannel.appendLine(`[${timestamp}] INFO: ${message}`);
	}

	public warn(message: string): void {
		const timestamp = new Date().toISOString();
		this.outputChannel.appendLine(`[${timestamp}] WARN: ${message}`);
	}

	public error(message: string, error?: unknown): void {
		const timestamp = new Date().toISOString();
		this.outputChannel.appendLine(`[${timestamp}] ERROR: ${message}`);
		if (error) {
			if (error instanceof Error) {
				this.outputChannel.appendLine(`  ${error.message}`);
				if (error.stack) {
					this.outputChannel.appendLine(`  Stack trace:\n${error.stack}`);
				}
			} else {
				this.outputChannel.appendLine(`  ${String(error)}`);
			}
		}
	}

	public debug(message: string): void {
		const timestamp = new Date().toISOString();
		this.outputChannel.appendLine(`[${timestamp}] DEBUG: ${message}`);
	}

	public show(): void {
		this.outputChannel.show();
	}

	/**
	 * Disposes the logger and its output channel.
	 * After disposal, calling getInstance() will create a new logger.
	 */
	public dispose(): void {
		if (!this.disposed) {
			this.outputChannel.dispose();
			this.disposed = true;
		}
	}

	/**
	 * Gets the underlying VS Code output channel.
	 * @returns The output channel instance
	 */
	public getOutputChannel(): vscode.OutputChannel {
		return this.outputChannel;
	}
}
