import { spawn } from 'child_process';

export interface ExplorerOpenCommand {
  command: string;
  args: string[];
}

export function getExplorerOpenCommand(
  targetPath: string,
  platform: NodeJS.Platform = process.platform,
): ExplorerOpenCommand | null {
  switch (platform) {
    case 'darwin':
      return { command: 'open', args: [targetPath] };
    case 'linux':
      return { command: 'xdg-open', args: [targetPath] };
    case 'win32':
      return { command: 'explorer.exe', args: [targetPath] };
    default:
      return null;
  }
}

export async function openInFileExplorer(
  targetPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (typeof targetPath !== 'string' || targetPath.trim().length === 0) {
    throw new Error('Target path is required');
  }

  const openCommand = getExplorerOpenCommand(targetPath, platform);
  if (!openCommand) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const settleSuccess = () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    };

    const settleError = (error: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      if (error instanceof Error) {
        reject(error);
        return;
      }

      reject(new Error(String(error)));
    };

    try {
      const child = spawn(openCommand.command, openCommand.args, {
        stdio: 'ignore',
      });

      child.once('error', settleError);
      child.once('close', (code, signal) => {
        if (code === 0) {
          settleSuccess();
          return;
        }

        const failureDetail = signal
          ? `signal ${signal}`
          : `exit code ${code ?? 'unknown'}`;

        settleError(new Error(`File explorer command failed (${failureDetail})`));
      });
    } catch (error) {
      settleError(error);
    }
  });
}
