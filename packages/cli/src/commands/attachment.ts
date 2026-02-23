// =============================================================================
// Attachment Commands
// =============================================================================

import chalk from 'chalk';
import * as clack from '@clack/prompts';
import { ApiClient } from '../api/api-client.js';
import { printAttachments, formatBytes } from '../utils/format.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const client = new ApiClient();

// Find workspace for a task
async function findTaskWorkspace(taskId: string): Promise<string | null> {
  const workspaces = await client.listWorkspaces();
  
  for (const ws of workspaces) {
    try {
      const tasks = await client.listTasks(ws.id, 'all');
      // Require exact match or minimum 8 characters for partial match to avoid collisions
      const task = tasks.find(t => 
        t.id === taskId || 
        (taskId.length >= 8 && t.id.startsWith(taskId))
      );
      if (task) return ws.id;
    } catch (err: any) {
      console.warn(chalk.yellow(`Warning: Could not list tasks for workspace ${ws.id}: ${err.message}`));
    }
  }
  
  return null;
}

// Validate file path to prevent directory traversal
function validateFilePath(filePath: string): string {
  const resolvedPath = resolve(filePath);
  const cwd = process.cwd();
  
  // Ensure resolved path is within current working directory or is an absolute path that exists
  if (!resolvedPath.startsWith(cwd) && !existsSync(resolvedPath)) {
    throw new Error(`Invalid file path: ${filePath}. Path must be within the current directory or an existing absolute path.`);
  }
  
  // Check for path traversal attempts
  const normalizedPath = resolve(resolvedPath);
  if (!normalizedPath.startsWith(cwd) && !filePath.startsWith('/')) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }
  
  return resolvedPath;
}

// ============================================================================
// Attachment List
// ============================================================================
export async function attachmentList(taskId: string) {
  try {
    const workspaceId = await findTaskWorkspace(taskId);
    
    if (!workspaceId) {
      console.error(chalk.red(`Task not found: ${taskId}`));
      process.exit(1);
    }
    
    const attachments = await client.listAttachments(workspaceId, taskId);
    printAttachments(attachments);
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Attachment Upload
// ============================================================================
export async function attachmentUpload(taskId: string, filePath: string, options: { files?: string[] }) {
  try {
    const workspaceId = await findTaskWorkspace(taskId);
    
    if (!workspaceId) {
      console.error(chalk.red(`Task not found: ${taskId}`));
      process.exit(1);
    }
    
    const files = options.files || [filePath];
    const spinner = clack.spinner();
    
    for (const path of files) {
      spinner.start(`Uploading ${path}...`);
      
      try {
        // Validate file path to prevent directory traversal
        const resolvedPath = validateFilePath(path);
        
        // Check file size (10MB limit)
        const stats = await import('fs').then(fs => fs.promises.stat(resolvedPath));
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (stats.size > maxSize) {
          throw new Error(`File too large: ${stats.size} bytes (max ${maxSize} bytes)`);
        }
        
        const fileContent = readFileSync(resolvedPath);
        const fileName = path.split('/').pop() || 'attachment';
        const blob = new Blob([fileContent]);
        const file = new File([blob], fileName);
        
        const attachment = await client.uploadAttachment(workspaceId, taskId, file);
        spinner.stop(`Uploaded ${path}`);
        console.log(chalk.green(`✓ ${attachment.id}: ${attachment.name} (${formatBytes(attachment.size)})`));
      } catch (err: any) {
        spinner.stop(`Failed to upload ${path}`);
        console.error(chalk.red(`  Error: ${err.message}`));
      }
    }
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Attachment Download
// ============================================================================
export async function attachmentDownload(taskId: string, attachmentId: string, options: { output?: string }) {
  try {
    const workspaceId = await findTaskWorkspace(taskId);
    
    if (!workspaceId) {
      console.error(chalk.red(`Task not found: ${taskId}`));
      process.exit(1);
    }
    
    const spinner = clack.spinner();
    spinner.start('Downloading attachment...');
    
    const blob = await client.downloadAttachment(workspaceId, taskId, attachmentId);
    const buffer = Buffer.from(await blob.arrayBuffer());
    
    const outputPath = options.output || attachmentId;
    // Validate output path to prevent writing to system directories
    if (outputPath.startsWith('/') && !outputPath.startsWith(process.cwd())) {
      const confirmed = await clack.confirm({
        message: `Write to absolute path ${outputPath}?`,
        initialValue: false,
      });
      if (!confirmed) {
        spinner.stop('Cancelled');
        console.log(chalk.yellow('Download cancelled.'));
        return;
      }
    }
    writeFileSync(outputPath, buffer);
    
    spinner.stop('Download complete');
    console.log(chalk.green(`✓ Saved to ${outputPath} (${buffer.length} bytes)`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Attachment Delete
// ============================================================================
export async function attachmentDelete(taskId: string, attachmentId: string, options: { force?: boolean }) {
  try {
    const workspaceId = await findTaskWorkspace(taskId);
    
    if (!workspaceId) {
      console.error(chalk.red(`Task not found: ${taskId}`));
      process.exit(1);
    }
    
    if (!options.force) {
      const confirmed = await clack.confirm({
        message: `Delete attachment ${attachmentId}?`,
        initialValue: false,
      });
      
      if (!confirmed) {
        console.log(chalk.yellow('Cancelled.'));
        return;
      }
    }
    
    await client.deleteAttachment(workspaceId, taskId, attachmentId);
    console.log(chalk.green(`✓ Deleted attachment ${attachmentId}`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}
