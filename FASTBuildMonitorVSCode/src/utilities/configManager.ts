// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { Logger } from './logger.js';

const UPDATE_REPO_OWNER = 'Mojang';
const UPDATE_REPO_NAME = 'FASTBuildMonitor';
const UPDATE_TAG_PREFIX = 'VS-Code-v';

/**
 * Recommended extension definition with custom warning message.
 */
export interface RecommendedExtension {
	readonly id: string;
	readonly name: string;
	readonly reason: string;
	readonly warning: string;
}

/**
 * Event fired when a configuration value is invalid.
 */
export interface ConfigurationError {
	setting: string;
	value: unknown;
	message: string;
}

/**
 * Configuration validation issue.
 */
export interface ConfigIssue {
	severity: 'error' | 'warning' | 'info';
	setting: string;
	message: string;
	autoFixed?: boolean;
}

/**
 * Centralized configuration management for the extension.
 * Handles reading, writing, validation, and type-safe access to all extension settings.
 */
export class ConfigManager {
	private readonly _onConfigurationError = new vscode.EventEmitter<ConfigurationError>();
	readonly onConfigurationError = this._onConfigurationError.event;
	private isCurrentVersionPreRelease!: boolean;

	constructor(
		private logger: Logger,
		private extensionContext: vscode.ExtensionContext
	) {}

	/**
	 * Get the tag prefix used for identifying update releases.
	 */
	getTagPrefix(): string {
		return UPDATE_TAG_PREFIX;
	}

	/**
	 * Get the current extension version from the extension context.
	 */
	private getCurrentVersion(): string {
		const version = (this.extensionContext.extension.packageJSON as Record<string, unknown>).version as string;
		return version;
	}

	/**
	 * Check and validate configuration, auto-configuring defaults as needed.
	 * This should be called once during extension activation.
	 * @returns Array of configuration issues (warnings/errors)
	 */
	async checkConfigAndSetDefaults(): Promise<ConfigIssue[]> {
		this.logger.info('Checking configuration...');

		const issues: ConfigIssue[] = [];

		const updateIssues = await this.updateSettings();
		issues.push(...updateIssues);

		issues.push(...this.validateSettings()); 

		const hasErrors = issues.some(i => i.severity === 'error');
		const hasWarnings = issues.some(i => i.severity === 'warning');
		this.logger.info(`Configuration check completed. Errors: ${hasErrors}, Warnings: ${hasWarnings}, Total issues: ${issues.length}`);

		return issues;
	}

	/**
	 * Auto-configure settings with defaults.
	 */
	private updateSettings(): Promise<ConfigIssue[]> {
		const issues: ConfigIssue[] = [];
		return Promise.resolve(issues);
	}

	/**
	 * Validate settings.
	 */
	private validateSettings(): ConfigIssue[] {
		const issues: ConfigIssue[] = [];
		return issues;
	}

	/**
	 * Get repository information for updates.
	 * @returns Repository owner and name
	 */
	static getRepositoryInfo(): { owner: string; name: string } {
		return { owner: UPDATE_REPO_OWNER, name: UPDATE_REPO_NAME };
	}

	/**
	 * Dispose of event emitters.
	 */
	dispose(): void {
		this._onConfigurationError.dispose();
	}
}
