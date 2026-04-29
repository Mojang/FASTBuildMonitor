// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import semver from 'semver';
import { Logger } from './logger.js';

const CONFIG_SECTION = 'fbuildMonitor';
const CONFIG_UPDATE_INTERVAL_HOURS = 'updateCheckIntervalHours';
const CONFIG_ALLOW_PRERELEASE = 'allowPreRelease';
const UPDATE_CHECK_MIN_HOURS = 1;
const UPDATE_CHECK_MAX_HOURS = 168;
const UPDATE_CHECK_DEFAULT_HOURS = 8;
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
	 * Get the update check interval in hours with validation.
	 * Returns the default value if the configured value is invalid.
	 */
	getUpdateIntervalHours(): number {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		const value = config.get<number>(CONFIG_UPDATE_INTERVAL_HOURS, UPDATE_CHECK_DEFAULT_HOURS);

		if (value < UPDATE_CHECK_MIN_HOURS || value > UPDATE_CHECK_MAX_HOURS) {
			const errorMsg = `Invalid ${CONFIG_UPDATE_INTERVAL_HOURS} value: ${value}. Must be between ${UPDATE_CHECK_MIN_HOURS} and ${UPDATE_CHECK_MAX_HOURS} hours.`;
			this.logger.warn(errorMsg);
			this._onConfigurationError.fire({
				setting: CONFIG_UPDATE_INTERVAL_HOURS,
				value,
				message: errorMsg
			});
			return UPDATE_CHECK_DEFAULT_HOURS;
		}

		return value;
	}

	/**
	 * Get the allowPreRelease setting.
	 * After checkConfigAndSetDefaults() has been called, this will always return a boolean value.
	 * @returns true (always allow pre-releases) or false (stable releases only)
	 */
	getAllowPreRelease(): boolean {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		const value = config.get<boolean | null>(CONFIG_ALLOW_PRERELEASE);
		// After checkConfig(), this should never be null, but default to false for safety
		return value ?? false;
	}

	/**
	 * Get the tag prefix used for identifying update releases.
	 */
	getTagPrefix(): string {
		return UPDATE_TAG_PREFIX;
	}

	/**
	 * Set the allowPreRelease setting globally.
	 */
	async setAllowPreRelease(value: boolean): Promise<void> {
		try {
			const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
			await config.update(CONFIG_ALLOW_PRERELEASE, value, vscode.ConfigurationTarget.Global);
			this.logger.info(`${CONFIG_ALLOW_PRERELEASE} set to ${value}`);
		} catch (error) {
			this.logger.error(`Failed to update ${CONFIG_ALLOW_PRERELEASE} setting to ${value}`, error);
			throw error;
		}
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
		const currentVersion = this.getCurrentVersion();
		this.logger.info('Checking configuration...');

		const issues: ConfigIssue[] = [];

		// Determine pre-release status once during initialization
		try {
			this.isCurrentVersionPreRelease = ConfigManager.isPreReleaseVersion(currentVersion);
		} catch (error) {
			const errorMsg = `Cannot determine pre-release status for current version: '${currentVersion}'`;
			this.logger.error(errorMsg, error);
			issues.push({
				severity: 'error',
				setting: 'version',
				message: errorMsg
			});
			return issues;
		}

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
	private async updateSettings(): Promise<ConfigIssue[]> {
		const currentVersion = this.getCurrentVersion();
		const issues: ConfigIssue[] = [];
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

		// Auto-configure allowPreRelease if not set
		const allowPreRelease = config.get<boolean | undefined>(CONFIG_ALLOW_PRERELEASE);
		if (allowPreRelease === undefined) {
			const defaultValue = this.isCurrentVersionPreRelease;
			this.logger.info(`Auto-configuring ${CONFIG_ALLOW_PRERELEASE}=${defaultValue} (current version ${currentVersion} is ${this.isCurrentVersionPreRelease ? 'pre-release' : 'release'})`);
			await this.setAllowPreRelease(defaultValue);
			issues.push({
				severity: 'info',
				setting: CONFIG_ALLOW_PRERELEASE,
				message: `Auto-configured ${CONFIG_ALLOW_PRERELEASE} to ${defaultValue} based on current version`,
				autoFixed: true
			});
		}

		return issues;
	}

	/**
	 * Validate settings.
	 */
	private validateSettings(): ConfigIssue[] {
		const currentVersion = this.getCurrentVersion();
		const issues: ConfigIssue[] = [];
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

		// Warn if pre-release extension configured for stable-only updates
		const allowPreRelease = config.get<boolean | null>(CONFIG_ALLOW_PRERELEASE);
		if (this.isCurrentVersionPreRelease && allowPreRelease === false) {
			const message = `You are running a pre-release version (${currentVersion}) but ${CONFIG_ALLOW_PRERELEASE} is set to false. You will only receive stable release updates.`;
			this.logger.warn(message);
			issues.push({
				severity: 'warning',
				setting: CONFIG_ALLOW_PRERELEASE,
				message
			});
		}

		// Validate updateCheckIntervalHours
		const interval = config.get<number>(CONFIG_UPDATE_INTERVAL_HOURS);
		if (interval !== undefined && (interval < UPDATE_CHECK_MIN_HOURS || interval > UPDATE_CHECK_MAX_HOURS)) {
			const message = `Invalid ${CONFIG_UPDATE_INTERVAL_HOURS}: ${interval}. Must be between ${UPDATE_CHECK_MIN_HOURS} and ${UPDATE_CHECK_MAX_HOURS} hours. Using default ${UPDATE_CHECK_DEFAULT_HOURS} hours.`;
			this.logger.warn(message);
			issues.push({
				severity: 'warning',
				setting: CONFIG_UPDATE_INTERVAL_HOURS,
				message
			});
		}

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
	 * Check if a version is a pre-release based on VS Code convention (odd minor version).
	 * @param version - Version string to check
	 * @returns true if pre-release, false otherwise
	 * @throws Error if version cannot be parsed
	 */
	static isPreReleaseVersion(version: string): boolean {
		version = version.trim().replace(UPDATE_TAG_PREFIX, '');
		const normalized = ConfigManager.normalizeVersion(version);
		const parsed = semver.parse(normalized);
		if (!parsed) {
			throw new Error(`semver.parse failed for normalized version: '${normalized}'`);
		}
		// VS Code standard: odd minor version = pre-release
		return parsed.minor % 2 !== 0;
	}

	/**
	 * Normalize a version string to valid semver format.
	 * @param version - Version string to normalize
	 * @returns Normalized version
	 * @throws Error if version cannot be normalized
	 */
	static normalizeVersion(version: string): string {
		const cleaned = semver.clean(version, { loose: true });
		if (cleaned) return cleaned;

		const coerced = semver.coerce(version);
		if (coerced) {
			return coerced.version;
		}

		throw new Error(`Unable to normalize version string: '${version}'`);
	}

	/**
	 * Dispose of event emitters.
	 */
	dispose(): void {
		this._onConfigurationError.dispose();
	}
}
