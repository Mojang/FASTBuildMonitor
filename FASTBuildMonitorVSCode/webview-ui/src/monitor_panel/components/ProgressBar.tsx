// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

interface ProgressBarProps {
    progress: number;
}

export default function ProgressBar({ progress }: ProgressBarProps) {
    return (
        <div className="progress-container">
            <div className="progress-bar" style={{ width: `${progress}%` }} />
            <div className="progress-label">{progress.toFixed(1)}%</div>
        </div>
    );
}
