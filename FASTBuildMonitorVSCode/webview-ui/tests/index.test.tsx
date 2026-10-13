// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
import * as ReactDOM from 'react-dom/client';

vi.mock('react-dom/client', async importOriginal => {
    const original = await importOriginal<typeof ReactDOM>();
    return { ...original, createRoot: vi.fn(original.createRoot) };
});

it('mounts the monitor application into the webview root', async () => {
    const container = document.createElement('div');
    container.id = 'root';
    document.body.append(container);
    const { createRoot } = await vi.importActual<typeof ReactDOM>('react-dom/client');
    let root: Root | undefined;
    vi.mocked(ReactDOM.createRoot).mockImplementation((element, options) => {
        root = createRoot(element, options);
        return root;
    });
    try {
        await act(async () => { await import('../src/monitor_panel/index'); });
        expect(container.querySelector('.toolbar')).toBeInTheDocument();
        expect(container.querySelector('.timeline-container')).toBeInTheDocument();
    } finally {
        act(() => root?.unmount());
        container.remove();
    }
});
