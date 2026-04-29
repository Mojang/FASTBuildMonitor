// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import semver from "semver";
import { GitHubApiClient, GitHubRelease } from "../utilities/githubApiClient";
import { IFileSystem, VsCodeFileSystem } from "../utilities/fileSystem";
import { ConfigManager } from "../utilities/configManager";
import { Logger } from "../utilities/logger";
import { ErrorFormatter } from "../utilities/errorFormatter";

/**
 * Events emitted by UpdateChecker for UI interactions.
 */
export interface UpdateCheckerEvents {
  onUpdateAvailable: vscode.Event<UpdateAvailableEvent>;
  onAlreadyUpToDate: vscode.Event<AlreadyUpToDateEvent>;
  onUserUpdateCheckFailed: vscode.Event<UserUpdateCheckFailedEvent>;
  onPersistentUpdateCheckFailure: vscode.Event<PersistentFailureEvent>;
  onInstallUpdateNeedsReload: vscode.Event<InstallUpdateNeedsReloadEvent>;
  onInstallUpdateFailed: vscode.Event<InstallUpdateFailedEvent>;
}

export interface UpdateAvailableEvent {
  release: GitHubRelease;
  currentVersion: string;
}

export interface AlreadyUpToDateEvent {
  currentVersion: string;
  latestVersion: string;
}

export interface UserUpdateCheckFailedEvent {
  error: string;
  showNotification: boolean;
}

export interface PersistentFailureEvent {
  scheduledUpdateFailures: number;
  lastError: string;
}

export interface InstallUpdateNeedsReloadEvent {
  release: GitHubRelease;
}

export interface InstallUpdateFailedEvent {
  release: GitHubRelease;
  error: string;
}

export class UpdateChecker implements UpdateCheckerEvents {
  private static readonly LAST_SCHEDULED_UPDATE_ATTEMPTED_KEY =
    "fbuildMonitor.lastScheduledUpdateAttempted";
  private static readonly STATE_SCHEDULED_UPDATE_FAILURES_KEY =
    "fbuildMonitor.scheduledUpdateFailures";
  private static readonly SCHEDULED_UPDATE_FAILURES_THRESHOLD = 3;
  private static readonly GITHUB_AUTH_SCOPES = ["repo"];
  private readonly repoOwner: string;
  private readonly repoName: string;
  private readonly githubApi: GitHubApiClient;
  private readonly fileSystem: IFileSystem;
  private ongoingUpdateCheck: Promise<void> | undefined = undefined;
  private showVerboseNotifications: boolean = false;

  private readonly _onUpdateAvailable =
    new vscode.EventEmitter<UpdateAvailableEvent>();
  private readonly _onAlreadyUpToDate =
    new vscode.EventEmitter<AlreadyUpToDateEvent>();
  private readonly _onUserUpdateCheckFailed =
    new vscode.EventEmitter<UserUpdateCheckFailedEvent>();
  private readonly _onPersistentUpdateCheckFailure =
    new vscode.EventEmitter<PersistentFailureEvent>();
  private readonly _onInstallUpdateNeedsReload =
    new vscode.EventEmitter<InstallUpdateNeedsReloadEvent>();
  private readonly _onInstallUpdateFailed =
    new vscode.EventEmitter<InstallUpdateFailedEvent>();

  readonly onUpdateAvailable = this._onUpdateAvailable.event;
  readonly onAlreadyUpToDate = this._onAlreadyUpToDate.event;
  readonly onUserUpdateCheckFailed = this._onUserUpdateCheckFailed.event;
  readonly onPersistentUpdateCheckFailure =
    this._onPersistentUpdateCheckFailure.event;
  readonly onInstallUpdateNeedsReload = this._onInstallUpdateNeedsReload.event;
  readonly onInstallUpdateFailed = this._onInstallUpdateFailed.event;

  /**
   * Creates a new UpdateChecker instance.
   * @param context - Extension context for accessing global state and package info
   * @param logger - Logger instance for diagnostic output
   * @param configManager - Configuration manager for reading settings
   * @param fileSystem - Optional file system abstraction (defaults to VS Code implementation)
   */
  constructor(
    private context: vscode.ExtensionContext,
    private logger: Logger,
    private configManager: ConfigManager,
    fileSystem?: IFileSystem,
  ) {
    this.fileSystem = fileSystem || new VsCodeFileSystem();
    this.githubApi = new GitHubApiClient(logger, {
      scopes: UpdateChecker.GITHUB_AUTH_SCOPES,
    });

    const repoInfo = ConfigManager.getRepositoryInfo();
    this.repoOwner = repoInfo.owner;
    this.repoName = repoInfo.name;
  }

  private async resetScheduledUpdateFailures(): Promise<void> {
    const previousFailures = this.context.globalState.get<number>(
      UpdateChecker.STATE_SCHEDULED_UPDATE_FAILURES_KEY,
      0,
    );
    if (previousFailures > 0) {
      await this.context.globalState.update(
        UpdateChecker.STATE_SCHEDULED_UPDATE_FAILURES_KEY,
        0,
      );
      this.logger.info(
        `Reset scheduled update failure count (was ${previousFailures})`,
      );
    }
  }

  /**
   * Fetch the latest release from GitHub matching the user's pre-release preference.
   * @returns Release information
   * @throws Error if no matching release found or GitHub API fails
   */
  private async fetchLatestRelease(): Promise<GitHubRelease> {
    try {
      const releases = await this.githubApi.fetchReleases(
        this.repoOwner,
        this.repoName,
      );
      if (releases.length === 0) {
        throw new Error("No releases found in repository");
      }

      return this.findLatestAllowedRelease(releases);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Unable to fetch latest release: ${errorMsg}`, error);
      throw error;
    }
  }

  /**
   * Finds the newest release matching the user's pre-release preference from config.
   *
   * When allowPreRelease is true: Returns the first valid release (pre-release or stable)
   * When allowPreRelease is false: Returns the first valid stable release (skips pre-releases)
   *
   * NOTE: Assumes GitHub repository maintains both a latest pre-release and a latest stable release
   * once an initial stable release has been published. If no stable releases exist yet, users should
   * keep allowPreRelease enabled.
   *
   * @param releases - Array of GitHub releases (newest first)
   * @returns The latest release matching user preferences
   * @throws Error if no suitable release is found
   */
  private findLatestAllowedRelease(releases: GitHubRelease[]): GitHubRelease {
    const allowPreRelease = this.configManager.getAllowPreRelease();
    this.logger.debug(
      `Finding latest allowed release (allowPreRelease=${allowPreRelease})`,
    );

    // Process releases in order until we find a valid one
    for (const release of releases) {
      if(!release.version.startsWith(this.configManager.getTagPrefix())){
        this.logger.debug(
          `Skipping release with non-matching tag prefix: '${release.version}' (expected prefix: '${this.configManager.getTagPrefix()}')`,
        );
        continue;
      }
      let normalized: string;
      let isPreRelease: boolean;

      try {
        normalized = ConfigManager.normalizeVersion(release.version);
        isPreRelease = ConfigManager.isPreReleaseVersion(normalized);
      } catch (error) {
        this.logger.debug(
          `Skipping release with invalid version tag: '${release.version}': ${error instanceof Error ? error : String(error)}`,
        );
        continue;
      }

      // If allowPreRelease is false, skip pre-release versions (odd minor)
      if (allowPreRelease === false && isPreRelease) {
        this.logger.debug(
          `Skipping pre-release ${normalized} (allowPreRelease=false)`,
        );
        continue;
      }

      // Found the latest allowed release
      this.logger.debug(`Selected release: ${release.version}`);
      return release;
    }

    // No valid release found - this violates our assumption
    const errorMsg = `No suitable release found matching allowPreRelease=${allowPreRelease}. This may indicate no stable releases exist yet.`;
    this.logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Checks if remote version is semantically newer than current version
  private isNewerVersion(
    remoteVersion: string,
    currentVersion: string,
  ): boolean {
    let normalizedRemote: string;
    let normalizedCurrent: string;

    try {
      normalizedRemote = ConfigManager.normalizeVersion(remoteVersion);
    } catch (error) {
      this.logger.warn(
        `Invalid remote version format: '${remoteVersion}': ${error instanceof Error ? error : String(error)}`,
      );
      return false;
    }

    try {
      normalizedCurrent = ConfigManager.normalizeVersion(currentVersion);
    } catch (error) {
      this.logger.warn(
        `Invalid current version format: '${currentVersion}': ${error instanceof Error ? error : String(error)}`,
      );
      return false;
    }

    return semver.gt(normalizedRemote, normalizedCurrent);
  }

  /**
   * Check for available updates.
   * This method does not throw.
   * Status and errors are communicated via events rather than thrown exceptions:
   *   - onUpdateAvailable
   *   - onAlreadyUpToDate,
   *   - onUserUpdateCheckFailed
   * @param currentVersion - Current extension version in semver format
   * @param fireVerboseNotifications - Whether verbose update-related notifications should be shown (e.g. already up-to-date, update check failed)
   */
  public async checkForUpdates(
    currentVersion: string,
    fireVerboseNotifications: boolean,
  ): Promise<void> {
    // Set notification flag BEFORE checking for ongoing update to prevent race conditions.
    // If a user-initiated call arrives while an update is running, this ensures the flag
    // is set before the ongoing check completes and fires events.
    if (fireVerboseNotifications) {
      this.showVerboseNotifications = true;
    }

    if (this.ongoingUpdateCheck) {
      this.logger.info(
        "Update check already in progress, waiting for it to complete",
      );
      await this.ongoingUpdateCheck;
      return;
    }

    this.ongoingUpdateCheck = (async () => {
      try {
        // DO NOT REMOVE THIS AS A REDUNDANT CHECK WITHOUT FULLY UNDERSTANDING THE NOTE BELOW.
        // Re-set notification flag in case a previous update check finished between
        // the initial flag assignment and the promise assignment.
        // This ensures a fresh update check has the correct flag value.
        if (fireVerboseNotifications) {
          this.showVerboseNotifications = true;
        }

        this.logger.info("Checking for updates...");

        const latestRelease = await this.fetchLatestRelease();
        if (this.isNewerVersion(latestRelease.version, currentVersion)) {
          this.logger.info(
            `New version available: ${latestRelease.version} (current: ${currentVersion})`,
          );
          await this.resetScheduledUpdateFailures();
          this._onUpdateAvailable.fire({
            release: latestRelease,
            currentVersion,
          });
        } else {
          this.logger.info(
            `Extension is up to date: ${currentVersion} (latest: ${latestRelease.version})`,
          );
          await this.resetScheduledUpdateFailures();
          if (this.showVerboseNotifications) {
            this._onAlreadyUpToDate.fire({
              currentVersion,
              latestVersion: latestRelease.version,
            });
          }
        }
      } catch (error) {
        this.logger.error("Failed to check for updates", error);
        const errorMsg = ErrorFormatter.getErrorMessage(error);

        this._onUserUpdateCheckFailed.fire({
          error: errorMsg,
          showNotification: this.showVerboseNotifications,
        });
      } finally {
        this.ongoingUpdateCheck = undefined;
        this.showVerboseNotifications = false;
      }
    })();

    await this.ongoingUpdateCheck;
  }

  /**
   * Install an update from a GitHub release.
   * @param release - The release to install
   */
  public async installUpdate(release: GitHubRelease): Promise<void> {
    const vsixAsset = release.assets.find((a) => a.name.endsWith(".vsix"));
    if (!vsixAsset) {
      const errorMsg = "No VSIX file found in release assets";
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    await this.installUpdateFromAsset(vsixAsset, release);
  }

  /**
   * Downloads and verifies VSIX update file from GitHub.
   * @param vsixAsset - Asset information for the VSIX file
   * @param release - Release information containing all assets
   * @returns URI of the downloaded and verified VSIX file
   * @throws Error if download fails, checksum is missing, or verification fails
   */
  private async downloadAndValidateVSIX(
    vsixAsset: {
      id: number;
      name: string;
      url: string;
      browser_download_url: string;
    }
  ): Promise<vscode.Uri> {
    const githubAuthSession = await this.githubApi.getAuthSession(true);
    if (!githubAuthSession) {
      throw new Error(
        "GitHub authentication is required to download the update package.",
      );
    }

    const vsixDownloadUrl = vsixAsset.url;
    this.logger.debug(`Downloading VSIX from: ${vsixDownloadUrl}`);

    const assetDownloadBuffer = await this.githubApi.downloadAsset(
      vsixDownloadUrl,
      githubAuthSession,
    );
    this.logger.debug(`Downloaded ${assetDownloadBuffer.byteLength} bytes`);

    const tempFile = path.join(
      os.tmpdir(),
      `fbuildMonitor-${crypto.randomUUID()}.vsix`,
    );
    const tempUri = vscode.Uri.file(tempFile);
    this.logger.debug(`Writing VSIX to temporary file: ${tempFile}`);

    await this.fileSystem.writeFile(
      tempUri,
      new Uint8Array(assetDownloadBuffer),
    );
    this.logger.debug("VSIX file written successfully");

    return tempUri;
  }

  /**
   * Installs VSIX update from a local file.
   * @param vsixAsset - Asset information for the VSIX file
   * @param release - Release information
   */
  private async installUpdateFromAsset(
    vsixAsset: {
      id: number;
      name: string;
      url: string;
      browser_download_url: string;
    },
    release: GitHubRelease,
  ): Promise<void> {
    if (!vscode.workspace.isTrusted) {
      const errorMsg =
        "Cannot install extension updates in an untrusted workspace. Please trust the workspace first.";
      this.logger.warn(errorMsg);
      this._onInstallUpdateFailed.fire({
        release,
        error: errorMsg,
      });
      return;
    }

    let tempUri: vscode.Uri | undefined;

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: "Installing FASTBuild Monitor update...",
        },
        async (progress) => {
          progress.report({ message: "Downloading update..." });
          tempUri = await this.downloadAndValidateVSIX(vsixAsset);

          progress.report({ message: "Installing update..." });
          this.logger.debug(
            `Executing workbench.extensions.installExtension command with URI: ${tempUri.fsPath}`,
          );
          try {
            await vscode.commands.executeCommand(
              "workbench.extensions.installExtension",
              tempUri,
            );
            this.logger.info(
              "Extension installation command completed successfully",
            );
          } catch (installError) {
            this.logger.error("Installation command failed", installError);
            throw installError;
          }
        },
      );

      this._onInstallUpdateNeedsReload.fire({ release });
    } catch (error) {
      this.logger.error("Failed to install FASTBuild Monitor update", error);
      const errorMsg = ErrorFormatter.getErrorMessage(error);
      this._onInstallUpdateFailed.fire({
        release,
        error: errorMsg,
      });
    } finally {
      if (tempUri) {
        try {
          await this.fileSystem.delete(tempUri);
          this.logger.debug("Temporary VSIX file deleted successfully");
        } catch (cleanupError) {
          this.logger.error(
            "Failed to delete temporary VSIX file",
            cleanupError,
          );
        }
      }
    }
  }

  /**
   * Dispose of event emitters when the UpdateChecker is no longer needed.
   */
  dispose(): void {
    this._onUpdateAvailable.dispose();
    this._onAlreadyUpToDate.dispose();
    this._onUserUpdateCheckFailed.dispose();
    this._onPersistentUpdateCheckFailure.dispose();
    this._onInstallUpdateNeedsReload.dispose();
    this._onInstallUpdateFailed.dispose();
  }
}
