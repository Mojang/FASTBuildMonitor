// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ConfigManager } from '../../src/utilities/configManager';
import { ErrorFormatter } from '../../src/utilities/errorFormatter';
import { VsCodeFileSystem } from '../../src/utilities/fileSystem';
import { getNonce } from '../../src/utilities/getNonce';
import { getUri } from '../../src/utilities/getUri';
import { Logger } from '../../src/utilities/logger';
import { configuration, createContext, outputChannel, workspace } from '../mocks/vscode';

afterEach(() => Logger.getInstance().dispose());

describe('error formatting', () => {
    it('formats messages with optional prefix and context', () => {
        expect(ErrorFormatter.formatError('failed')).toBe('FASTBuild Monitor: failed');
        expect(ErrorFormatter.formatError('failed', false)).toBe('failed');
        expect(ErrorFormatter.formatErrorObject(new Error('failed'), 'read')).toBe('FASTBuild Monitor: read: failed');
        expect(ErrorFormatter.formatErrorObject('failed', undefined, false)).toBe('failed');
        expect(ErrorFormatter.formatErrorObject(42)).toBe('FASTBuild Monitor: 42');
        expect(ErrorFormatter.getErrorMessage(new Error('failed'))).toBe('failed');
        expect(ErrorFormatter.getErrorMessage(undefined)).toBe('undefined');
    });
});

describe('logger', () => {
    it('uses the configured channel, timestamps all levels, and shares one instance', () => {
        configuration.set('logChannelName', 'Custom log');
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        const logger = Logger.getInstance();
        expect(Logger.getInstance()).toBe(logger);
        expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('Custom log');
        logger.info('info');
        logger.warn('warn');
        logger.debug('debug');
        logger.error('error');
        expect(outputChannel.appendLine.mock.calls.map(([line]) => line)).toEqual([
            '[2026-01-01T00:00:00.000Z] INFO: info',
            '[2026-01-01T00:00:00.000Z] WARN: warn',
            '[2026-01-01T00:00:00.000Z] DEBUG: debug',
            '[2026-01-01T00:00:00.000Z] ERROR: error',
        ]);
        expect(logger.getOutputChannel()).toBe(outputChannel);
        logger.show();
        expect(outputChannel.show).toHaveBeenCalledOnce();
    });

    it('logs Error details, optional stacks and non-Error values', () => {
        const logger = Logger.getInstance();
        const error = new Error('detail');
        error.stack = 'stack';
        logger.error('failed', error);
        expect(outputChannel.appendLine).toHaveBeenCalledWith('  detail');
        expect(outputChannel.appendLine).toHaveBeenCalledWith('  Stack trace:\nstack');
        error.stack = undefined;
        logger.error('failed without stack', error);
        logger.error('failed', 42);
        expect(outputChannel.appendLine).toHaveBeenCalledWith('  42');
    });

    it('disposes only once and recreates a disposed singleton', () => {
        const logger = Logger.getInstance();
        logger.dispose();
        logger.dispose();
        expect(outputChannel.dispose).toHaveBeenCalledOnce();
        expect(Logger.getInstance()).not.toBe(logger);
        expect(vscode.window.createOutputChannel).toHaveBeenLastCalledWith('FASTBuild Monitor');
    });
});

describe('VS Code utilities', () => {
    it('delegates file operations and propagates failures', async () => {
        const fs = new VsCodeFileSystem();
        const uri = vscode.Uri.parse('file:///test');
        const contents = new Uint8Array([1, 2, 3]);
        const stat = { type: vscode.FileType.File, ctime: 1, mtime: 2, size: 3 };
        workspace.fs.readFile.mockResolvedValue(contents);
        workspace.fs.stat.mockResolvedValue(stat);
        await fs.writeFile(uri, contents);
        expect(workspace.fs.writeFile).toHaveBeenCalledWith(uri, contents);
        expect(await fs.readFile(uri)).toBe(contents);
        expect(workspace.fs.readFile).toHaveBeenCalledWith(uri);
        expect(await fs.stat(uri)).toBe(stat);
        expect(workspace.fs.stat).toHaveBeenCalledWith(uri);
        await fs.delete(uri);
        expect(workspace.fs.delete).toHaveBeenCalledWith(uri);
        const error = new Error('Permission denied');
        workspace.fs.readFile.mockRejectedValue(error);
        workspace.fs.writeFile.mockRejectedValue(error);
        workspace.fs.stat.mockRejectedValue(error);
        workspace.fs.delete.mockRejectedValue(error);
        await expect(fs.readFile(uri)).rejects.toBe(error);
        await expect(fs.writeFile(uri, contents)).rejects.toBe(error);
        await expect(fs.stat(uri)).rejects.toBe(error);
        await expect(fs.delete(uri)).rejects.toBe(error);
    });

    it('creates 32-character alphanumeric nonces', () => {
        vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValue(0.999);
        expect(getNonce()).toBe(`A${'9'.repeat(31)}`);
        expect(getNonce()).toMatch(/^[A-Za-z0-9]{32}$/);
    });

    it('joins resource paths before converting to a webview URI', () => {
        const converted = vscode.Uri.parse('https://webview/resource');
        const webview = { asWebviewUri: vi.fn(() => converted) } as Pick<vscode.Webview, 'asWebviewUri'>;
        expect(getUri(webview as vscode.Webview, vscode.Uri.parse('file:///extension'), ['build', 'main.js'])).toBe(converted);
        expect(webview.asWebviewUri).toHaveBeenCalledWith(vscode.Uri.parse('file:///extension/build/main.js'));
    });

    it('reports configuration checks and update repository metadata', async () => {
        const config = new ConfigManager(Logger.getInstance(), createContext());
        const listener = vi.fn();
        const subscription = config.onConfigurationError(listener);
        expect(await config.checkConfigAndSetDefaults()).toEqual([]);
        expect(config.getTagPrefix()).toBe('VS-Code-v');
        expect(ConfigManager.getRepositoryInfo()).toEqual({ owner: 'Mojang', name: 'FASTBuildMonitor' });
        expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Errors: false, Warnings: false, Total issues: 0'));
        expect(listener).not.toHaveBeenCalled();
        subscription.dispose();
        config.dispose();
    });

    it('reads update-check versions from the extension context without rewriting them', () => {
        const config = new ConfigManager(Logger.getInstance(), createContext('1.2.3-preview.4'));
        expect(config['getCurrentVersion']()).toBe('1.2.3-preview.4');
        config.dispose();
    });
});
