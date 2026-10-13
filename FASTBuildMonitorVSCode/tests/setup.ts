// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, beforeEach, vi } from 'vitest';
import { resetVSCode } from './mocks/vscode';

beforeEach(resetVSCode);
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});
