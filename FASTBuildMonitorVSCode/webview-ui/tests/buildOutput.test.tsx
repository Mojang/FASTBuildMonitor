// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BuildOutput from '../src/monitor_panel/components/BuildOutput';
import { BuildJobStatus } from '../src/monitor_panel/types';
import { job, session } from './fixtures';

const callbacks = { onSelect: vi.fn(), onToggle: vi.fn(), onOpenSource: vi.fn() };
const build = session({ jobs: [
    job({ eventName: 'ok.cpp', message: 'success output' }),
    job({ eventName: 'bad.cpp', status: BuildJobStatus.Failed, message: 'src/bad.cpp(12,3): error C123\r\n<unsafe>\nmore details' }),
    job({ eventName: 'timeout.cpp', status: BuildJobStatus.Timeout }),
    job({ eventName: 'error.cpp', status: BuildJobStatus.Error, message: 'src/error.cpp:2:5: error: failed' }),
] });

describe('Build Output panel', () => {
    it('shows all failures with full diagnostics and links supported locations', () => {
        render(<BuildOutput session={build} expanded {...callbacks} />);
        expect(screen.getByText('more details', { exact: false })).toBeInTheDocument();
        expect(screen.getByText('No compiler output was recorded for this job.')).toBeInTheDocument();
        expect(screen.queryByText('success output')).not.toBeInTheDocument();
        expect(document.querySelector('unsafe')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'src/bad.cpp(12,3): error C123' }));
        expect(callbacks.onOpenSource).toHaveBeenLastCalledWith({
            processId: 42, sessionStartTime: 1000, jobIndex: 1, lineIndex: 0,
        });
        fireEvent.click(screen.getByRole('button', { name: 'src/error.cpp:2:5: error: failed' }));
        expect(callbacks.onOpenSource).toHaveBeenLastCalledWith(expect.objectContaining({ jobIndex: 3 }));
    });

    it('filters a selected job and updates its output on snapshots', () => {
        const { rerender } = render(<BuildOutput session={build} expanded selectedJob={0} {...callbacks} />);
        expect(screen.getByText('success output')).toBeInTheDocument();
        expect(screen.queryByText('more details', { exact: false })).not.toBeInTheDocument();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
        expect(callbacks.onSelect).toHaveBeenCalledWith(1);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'failures' } });
        expect(callbacks.onSelect).toHaveBeenCalledWith(undefined);
        rerender(<BuildOutput session={session({ jobs: [job({ message: 'new output' })] })} expanded selectedJob={0} {...callbacks} />);
        expect(screen.getByText('new output')).toBeInTheDocument();
    });

    it('supports empty builds, collapse and jobs with no captured output', () => {
        const { rerender } = render(<BuildOutput expanded {...callbacks} />);
        expect(screen.getByText('No failed jobs in this build.')).toBeVisible();
        expect(screen.getByRole('heading', { name: 'Build Output', level: 3 })).toBeVisible();
        const toggle = screen.getByRole('button', { name: 'Collapse Build Output' });
        expect(toggle).toHaveTextContent('\u25BE');
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(toggle).toHaveAttribute('aria-controls', 'build-output-log');
        fireEvent.click(toggle);
        expect(callbacks.onToggle).toHaveBeenCalledOnce();
        rerender(<BuildOutput session={session()} selectedJob={0} expanded={false} {...callbacks} />);
        expect(screen.getByRole('button', { name: 'Expand Build Output' })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByRole('button', { name: 'Expand Build Output' })).toHaveTextContent('\u25B8');
        expect(screen.getByRole('heading', { name: 'Build Output', level: 3 })).toBeVisible();
        expect(screen.getByText('No compiler output was recorded for this job.')).not.toBeVisible();
        expect(screen.getByRole('combobox')).toHaveValue('0');
        fireEvent.click(screen.getByRole('button', { name: 'Expand Build Output' }));
        expect(callbacks.onToggle).toHaveBeenCalledTimes(2);
    });

    it('shows the full selected filter label in a tooltip as the selection changes', () => {
        const eventName = `C:\\build\\${'long-directory\\'.repeat(20)}file.cpp`;
        const longBuild = session({ jobs: [job({ eventName, message: 'output' })] });
        const label = `${eventName} (local) - ${BuildJobStatus.Success}`;
        const { rerender } = render(<BuildOutput session={longBuild} selectedJob={0} expanded {...callbacks} />);
        expect(screen.getByRole('combobox')).toHaveAttribute('title', label);
        expect(screen.getByRole('option', { name: label })).toHaveAttribute('title', label);
        expect(screen.getByRole('option', { name: label })).toHaveTextContent(label);

        rerender(<BuildOutput session={build} selectedJob={1} expanded {...callbacks} />);
        expect(screen.getByRole('combobox')).toHaveAttribute('title', 'bad.cpp (local) - Failed');

        rerender(<BuildOutput session={build} expanded {...callbacks} />);
        expect(screen.getByRole('combobox')).toHaveAttribute('title', 'All failures');
    });
});
