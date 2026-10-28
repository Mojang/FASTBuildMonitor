// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from 'vitest';
import { parseSourceLocation } from '../../src/diagnostics';

describe('compiler source locations', () => {
    it.each([
        ['C:\\source tree\\file.cpp(42,7): error C123: failed', 'C:\\source tree\\file.cpp', 42, 7],
        ['  file.cpp(3): warning C100: warning', 'file.cpp', 3, 1],
        ['"source tree/file.cpp"(3, 2): error', 'source tree/file.cpp', 3, 2],
        ['/src/file.cpp:42:7: error: failed', '/src/file.cpp', 42, 7],
        ['C:\\src\\file.cpp:42:7: error: failed', 'C:\\src\\file.cpp', 42, 7],
        ['../src/file.cpp:42: note: declared here', '../src/file.cpp', 42, 1],
        ['\u001b[31msrc/file.cpp:9:2: error\u001b[0m', 'src/file.cpp', 9, 2],
    ])('parses %s', (text, path, line, column) => {
        expect(parseSourceLocation(text)).toEqual({ path, line, column });
    });

    it.each([
        'linker error without a location', 'file.cpp:0: error', 'file.cpp:1:0: error',
        'file.cpp(999999999999999999999): error', ':5: error', 'command:evil:5: error',
        'https://example.com/a.cpp:5: error', 'file:///src/a.cpp:5: error',
        'file\u0000.cpp(1): error', 'src/a.cpp(-1): error',
    ])('does not link invalid or non-file output: %s', text => {
        expect(parseSourceLocation(text)).toBeUndefined();
    });
});
