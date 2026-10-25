import { resolvePostgresToolPath } from './postgres-tools';

describe('PostgreSQL client path resolution', () => {
  it('uses an explicitly configured Windows PostgreSQL bin directory when present', () => {
    const fileExists = jest.fn((candidate: string) =>
      candidate === 'D:\\Postgres\\bin\\psql.exe',
    );
    const findOnPath = jest.fn();

    const resolved = resolvePostgresToolPath('psql', {
      platform: 'win32',
      env: { POSTGRES_BIN: 'D:\\Postgres\\bin' },
      fileExists,
      findOnPath,
    });

    expect(resolved).toBe('D:\\Postgres\\bin\\psql.exe');
    expect(findOnPath).not.toHaveBeenCalled();
  });

  it('finds the newest standard Windows installation when it is not on PATH', () => {
    const root = 'C:\\Program Files\\PostgreSQL';
    const fileExists = jest.fn((candidate: string) =>
      candidate === `${root}\\17\\bin\\pg_dump.exe`,
    );
    const listDirectories = jest.fn(() => ['15', '17', '16']);
    const findOnPath = jest.fn();

    const resolved = resolvePostgresToolPath('pg_dump', {
      platform: 'win32',
      env: { ProgramFiles: 'C:\\Program Files' },
      fileExists,
      listDirectories,
      findOnPath,
    });

    expect(resolved).toBe(`${root}\\17\\bin\\pg_dump.exe`);
    expect(fileExists).toHaveBeenCalledWith(`${root}\\17\\bin\\pg_dump.exe`);
    expect(findOnPath).not.toHaveBeenCalled();
  });

  it('uses the platform-appropriate PATH locator and falls back to the executable name', () => {
    const findOnPath = jest.fn((executable: string, platform: string) =>
      platform === 'win32' ? 'C:\\tools\\psql.exe' : '/usr/bin/psql',
    );

    expect(resolvePostgresToolPath('psql', { platform: 'win32', env: {}, findOnPath }))
      .toBe('C:\\tools\\psql.exe');
    expect(findOnPath).toHaveBeenLastCalledWith('psql.exe', 'win32');
    expect(resolvePostgresToolPath('psql', { platform: 'linux', env: {}, findOnPath }))
      .toBe('/usr/bin/psql');
    expect(findOnPath).toHaveBeenLastCalledWith('psql', 'linux');

    const notFound = jest.fn();
    expect(resolvePostgresToolPath('pg_dump', { platform: 'win32', env: {}, findOnPath: notFound }))
      .toBe('pg_dump.exe');
  });
});
