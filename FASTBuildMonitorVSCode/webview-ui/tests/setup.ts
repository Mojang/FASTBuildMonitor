// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

export const vscodeApi = {
    postMessage: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
};
vi.stubGlobal('acquireVsCodeApi', () => vscodeApi);

export class ResizeObserverMock implements ResizeObserver {
    static instances: ResizeObserverMock[] = [];
    constructor(private callback: ResizeObserverCallback) {
        ResizeObserverMock.instances.push(this);
    }
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    trigger() { this.callback([], this); }
}

export function createCanvasContext() {
    return {
        fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
        beginPath: vi.fn(), closePath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
        quadraticCurveTo: vi.fn(), rect: vi.fn(), clip: vi.fn(), fill: vi.fn(),
        stroke: vi.fn(), fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
        setTransform: vi.fn(), translate: vi.fn(), fillText: vi.fn(),
        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) })),
    };
}

let contexts = new WeakMap<HTMLCanvasElement, ReturnType<typeof createCanvasContext>>();
export function canvasContext(canvas: HTMLCanvasElement) {
    const context = contexts.get(canvas);
    if (!context) throw new Error('The component has not requested a 2D context for this canvas');
    return context;
}

const originalGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')!;
export const getContext = vi.fn(function (this: HTMLCanvasElement, kind: string): ReturnType<typeof createCanvasContext> | null {
    if (kind !== '2d') throw new Error(`Unsupported test canvas context: ${kind}`);
    let context = contexts.get(this);
    if (!context) {
        context = createCanvasContext();
        contexts.set(this, context);
    }
    return context;
});

beforeEach(() => {
    contexts = new WeakMap();
    ResizeObserverMock.instances = [];
    vi.stubGlobal('acquireVsCodeApi', () => vscodeApi);
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true, writable: true, value: getContext,
    });
    document.body.className = '';
    document.body.removeAttribute('style');
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalGetContext);
});
