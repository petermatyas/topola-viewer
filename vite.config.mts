import {defineConfig, type PluginOption} from 'vite';
import {resolve} from 'path';
import {readFileSync} from 'fs';
import react from '@vitejs/plugin-react';
import viteTsconfigPaths from 'vite-tsconfig-paths';
import {viteSingleFile} from 'vite-plugin-singlefile';
import {execSync} from 'child_process';

let gitSha = '';
let gitTime = '';
try {
  gitSha = execSync('git rev-parse --short HEAD').toString().trim();
  gitTime = execSync('git log -1 --format=%ci').toString().trim();
} catch (e) {
  console.error('Failed to get git info', e);
}

/** Returns the contents of a file in public/ as a data URL. */
function publicFileAsDataUrl(fileName: string, mimeType: string): string {
  const content = readFileSync(resolve(__dirname, 'public', fileName));
  return `data:${mimeType};base64,${content.toString('base64')}`;
}

/**
 * Plugins for `vite build --mode singlefile`, which produces a single
 * dist-single/index.html that can be opened directly from disk (file://).
 * Files from public/ are not bundled, so the ones the app needs are embedded
 * as data URLs.
 */
function singleFilePlugins(): PluginOption[] {
  return [
    viteSingleFile(),
    {
      // Vite does not inline SVGs referenced with a #fragment, so they would
      // stay separate files. They are only legacy fallbacks for the icon fonts
      // (browsers use the inlined woff2), so the references are dropped.
      name: 'drop-svg-font-fallbacks',
      enforce: 'pre',
      transform(code: string, id: string) {
        if (id.includes('semantic-ui-css') && id.endsWith('.css')) {
          return code.replace(/,\s*url\([^)]*\.svg#[^)]*\)\s*format\([^)]*\)/g, '');
        }
      },
    },
    {
      name: 'inline-favicon',
      transformIndexHtml(html: string) {
        return html.replace(
          'href="favicon.png"',
          `href="${publicFileAsDataUrl('favicon.png', 'image/png')}"`,
        );
      },
    },
  ];
}

export default defineConfig(({mode}) => {
  const singleFile = mode === 'singlefile';
  // Google Analytics is never included in the single-file build.
  const noAnalytics =
    singleFile || process.env.VITE_GOOGLE_ANALYTICS?.trim() === 'false';
  return {
    // depending on your application, base can also be "/"
    base: '',
    define: {
      'import.meta.env.VITE_GIT_SHA': JSON.stringify(gitSha),
      'import.meta.env.VITE_GIT_TIME': JSON.stringify(gitTime),
      // fetch() of a relative file does not work from file://, but a data URL
      // does, so the timeline events are embedded in the single-file build.
      ...(singleFile && !process.env.VITE_TIMELINE_EVENTS_URL
        ? {
            'import.meta.env.VITE_TIMELINE_EVENTS_URL': JSON.stringify(
              publicFileAsDataUrl('timeline-events.json', 'application/json'),
            ),
          }
        : {}),
    },
    build: singleFile ? {outDir: 'dist-single', copyPublicDir: false} : {},
    plugins: [
      react(),
      viteTsconfigPaths(),
      {
        name: 'transform-index-plugin',
        transformIndexHtml(html: string) {
          // Remove Google Analytics code if VITE_GOOGLE_ANALYTICS is set to 'false'
          if (noAnalytics) {
            return html.replace(/<!-- GOOGLE_ANALYTICS_START -->[\s\S]*?<!-- GOOGLE_ANALYTICS_END -->/, '');
          }
        },
      },
      ...(singleFile ? singleFilePlugins() : []),
    ],
    resolve: {
      alias: [
        {
          // Remove Google Analytics code if VITE_GOOGLE_ANALYTICS is set to 'false'
          // Handles both formats of import statements used in this project
          find: /\.?\.\/util\/analytics/, replacement: noAnalytics
            ? resolve(__dirname, 'src/util/analytics_noop.ts')
            : resolve(__dirname, 'src/util/analytics.ts')
        },
      ],
    },
    server: {
      // this ensures that the browser opens upon server start
      open: true,
      // this sets a default port to 3000
      port: 3000,
    },
  };
});
