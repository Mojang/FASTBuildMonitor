// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { Logger } from './logger.js';
import { RetryHelper } from './retryHelper.js';

export interface GitHubReleaseAsset {
	id: number;
	name: string;
	url: string;
	browser_download_url: string;
}

export interface GitHubRelease {
	version: string;
	name: string;
	prerelease: boolean;
	html_url: string;
	assets: GitHubReleaseAsset[];
}

interface GitHubApiRelease {
	tag_name: string;
	name: string;
	prerelease: boolean;
	html_url: string;
	assets: GitHubReleaseAsset[];
}

export interface GitHubApiOptions {
	scopes: string[];
}

/**
 * Client for interacting with the GitHub API.
 * Handles authentication, release fetching, and asset downloads.
 */
export class GitHubApiClient {
	private static readonly API_VERSION = '2022-11-28';
	private readonly retryHelper: RetryHelper;

	/**
	 * Creates a new GitHubApiClient instance.
	 * @param logger - Logger instance for diagnostic output
	 * @param options - API options including required OAuth scopes
	 */
	constructor(
		private logger: Logger,
		private options: GitHubApiOptions
	) {
		this.retryHelper = new RetryHelper(logger);
	}

	/**
	 * Gets a GitHub authentication session.
	 * @param promptForLogin - Whether to prompt the user to login if not authenticated
	 * @returns Authentication session or undefined if not available
	 */
	async getAuthSession(promptForLogin: boolean): Promise<vscode.AuthenticationSession | undefined> {
		try {
			return await vscode.authentication.getSession('github', this.options.scopes, {
				createIfNone: promptForLogin,
				silent: !promptForLogin,
				clearSessionPreference: false
			});
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			this.logger.error(`GitHub authentication request failed: ${errorMsg}`, error);
			return undefined; 
		}
	}

	/**
	 * Fetches releases from a GitHub repository.
	 * @param owner - Repository owner
	 * @param repo - Repository name
	 * @returns Array of releases, or empty array if authentication fails
	 */
	async fetchReleases(owner: string, repo: string): Promise<GitHubRelease[]> {
		const session = await this.getAuthSession(true);
		if (!session) {
			this.logger.warn('GitHub authentication required to retrieve release information; no session available.');
			void vscode.window.showWarningMessage('Sign in to GitHub to check for FASTBuild Monitor updates.');
			return [];
		}

		return await this.retryHelper.executeWithRetry(
			async () => await this.fetchReleasesInternal(owner, repo, session),
			'Fetch GitHub releases'
		);
	}

	private async fetchReleasesInternal(
		owner: string,
		repo: string,
		session: vscode.AuthenticationSession
	): Promise<GitHubRelease[]> {
		const url = `https://api.github.com/repos/${owner}/${repo}/releases`;
		this.logger.debug(`Fetching releases from: ${url}`);

		const headers: Record<string, string> = {
			'Accept': 'application/vnd.github+json',
			'X-GitHub-Api-Version': GitHubApiClient.API_VERSION,
			'Authorization': `Bearer ${session.accessToken}`
		};

		// Log authentication without exposing token
		this.logger.debug(`Using authenticated GitHub API request (account: ${session.account.label})`);

		const response = await fetch(url, { headers });
		this.logger.debug(`GitHub API response: ${response.status} ${response.statusText}`);

		if (!response.ok) {
			const errorMsg = `GitHub API returned ${response.status} ${response.statusText}`;
			this.logger.error(errorMsg);
			throw new Error(errorMsg);
		}

		const rawReleases = await response.json() as GitHubApiRelease[];
		this.logger.debug(`Fetched ${rawReleases.length} releases`);

		// Map GitHub API response to GitHubRelease interface
		// GitHub API returns 'tag_name' but our interface expects 'version'
		const releases: GitHubRelease[] = rawReleases.map(r => ({
			version: r.tag_name,
			name: r.name,
			prerelease: r.prerelease,
			html_url: r.html_url,
			assets: r.assets
		}));

		return releases;
	}

	/**
	 * Downloads a binary asset from GitHub.
	 * @param assetUrl - GitHub API URL for the asset
	 * @param session - Authenticated GitHub session
	 * @returns Binary content as ArrayBuffer
	 */
	async downloadAsset(assetUrl: string, session: vscode.AuthenticationSession): Promise<ArrayBuffer> {
		return await this.retryHelper.executeWithRetry(
			async () => await this.downloadAssetInternal(assetUrl, session),
			'Download GitHub asset'
		);
	}

	private async downloadAssetInternal(
		assetUrl: string,
		session: vscode.AuthenticationSession
	): Promise<ArrayBuffer> {
		const headers: Record<string, string> = {
			'Accept': 'application/octet-stream',
			'Authorization': `Bearer ${session.accessToken}`,
			'X-GitHub-Api-Version': GitHubApiClient.API_VERSION
		};

		this.logger.debug(`Downloading asset from: ${assetUrl}`);

		const response = await fetch(assetUrl, { headers });
		this.logger.debug(`Asset download response: ${response.status} ${response.statusText}`);

		if (!response.ok) {
			const errorMsg = `Asset download failed with status ${response.status} ${response.statusText}`;
			this.logger.error(errorMsg);
			throw new Error(errorMsg);
		}

		const buffer = await response.arrayBuffer();
		this.logger.debug(`Downloaded ${buffer.byteLength} bytes`);

		return buffer;
	}

	/**
	 * Downloads text content from GitHub.
	 * @param url - GitHub API URL for the text file
	 * @param session - Authenticated GitHub session
	 * @returns Text content as string
	 */
	async downloadText(url: string, session: vscode.AuthenticationSession): Promise<string> {
		const headers: Record<string, string> = {
			'Accept': 'application/octet-stream',
			'Authorization': `Bearer ${session.accessToken}`,
			'X-GitHub-Api-Version': GitHubApiClient.API_VERSION
		};

		this.logger.debug(`Downloading text from: ${url}`);

		const response = await fetch(url, { headers });

		if (!response.ok) {
			this.logger.warn(`Text download failed with status ${response.status}`);
			throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
		}

		return await response.text();
	}
}
