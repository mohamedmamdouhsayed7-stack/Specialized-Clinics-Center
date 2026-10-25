import { existsSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import * as path from 'path';

export type PostgresTool = 'pg_dump' | 'psql';

export interface PostgresToolResolverOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  fileExists?: (candidate: string) => boolean;
  listDirectories?: (directory: string) => string[];
  findOnPath?: (executable: string, platform: string) => string | undefined;
}

function defaultListDirectories(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function defaultFindOnPath(executable: string, platform: string): string | undefined {
  const locator = platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(locator, [executable], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) return undefined;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

/** Resolve PostgreSQL clients on Windows installations that are not on PATH. */
export function resolvePostgresToolPath(
  tool: PostgresTool,
  options: PostgresToolResolverOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const fileExists = options.fileExists ?? existsSync;
  const listDirectories = options.listDirectories ?? defaultListDirectories;
  const findOnPath = options.findOnPath ?? defaultFindOnPath;
  const executable = platform === 'win32' ? `${tool}.exe` : tool;

  if (platform === 'win32') {
    const winPath = path.win32;
    const explicitBin = env.POSTGRES_BIN?.trim();
    if (explicitBin) {
      const explicitCandidate = winPath.join(explicitBin, executable);
      if (fileExists(explicitCandidate)) return explicitCandidate;
    }

    const programRoots = [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)']]
      .filter((value): value is string => Boolean(value))
      .map((root) => winPath.join(root, 'PostgreSQL'));
    const uniqueRoots = [...new Set(programRoots)];

    for (const root of uniqueRoots) {
      const versions = listDirectories(root).sort((left, right) =>
        right.localeCompare(left, undefined, { numeric: true }),
      );
      for (const version of versions) {
        const candidate = winPath.join(root, version, 'bin', executable);
        if (fileExists(candidate)) return candidate;
      }
    }
  }

  return findOnPath(executable, platform) ?? executable;
}
