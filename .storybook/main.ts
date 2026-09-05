import type { StorybookConfig } from '@storybook/html-vite';

const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.ts'],
  framework: { name: '@storybook/html-vite', options: {} },
  core: { disableTelemetry: true },
  // Stories import `../src/*.ts` directly, so a save in src/ hot-reloads the
  // story without a `npm run build` first. dist/ is only for consumers.
  viteFinal: (cfg) => ({
    ...cfg,
    server: { ...cfg.server, host: true, allowedHosts: true },
  }),
};

export default config;
