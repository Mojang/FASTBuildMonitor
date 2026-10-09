// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { useLayoutEffect, useRef } from 'react';

interface ProgressBarProps {
    progress: number;
}

function getContrastingTextColor(context: CanvasRenderingContext2D): string {
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    const linearize = (channel: number) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const luminance = 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
    const blackContrast = (luminance + 0.05) / 0.05;
    const whiteContrast = 1.05 / (luminance + 0.05);
    return blackContrast >= whiteContrast ? '#000' : '#fff';
}

export default function ProgressBar({ progress }: ProgressBarProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const barRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const container = containerRef.current;
        const bar = barRef.current;
        if (!container || !bar) return;

        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Unable to calculate progress label contrast: canvas context unavailable.');

        const updateColors = () => {
            // Composite ancestor backgrounds so transparent theme colors are measured as displayed.
            const ancestors: Element[] = [];
            for (let element: Element | null = container; element; element = element.parentElement) {
                ancestors.unshift(element);
            }
            context.fillStyle = '#fff';
            context.fillRect(0, 0, 1, 1);
            for (const element of ancestors) {
                context.fillStyle = getComputedStyle(element).backgroundColor;
                context.fillRect(0, 0, 1, 1);
            }
            container.style.setProperty('--progress-track-text', getContrastingTextColor(context));

            context.fillStyle = getComputedStyle(bar).backgroundColor;
            context.fillRect(0, 0, 1, 1);
            container.style.setProperty('--progress-fill-text', getContrastingTextColor(context));
        };

        updateColors();
        const observer = new MutationObserver(updateColors);
        const attributes = {
            attributes: true,
            attributeFilter: ['class', 'style', 'data-vscode-theme-id', 'data-vscode-theme-kind'],
        };
        observer.observe(document.documentElement, attributes);
        observer.observe(document.body, attributes);
        // VS Code can replace theme CSS without changing the light/dark theme class.
        observer.observe(document.head, { childList: true, characterData: true, subtree: true });
        return () => observer.disconnect();
    }, []);

    const label = `${progress.toFixed(1)}%`;

    return (
        <div className="progress-container" ref={containerRef}>
            <div className="progress-bar" ref={barRef} style={{ width: `${progress}%` }} />
            <div
                className="progress-label progress-label-track"
                style={{ clipPath: `inset(0 0 0 ${progress}%)` }}
            >
                {label}
            </div>
            <div
                className="progress-label progress-label-fill"
                style={{ clipPath: `inset(0 ${100 - progress}% 0 0)` }}
                aria-hidden="true"
            >
                {label}
            </div>
        </div>
    );
}
