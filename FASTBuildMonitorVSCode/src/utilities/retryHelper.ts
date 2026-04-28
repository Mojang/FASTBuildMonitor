// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Logger } from './logger';

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_INITIAL_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30000;
const RETRY_BACKOFF_MULTIPLIER = 2;

/**
 * Configuration for retry behavior.
 */
export interface RetryOptions {
	maxAttempts?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
	backoffMultiplier?: number;
}

/**
 * Utility for retrying operations with exponential backoff.
 */
export class RetryHelper {
	private readonly maxAttempts: number;
	private readonly initialDelayMs: number;
	private readonly maxDelayMs: number;
	private readonly backoffMultiplier: number;

	constructor(
		private logger: Logger,
		options: RetryOptions = {}
	) {
		this.maxAttempts = options.maxAttempts ?? RETRY_MAX_ATTEMPTS;
		this.initialDelayMs = options.initialDelayMs ?? RETRY_INITIAL_DELAY_MS;
		this.maxDelayMs = options.maxDelayMs ?? RETRY_MAX_DELAY_MS;
		this.backoffMultiplier = options.backoffMultiplier ?? RETRY_BACKOFF_MULTIPLIER;
	}

	/**
	 * Execute an operation with retry logic.
	 * @param operation - Async function to execute
	 * @param operationName - Name of the operation for logging
	 * @returns Result of the operation
	 * @throws Last error if all retries fail
	 */
	async executeWithRetry<T>(
		operation: () => Promise<T>,
		operationName: string
	): Promise<T> {
		let lastError: Error | undefined;
		let delay = this.initialDelayMs;

		for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
			try {
				this.logger.debug(`${operationName} - Attempt ${attempt}/${this.maxAttempts}`);
				return await operation();
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				this.logger.warn(
					`${operationName} - Attempt ${attempt}/${this.maxAttempts} failed: ${lastError.message}`
				);

				if (attempt < this.maxAttempts) {
					this.logger.debug(`Retrying in ${delay}ms...`);
					await this.sleep(delay);
					delay = Math.min(delay * this.backoffMultiplier, this.maxDelayMs);
				}
			}
		}

		this.logger.error(`${operationName} - All ${this.maxAttempts} attempts failed`);
		throw lastError || new Error(`${operationName} failed after ${this.maxAttempts} attempts`);
	}

	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}
