// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseSourceLocation, type DiagnosticRequest } from '../../../../src/diagnostics';
import { BuildJobStatus, type BuildSession } from '../types';

interface BuildOutputProps {
    session?: BuildSession;
    selectedJob?: number;
    expanded: boolean;
    onSelect: (index: number | undefined) => void;
    onToggle: () => void;
    onOpenSource: (request: DiagnosticRequest) => void;
}

export default function BuildOutput({ session, selectedJob, expanded, onSelect, onToggle, onOpenSource }: BuildOutputProps) {
    const failures = new Set([BuildJobStatus.Failed, BuildJobStatus.Error, BuildJobStatus.Timeout]);
    const jobs = session?.jobs.map((job, index) => ({
        job, index, label: `${job.eventName} (${job.hostName}) - ${job.status}`,
    })) ?? [];
    const available = jobs.filter(({ job, index }) => job.message || failures.has(job.status) || index === selectedJob);
    const visible = jobs.filter(({ job, index }) => selectedJob === undefined ? failures.has(job.status) : index === selectedJob);

    return (
        <section className="build-output" aria-label="Build Output">
            <div className="build-output-header">
                <button type="button" className="build-output-toggle"
                    aria-expanded={expanded} aria-controls="build-output-log"
                    aria-label={expanded ? 'Collapse Build Output' : 'Expand Build Output'}
                    title={expanded ? 'Collapse Build Output' : 'Expand Build Output'} onClick={onToggle}>
                    {expanded ? '\u25BE' : '\u25B8'}
                </button>
                <h3>Build Output</h3>
                <label>
                    Filter:{' '}
                    <select aria-label="Build Output filter" value={selectedJob ?? 'failures'}
                        title={selectedJob === undefined ? 'All failures' : jobs[selectedJob]?.label}
                        onChange={event => onSelect(event.target.value === 'failures' ? undefined : Number(event.target.value))}>
                        <option value="failures">All failures</option>
                        {available.map(({ index, label }) => (
                            <option key={index} value={index} title={label}>{label}</option>
                        ))}
                    </select>
                </label>
            </div>
            <div id="build-output-log" className="build-output-log" hidden={!expanded}>
                {!visible.length && <p>No failed jobs in this build.</p>}
                {visible.map(({ job, index }) => (
                    <section key={index}>
                        <h4>{job.eventName} ({job.hostName}) - {job.status}</h4>
                        <pre>{job.message ? job.message.split(/\r?\n/).map((line, lineIndex) => {
                            const location = parseSourceLocation(line);
                            return (
                                <span key={lineIndex}>
                                    {location && session ? (
                                        <button type="button" className="diagnostic-link"
                                            title={`Open ${location.path}:${location.line}:${location.column}`}
                                            onClick={() => onOpenSource({
                                                processId: session.processId, sessionStartTime: session.startTime,
                                                jobIndex: index, lineIndex,
                                            })}>{line}</button>
                                    ) : line}{'\n'}
                                </span>
                            );
                        }) : 'No compiler output was recorded for this job.'}</pre>
                    </section>
                ))}
            </div>
        </section>
    );
}
