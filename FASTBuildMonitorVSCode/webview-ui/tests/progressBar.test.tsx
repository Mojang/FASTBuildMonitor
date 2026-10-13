// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProgressBar from '../src/monitor_panel/components/ProgressBar';
import { createCanvasContext, getContext } from './setup';

describe('progress bar', () => {
    it.each([0, 42.5, 100])('renders %s%% with complementary clips and one accessible label', progress => {
        const { container } = render(<ProgressBar progress={progress} />);
        expect(container.querySelector('.progress-bar')).toHaveStyle({ width: `${progress}%` });
        const labels = screen.getAllByText(`${progress.toFixed(1)}%`);
        expect(labels).toHaveLength(2);
        expect(labels[0]).toHaveStyle({ clipPath: `inset(0 0 0 ${progress}%)` });
        expect(labels[1]).toHaveStyle({ clipPath: `inset(0 ${100 - progress}% 0 0)` });
        expect(labels[1]).toHaveAttribute('aria-hidden', 'true');
        expect(labels[0]).not.toHaveAttribute('aria-hidden');
    });

    it.each([
        [[0, 0, 0], '#fff'], [[255, 255, 255], '#000'],
        [[117, 117, 117], '#fff'], [[118, 118, 118], '#000'],
        [[33, 150, 243], '#000'], [[10, 10, 10], '#fff'],
    ] as const)('chooses the higher-contrast text color for RGB %s', (rgb, expected) => {
        const context = createCanvasContext();
        context.getImageData.mockReturnValue({ data: new Uint8ClampedArray([...rgb, 255]) });
        getContext.mockReturnValueOnce(context);
        const { container } = render(<ProgressBar progress={50} />);
        const track = container.querySelector<HTMLElement>('.progress-container')!;
        expect(track.style.getPropertyValue('--progress-track-text')).toBe(expected);
        expect(track.style.getPropertyValue('--progress-fill-text')).toBe(expected);
    });

    it('samples track and fill independently and recomputes after theme changes', async () => {
        const context = createCanvasContext();
        context.getImageData
            .mockReturnValueOnce({ data: new Uint8ClampedArray([255, 255, 255, 255]) })
            .mockReturnValueOnce({ data: new Uint8ClampedArray([0, 0, 0, 255]) });
        getContext.mockReturnValueOnce(context);
        const { container, unmount } = render(<ProgressBar progress={50} />);
        const track = container.querySelector<HTMLElement>('.progress-container')!;
        expect(track.style.getPropertyValue('--progress-track-text')).toBe('#000');
        expect(track.style.getPropertyValue('--progress-fill-text')).toBe('#fff');
        expect(context.fillRect.mock.calls.length).toBeGreaterThan(3);
        await act(async () => { document.body.classList.add('legacy-colors'); });
        expect(track.style.getPropertyValue('--progress-track-text')).toBe('#fff');
        const reads = context.getImageData.mock.calls.length;
        const themeStyle = document.createElement('style');
        await act(async () => { document.head.append(themeStyle); });
        expect(context.getImageData.mock.calls.length).toBeGreaterThan(reads);
        unmount();
        const afterUnmount = context.getImageData.mock.calls.length;
        await act(async () => { themeStyle.remove(); });
        expect(context.getImageData).toHaveBeenCalledTimes(afterUnmount);
    });

    it('surfaces a missing canvas context rather than using an unverified contrast color', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const onError = (event: ErrorEvent) => event.preventDefault();
        window.addEventListener('error', onError);
        getContext.mockReturnValueOnce(null);
        try {
            expect(() => render(<ProgressBar progress={50} />)).toThrow(
                'Unable to calculate progress label contrast: canvas context unavailable.',
            );
        } finally {
            window.removeEventListener('error', onError);
            consoleError.mockRestore();
        }
    });
});
