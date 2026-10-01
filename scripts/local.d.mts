import type { WorkerConfig } from "@cloudflare/vite-plugin";
import type { networkInterfaces } from "node:os";
import type { Plugin } from "vite";

export function lanAddresses(interfaces?: ReturnType<typeof networkInterfaces>): string[];

export function localViteOptions(environment?: NodeJS.ProcessEnv):
  | {
      server: { host: string; port: number; strictPort: boolean; allowedHosts: string[] };
      urlPlugin: Plugin;
      cloudflare: {
        configPath: string;
        config: (config: WorkerConfig) => Partial<WorkerConfig>;
        persistState: { path: string };
        inspectorPort: false;
        remoteBindings: false;
        tunnel: false;
      };
    }
  | undefined;
