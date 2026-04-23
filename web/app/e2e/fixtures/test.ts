import { test as base, expect } from '@playwright/test';
import { initKeypairs } from './keypairs';

// Extends the base test so keypairs are initialized in every worker process.
// globalSetup runs in its own process; test workers need their own initialization.
export const test = base.extend<{ _keypairsInit: void }>({
  _keypairsInit: [
    async ({}, use) => {
      await initKeypairs();
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
