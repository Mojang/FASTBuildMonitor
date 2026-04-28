// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { BuildMonitorService } from "./buildMonitorService";
import { MonitorPanel } from "./monitorPanel";
import { UpdateChecker } from "./updates/updateChecker";
import { Logger } from "./utilities/logger";
import { ConfigIssue, ConfigManager } from "./utilities/configManager";
import { ErrorFormatter } from "./utilities/errorFormatter";

let service: BuildMonitorService | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const logger = Logger.getInstance();
  context.subscriptions.push(logger.getOutputChannel());

  const config = vscode.workspace.getConfiguration("fbuildMonitor");
  const customLogPath = config.get<string>("logPath", "");

  service = new BuildMonitorService(customLogPath || undefined);

  // Show panel command
  context.subscriptions.push(
    vscode.commands.registerCommand("fbuildMonitor.show", () => {
      MonitorPanel.createOrShow(context.extensionUri, service!);
    }),
  );

  // Start monitoring command
  context.subscriptions.push(
    vscode.commands.registerCommand("fbuildMonitor.start", () => {
      const pollInterval = config.get<number>("pollIntervalMs", 500);
      service!.start(pollInterval);
      // Also open the panel if not already open
      MonitorPanel.createOrShow(context.extensionUri, service!);
    }),
  );

  // Stop monitoring command
  context.subscriptions.push(
    vscode.commands.registerCommand("fbuildMonitor.stop", () => {
      service!.stop();
    }),
  );

  // Status bar item
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50,
  );
  statusBarItem.text = "$(tools) FASTBuild";
  statusBarItem.tooltip = "Open FASTBuild Monitor";
  statusBarItem.command = "fbuildMonitor.show";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Update status bar on build events
  service.on("stateChanged", () => {
    const session = service!.getCurrentSession();
    if (session && !session.endTime) {
      const progress = session.progress.toFixed(0);
      statusBarItem.text = `$(sync~spin) FASTBuild ${progress}%`;
    } else if (session?.endTime) {
      const failed = session.jobs.filter(
        (j) => j.status === "Failed" || j.status === "Error",
      ).length;
      statusBarItem.text =
        failed > 0 ? `$(error) FASTBuild FAILED` : `$(check) FASTBuild Done`;
    } else {
      statusBarItem.text = "$(tools) FASTBuild";
    }
  });

  try {
		const version = (context.extension.packageJSON as { version?: string }).version || 'unknown';
		logger.info(`Activating FASTBuild Monitor extension v${version}...`);

		// Initialize and validate configuration
		const configManager = await initializeConfiguration(context, logger);

		const updateChecker = new UpdateChecker(context, logger, configManager);
		await initializeUpdateChecker(context, logger, configManager, updateChecker);

		logger.info('FASTBuild Monitor extension activated successfully');
	} catch (error) {
		logger.error('Failed to activate FASTBuild Monitor extension', error);
		vscode.window.showErrorMessage(
			'FASTBuild Monitor failed to activate. Check the output panel for details.',
			'View Output'
		).then(selection => {
			if (selection === 'View Output') {
				logger.show();
			}
		});
		throw error;
	}
}

export function deactivate() {
  service?.stop();
}

/**
 * Initialize and validate configuration.
 * @param context - Extension context
 * @param logger - Logger instance
 * @returns Configured ConfigManager instance
 */
async function initializeConfiguration(
	context: vscode.ExtensionContext,
	logger: Logger
): Promise<ConfigManager> {
	const configManager = new ConfigManager(logger, context);
	context.subscriptions.push(configManager);

	// Subscribe to configuration errors
	configManager.onConfigurationError(event => {
		vscode.window.showErrorMessage(
			`Invalid ${event.setting} setting: ${event.message}`,
			'Open Settings'
		).then(selection => {
			if (selection === 'Open Settings') {
				vscode.commands.executeCommand('workbench.action.openSettings', event.setting);
			}
		});
	});

	// Check and auto-configure settings
	const configIssues = await configManager.checkConfigAndSetDefaults();

	// Block activation if there are configuration errors
	const hasErrors = configIssues.some(i => i.severity === 'error');
	if (hasErrors) {
		displayConfigIssues(logger, configIssues);
		throw new Error('Extension activation blocked due to configuration errors. Fix the issues and reload VS Code.');
	}

	// Show warnings but allow activation to continue
	if (configIssues.some(i => i.severity === 'warning') || configIssues.some(i => i.severity === 'info')) {
		displayConfigIssues(logger, configIssues);
	}

	return configManager;
}

/**
 * Display configuration issues to the user.
 * @param logger - Logger instance
 * @param issues - Array of configuration issues to display
 */
 function displayConfigIssues(logger: Logger, issues: ConfigIssue[]) {
   if (issues.length === 0) {
     return;
   }

   const errors = issues.filter((i) => i.severity === "error");
   const warnings = issues.filter((i) => i.severity === "warning");

   if (errors.length > 0) {
     const message =
       errors.length === 1
         ? `FASTBuild Monitor: ${errors[0].message}`
         : `FASTBuild Monitor configuration issues:\n${errors.map((e) => `• ${e.message}`).join("\n")}`;
     vscode.window
       .showErrorMessage(message, "View Details")
       .then((selection) => {
         if (selection === "View Details") {
           showDetailedReport(logger, issues);
         }
       });
   } else if (warnings.length > 0) {
     const message =
       warnings.length === 1
         ? warnings[0].message
         : `${warnings.map((w) => w.message).join("\n")}`;
     vscode.window
       .showWarningMessage(message, "View Details")
       .then((selection) => {
         if (selection === "View Details") {
           showDetailedReport(logger, issues);
         }
       });
   }
 }


/**
 * Show detailed configuration report in output channel.
 * @param logger - Logger instance
 * @param issues - Array of configuration issues to report
 */
function showDetailedReport(logger: Logger, issues: ConfigIssue[]): void {
	logger.info('=== FASTBuild Monitor Configuration Report ===');
	logger.info('');

	const hasErrors = issues.some(i => i.severity === 'error');
	logger.info(`Overall Status: ${hasErrors ? 'FAILED' : 'PASSED'}`);
	logger.info('');

	const groupedIssues = {
		error: issues.filter(i => i.severity === 'error'),
		warning: issues.filter(i => i.severity === 'warning'),
		info: issues.filter(i => i.severity === 'info')
	};

	if (groupedIssues.error.length > 0) {
		logger.info('ERRORS:');
		groupedIssues.error.forEach(issue => {
			logger.info(`  ERROR: ${issue.message}`);
			if (issue.setting) {
				logger.info(`     Setting: ${issue.setting}`);
			}
		});
		logger.info('');
	}

	if (groupedIssues.warning.length > 0) {
		logger.info('WARNINGS:');
		groupedIssues.warning.forEach(issue => {
			logger.info(`  WARNING: ${issue.message}`);
			if (issue.setting) {
				logger.info(`     Setting: ${issue.setting}`);
			}
		});
		logger.info('');
	}

	if (groupedIssues.info.length > 0) {
		logger.info('RECOMMENDATIONS:');
		groupedIssues.info.forEach(issue => {
			logger.info(`  INFO: ${issue.message}`);
			if (issue.setting) {
				logger.info(`     Setting: ${issue.setting}`);
			}
		});
		logger.info('');
	}

	logger.show();
}

/**
 * Initialize update checker with event handlers and periodic checks.
 * @param context - Extension context
 * @param logger - Logger instance
 * @param configManager - Configuration manager
 * @param updateChecker - Update checker instance
 */
async function initializeUpdateChecker(
	context: vscode.ExtensionContext,
	logger: Logger,
	configManager: ConfigManager,
	updateChecker: UpdateChecker
): Promise<void> {
	const extensionVersion = (context.extension.packageJSON as { version: string }).version;
	context.subscriptions.push(updateChecker);

	updateChecker.onUpdateAvailable(event => {
		const message = event.release.prerelease
			? `FASTBuild Monitor pre-release ${event.release.version} is available!`
			: `FASTBuild Monitor ${event.release.version} is available!`;

		const vsixAsset = event.release.assets.find(a => a.name.endsWith('.vsix'));
		const actions = vsixAsset
			? ['Install Update', 'View Release', 'Remind Me Later']
			: ['View Release', 'Remind Me Later'];

		vscode.window.showInformationMessage(message, ...actions).then(async selection => {
			if (selection === 'Install Update') {
				try {
					await updateChecker.installUpdate(event.release);
				} catch (error) {
					logger.error('Failed to install update', error);
					vscode.window.showErrorMessage(
						ErrorFormatter.formatErrorObject(error, 'Unable to install update')
					);
				}
			} else if (selection === 'View Release') {
				vscode.env.openExternal(vscode.Uri.parse(event.release.html_url));
			}
		});
	});

	updateChecker.onAlreadyUpToDate(event => {
		vscode.window.showInformationMessage(
			`FASTBuild Monitor is up to date (${event.currentVersion})`
		);
	});

	updateChecker.onUserUpdateCheckFailed(event => {
		if (event.showNotification) {
			vscode.window.showErrorMessage(
				`Failed to check for updates: ${event.error}`,
				'View Output'
			).then(selection => {
				if (selection === 'View Output') {
					logger.show();
				}
			});
		}
	});

	updateChecker.onPersistentUpdateCheckFailure(event => {
		vscode.window.showWarningMessage(
			ErrorFormatter.formatError(
				`Update checks have failed ${event.scheduledUpdateFailures} times in a row. Last error: ${event.lastError}`
			),
			'View Output'
		).then(selection => {
			if (selection === 'View Output') {
				logger.show();
			}
		});
	});

	updateChecker.onInstallUpdateNeedsReload(() => {
		vscode.window.showInformationMessage(
			'FASTBuild Monitor update installed. Reload to finish applying the update.',
			'Reload Now',
			'Later'
		).then(selection => {
			if (selection === 'Reload Now') {
				vscode.commands.executeCommand('workbench.action.reloadWindow');
			}
		});
	});

	updateChecker.onInstallUpdateFailed(event => {
		vscode.window.showErrorMessage(
			`Failed to install update: ${event.error}`,
			'View Release'
		).then(selection => {
			if (selection === 'View Release') {
				vscode.env.openExternal(vscode.Uri.parse(event.release.html_url));
			}
		});
	});

	await updateChecker.checkForUpdates(extensionVersion, false);
}