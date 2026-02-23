// =============================================================================
// Attachment Commands
// =============================================================================

import chalk from 'chalk';
import * as clack from '@clack/prompts';
import { ApiClient } from '../api/api-client.js';
import { printAttachments } from '../utils/format.js';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const client = new ApiClient();

// Find workspace for a task
async function findTaskWorkspace(taskId: string): Promise<string | null> {
  const workspaces = await client.listWorkspaces();
  
  for (const ws of workspaces) {
    try {
      const tasks = await client.listTasks(ws.id, 'all');
      const task = tasks.find(t => t.id === taskId || t.id.startsWith(taskId));
      if (task) return ws.id;
    } catch {
      // Continue
    }
  }
  
  return null;
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
      const resolvedPath = resolve(path);
      spinner.start(`Uploading ${path}...`);
      
      try {
        const fileContent = readFileSync(resolvedPath);
        const fileName = path.split('/').pop() || 'attachment';
        const blob = new Blob([fileContent]);
        const file = new File([blob], fileName);
        
        const attachment = await client.uploadAttachment(workspaceId, taskId, file);
        spinner.stop(`Uploaded ${path}`);
        console.log(chalk.green(`✓ ${attachment.id}: ${attachment.name} (${attachment.size} bytes)`));
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
