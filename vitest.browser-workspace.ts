import { defineWorkspace, Plugin } from 'vitest/config';
import type { BrowserCommand } from 'vitest/node';
import KintoServer from "kinto-node-test-server";
import { dirname } from "path";

const single_thread_files = [
  'test/integration_test.ts',
  // 'test/http/integration_test.ts'
];

let kintoServer:KintoServer;

const startServer: BrowserCommand<[options: { [key: string]: string }]> = async({
  testPath
}, options) => {
  let kintoConfigPath = `${dirname(testPath!)}/kinto.ini`;
  kintoServer = new KintoServer("http://0.0.0.0:8888/v1", {
    maxAttempts: 200,
    kintoConfigPath,
  });
  await kintoServer.killAll();
  await kintoServer.loadConfig(kintoConfigPath);
  await kintoServer.start(options);
}

const stopServer: BrowserCommand<[]> = async({}) => {
  await kintoServer.stop();
  await kintoServer.killAll();
}

const flushServer: BrowserCommand<[]> = async({}) => {
  await kintoServer.flush();
}

export default defineWorkspace([
  {
    extends: './vite.config.ts',
    test: {
      name: 'firefox',
      exclude: [ ...single_thread_files, 'node_modules/**' ],
      include: ["test/**/*_{test,spec}.?(c|m)[jt]s?(x)"],
      browser: {
        enabled: true,
        name: 'firefox',
        provider: 'playwright',
        headless: true,
        screenshotFailures: false,
        commands: {
          startServer,
          stopServer,
          flushServer,
        }
      },
      poolOptions: {
        forks: {
          singleFork: true
        }
      }
    },
  }
]);
