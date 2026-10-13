// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from 'vitest';
import {
    BuildJobStatus, formatDuration, formatElapsed, getDisplayName, resolveColor,
    STATUS_COLORS, STATUS_TEXT_COLORS, TIMELINE_COLORS,
} from '../src/monitor_panel/types';
import { formatElapsedCompact } from '../src/monitor_panel/components/Toolbar';
import { BuildJobStatus as ExtensionStatus, getStatusColor } from '../../src/models';

describe('webview formatting and colors', () => {
    it.each([
        ['file.cpp', 'file.cpp'], ['src/file.cpp', 'file.cpp'],
        ['C:\\src\\file.cpp', 'file.cpp'], ['src\\nested/file.cpp', 'file.cpp'], ['', ''],
    ])('extracts %s filenames', (input, expected) => expect(getDisplayName(input)).toBe(expected));

    it.each([[0, '0.0s'], [1250, '1.3s'], [60000, '1:00.0'], [125600, '2:05.6']])(
        'formats %i millisecond durations', (input, expected) => expect(formatDuration(input)).toBe(expected),
    );

    it.each([[0, '00:00:00'], [59999, '00:00:59'], [61000, '00:01:01'], [3661000, '01:01:01'], [360000000, '100:00:00']])(
        'formats %i elapsed milliseconds consistently', (input, expected) => {
            expect(formatElapsed(input)).toBe(expected);
            expect(formatElapsedCompact(input)).toBe(expected);
        },
    );

    it('resolves theme variables and provides explicit fallbacks', () => {
        const style = document.createElement('div').style;
        style.setProperty('--text', '  #abcdef  ');
        expect(resolveColor(style, '--text')).toBe('#abcdef');
        expect(resolveColor(style, '--bg')).toBe('#00000000');
        expect(resolveColor(style, '--unknown')).toBe('#000');
        for (const variable of Object.values(TIMELINE_COLORS)) {
            expect(variable).toMatch(/^--/);
        }
    });

    it('keeps status names and fill colors synchronized with the extension model', () => {
        expect(Object.values(BuildJobStatus)).toEqual(Object.values(ExtensionStatus));
        for (const status of Object.values(ExtensionStatus)) {
            expect(STATUS_COLORS[status]).toBe(getStatusColor(status));
            expect(STATUS_TEXT_COLORS[status]).toMatch(/^var\(--status-/);
        }
    });

    it('keeps black chart labels at a contrast ratio of at least 4.5 for every job color', () => {
        for (const [status, color] of Object.entries(STATUS_COLORS)) {
            const [r, g, b] = [1, 3, 5].map(offset => {
                const channel = parseInt(color.slice(offset, offset + 2), 16) / 255;
                return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            });
            const ratio = (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05) / 0.05;
            expect(ratio, status).toBeGreaterThanOrEqual(4.5);
        }
    });
});
