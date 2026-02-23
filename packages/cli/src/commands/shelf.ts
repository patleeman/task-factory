// =============================================================================
// Shelf & Idea Commands
// =============================================================================

import chalk from 'chalk';
import * as clack from '@clack/prompts';
import { ApiClient } from '../api/api-client.js';
import { printShelfDrafts, printIdeas } from '../utils/format.js';

const client = new ApiClient();

// ============================================================================
// Shelf Show
// ============================================================================
export async function shelfShow(workspaceId: string) {
  try {
    const drafts = await client.getShelf(workspaceId);
    printShelfDrafts(drafts);
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Shelf Push
// ============================================================================
export async function shelfPush(workspaceId: string, draftId: string) {
  try {
    const spinner = clack.spinner();
    spinner.start('Creating task from draft...');

    const task = await client.pushDraftToTask(workspaceId, draftId);

    spinner.stop('Task created');
    console.log(chalk.green(`✓ Created task ${task.id}`));
    console.log(`  Title: ${task.frontmatter.title || 'Untitled'}`);
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Shelf Push All
// ============================================================================
export async function shelfPushAll(workspaceId: string) {
  try {
    const drafts = await client.getShelf(workspaceId);

    if (drafts.length === 0) {
      console.log(chalk.yellow('No drafts to push.'));
      return;
    }

    const spinner = clack.spinner();
    spinner.start(`Creating tasks from ${drafts.length} drafts...`);

    for (const draft of drafts) {
      await client.pushDraftToTask(workspaceId, draft.id);
    }

    spinner.stop(`Created ${drafts.length} tasks`);
    console.log(chalk.green(`✓ Created ${drafts.length} tasks from shelf`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Shelf Update
// ============================================================================
export async function shelfUpdate(workspaceId: string, draftId: string, options: { content: string }) {
  try {
    await client.updateDraft(workspaceId, draftId, options.content);
    console.log(chalk.green(`✓ Draft ${draftId} updated`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Shelf Remove
// ============================================================================
export async function shelfRemove(workspaceId: string, itemId: string, options: { force?: boolean }) {
  try {
    if (!options.force) {
      const confirmed = await clack.confirm({
        message: `Remove item ${itemId} from shelf?`,
        initialValue: false,
      });

      if (!confirmed) {
        console.log(chalk.yellow('Cancelled.'));
        return;
      }
    }

    await client.removeShelfItem(workspaceId, itemId);
    console.log(chalk.green(`✓ Removed ${itemId} from shelf`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Shelf Clear
// ============================================================================
export async function shelfClear(workspaceId: string, options: { force?: boolean }) {
  try {
    if (!options.force) {
      const confirmed = await clack.confirm({
        message: 'Clear all items from shelf? This cannot be undone.',
        initialValue: false,
      });

      if (!confirmed) {
        console.log(chalk.yellow('Cancelled.'));
        return;
      }
    }

    const result = await client.clearShelf(workspaceId);
    console.log(chalk.green(`✓ Cleared ${result.count} items from shelf`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Idea List
// ============================================================================
export async function ideaList(workspaceId: string) {
  try {
    const ideas = await client.listIdeas(workspaceId);
    printIdeas(ideas);
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Idea Add
// ============================================================================
export async function ideaAdd(workspaceId: string, description: string) {
  try {
    const idea = await client.addIdea(workspaceId, description);
    console.log(chalk.green(`✓ Added idea ${idea.id}`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Idea Update
// ============================================================================
export async function ideaUpdate(workspaceId: string, ideaId: string, description: string) {
  try {
    await client.updateIdea(workspaceId, ideaId, description);
    console.log(chalk.green(`✓ Updated idea ${ideaId}`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Idea Delete
// ============================================================================
export async function ideaDelete(workspaceId: string, ideaId: string, options: { force?: boolean }) {
  try {
    if (!options.force) {
      const confirmed = await clack.confirm({
        message: `Delete idea ${ideaId}?`,
        initialValue: false,
      });

      if (!confirmed) {
        console.log(chalk.yellow('Cancelled.'));
        return;
      }
    }

    await client.deleteIdea(workspaceId, ideaId);
    console.log(chalk.green(`✓ Deleted idea ${ideaId}`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Idea Reorder
// ============================================================================
export async function ideaReorder(workspaceId: string, options: { order: string }) {
  try {
    const order = options.order.split(',').map(s => s.trim());
    await client.reorderIdeas(workspaceId, order);
    console.log(chalk.green(`✓ Reordered ${order.length} ideas`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}
