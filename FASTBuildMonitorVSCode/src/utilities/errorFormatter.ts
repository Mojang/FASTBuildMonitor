// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Utility for consistent error message formatting across the extension.
 */
export class ErrorFormatter {
	private static readonly EXTENSION_PREFIX = 'FASTBuild Monitor';

	/**
	 * Format an error message for display to the user.
	 * @param message - The error message
	 * @param includePrefix - Whether to include the extension name prefix
	 * @returns Formatted error message
	 */
	static formatError(message: string, includePrefix: boolean = true): string {
		return includePrefix ? `${this.EXTENSION_PREFIX}: ${message}` : message;
	}

	/**
	 * Format an error object into a user-friendly message.
	 * @param error - The error object
	 * @param context - Optional context about where the error occurred
	 * @param includePrefix - Whether to include the extension name prefix
	 * @returns Formatted error message
	 */
	static formatErrorObject(error: unknown, context?: string, includePrefix: boolean = true): string {
		const errorMsg = error instanceof Error ? error.message : String(error);
		const contextPart = context ? `${context}: ` : '';
		const fullMessage = `${contextPart}${errorMsg}`;
		return includePrefix ? `${this.EXTENSION_PREFIX}: ${fullMessage}` : fullMessage;
	}

	/**
	 * Extract error message from an unknown error object.
	 * @param error - The error object
	 * @returns Error message string
	 */
	static getErrorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}
}
