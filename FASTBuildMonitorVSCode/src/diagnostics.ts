// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface SourceLocation {
    path: string;
    line: number;
    column: number;
}

export interface DiagnosticRequest {
    processId: number;
    sessionStartTime: number;
    jobIndex: number;
    lineIndex: number;
}

export function parseSourceLocation(text: string): SourceLocation | undefined {
    // eslint-disable-next-line no-control-regex -- Compiler diagnostics may contain ANSI color escapes.
    const clean = text.replace(/\u001b\[[0-9;]*m/g, '').trim();
    const match = /^(.*?)\((\d+)(?:,\s*(\d+))?\)\s*:/.exec(clean) ??
        /^(.*?):(\d+)(?::(\d+))?:\s/.exec(clean);
    if (!match) return undefined;
    const file = match[1].trim().replace(/^"(.*)"$/, '$1');
    const line = Number(match[2]);
    const column = match[3] === undefined ? 1 : Number(match[3]);
    // Compiler output is data, never a command or a URI to launch.
    if (!file || [...file].some(character => character.charCodeAt(0) < 32) ||
        (/^[a-z][a-z\d+.-]*:/i.test(file) && !/^[a-z]:[\\/]/i.test(file)) ||
        !Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) {
        return undefined;
    }
    return { path: file, line, column };
}
