// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { posix } from 'node:path';
import { vi } from 'vitest';
import type * as VSCode from 'vscode';

export class Disposable {
    constructor(public dispose = vi.fn()) {}
}

export class EventEmitter<T> {
    private listeners = new Set<(event: T) => void>();
    event = (listener: (event: T) => void, thisArg?: unknown, disposables?: VSCode.Disposable[]) => {
        const bound = listener.bind(thisArg);
        this.listeners.add(bound);
        const disposable = new Disposable(vi.fn(() => this.listeners.delete(bound)));
        disposables?.push(disposable);
        return disposable;
    };
    fire(event: T) {
        for (const listener of this.listeners) listener(event);
    }
    dispose() {
        this.listeners.clear();
    }
}

export class Uri implements VSCode.Uri {
    private constructor(private value: string) {}
    static parse(value: string) { return new Uri(value); }
    static file(value: string) { return new Uri(`file://${value.replaceAll('\\', '/')}`); }
    static joinPath(base: Uri, ...parts: string[]) {
        return new Uri(`${base.toString().replace(/\/$/, '')}/${posix.join(...parts)}`);
    }
    get scheme() { return new URL(this.value).protocol.slice(0, -1); }
    get authority() { return new URL(this.value).host; }
    get path() { return new URL(this.value).pathname; }
    get query() { return new URL(this.value).search.slice(1); }
    get fragment() { return new URL(this.value).hash.slice(1); }
    get fsPath() { return this.path; }
    with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }) {
        const uri = new URL(this.value);
        if (change.scheme !== undefined) uri.protocol = change.scheme;
        if (change.authority !== undefined) uri.host = change.authority;
        if (change.path !== undefined) uri.pathname = change.path;
        if (change.query !== undefined) uri.search = change.query;
        if (change.fragment !== undefined) uri.hash = change.fragment;
        return new Uri(uri.toString());
    }
    toString() { return this.value; }
    toJSON() { return { scheme: this.scheme, authority: this.authority, path: this.path, query: this.query, fragment: this.fragment }; }
}

export const configuration = new Map<string, unknown>();
export const configurationChanged = new EventEmitter<VSCode.ConfigurationChangeEvent>();
export const outputChannel = {
    name: 'FASTBuild Monitor',
    append: vi.fn(), appendLine: vi.fn(), replace: vi.fn(), clear: vi.fn(),
    show: vi.fn(), hide: vi.fn(), dispose: vi.fn(),
};
export const statusBar = {
    text: '', tooltip: '', command: '', show: vi.fn(), hide: vi.fn(), dispose: vi.fn(),
};
export const StatusBarAlignment = { Left: 1, Right: 2 };
export const FileType = { File: 1 };
export const workspace = {
    getConfiguration: vi.fn(() => ({
        get: <T>(key: string, fallback?: T): T | undefined =>
            configuration.has(key) ? configuration.get(key) as T : fallback,
    })),
    onDidChangeConfiguration: configurationChanged.event,
    fs: {
        writeFile: vi.fn<(uri: VSCode.Uri, content: Uint8Array) => Promise<void>>(),
        delete: vi.fn<(uri: VSCode.Uri) => Promise<void>>(),
        readFile: vi.fn<(uri: VSCode.Uri) => Promise<Uint8Array>>(),
        stat: vi.fn<(uri: VSCode.Uri) => Promise<VSCode.FileStat>>(),
    },
};
export const window = {
    createOutputChannel: vi.fn(() => outputChannel),
    createStatusBarItem: vi.fn(() => statusBar),
    registerWebviewViewProvider: vi.fn(() => new Disposable()),
    showErrorMessage: vi.fn<(...args: string[]) => Promise<string | undefined>>(),
    showWarningMessage: vi.fn<(...args: string[]) => Promise<string | undefined>>(),
};
export const registeredCommands = new Map<string, () => void>();
export const commands = {
    registerCommand: vi.fn((name: string, callback: () => void) => {
        registeredCommands.set(name, callback);
        return new Disposable(vi.fn(() => registeredCommands.delete(name)));
    }),
    executeCommand: vi.fn<(name: string, ...args: unknown[]) => Promise<void>>(),
};

// Tests supply only the VS Code context fields the extension consumes.
export function createContext(version = '1.2.3'): VSCode.ExtensionContext {
    const context: Partial<VSCode.ExtensionContext> = {
        extensionUri: Uri.parse('file:///extension'),
        subscriptions: [],
        extension: { packageJSON: { version } } as VSCode.Extension<unknown>,
    };
    return context as VSCode.ExtensionContext;
}

export function resetVSCode() {
    configuration.clear();
    configurationChanged.dispose();
    registeredCommands.clear();
    statusBar.text = '';
    statusBar.tooltip = '';
    statusBar.command = '';
    window.showErrorMessage.mockResolvedValue(undefined);
    window.showWarningMessage.mockResolvedValue(undefined);
    commands.executeCommand.mockResolvedValue(undefined);
    workspace.fs.writeFile.mockReset().mockResolvedValue(undefined);
    workspace.fs.delete.mockReset().mockResolvedValue(undefined);
    workspace.fs.readFile.mockReset().mockResolvedValue(new Uint8Array());
    workspace.fs.stat.mockReset();
}
