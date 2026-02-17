import React from '../../client/node_modules/react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from '../../client/node_modules/react-dom/server';
import type { Attachment } from '@task-factory/shared';

vi.mock('../../client/src/components/AppIcon', () => ({
  AppIcon: () => null,
}));

import { AttachmentsSection } from '../../client/src/components/TaskDetailPane';

function renderAttachmentsSection(isEditing: boolean, attachments: Attachment[] = []): string {
  const task = {
    id: 'PIFA-93',
    frontmatter: {
      attachments,
    },
  } as any;

  return renderToStaticMarkup(
    <AttachmentsSection task={task} workspaceId="workspace-1" isEditing={isEditing} />,
  );
}

describe('TaskDetailPane attachments visibility by edit mode', () => {
  const documentAttachment: Attachment = {
    id: 'att-1',
    filename: 'notes.pdf',
    storedName: 'att-1.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    createdAt: '2026-02-14T00:00:00.000Z',
  };

  it('hides the entire attachments section when read-only and no attachments exist', () => {
    const markup = renderAttachmentsSection(false, []);

    expect(markup).toBe('');
  });

  it('keeps existing attachments visible in read-only mode without management controls', () => {
    const markup = renderAttachmentsSection(false, [documentAttachment]);

    expect(markup).toContain('Attachments');
    expect(markup).toContain('notes.pdf');
    expect(markup).toContain('/api/workspaces/workspace-1/tasks/PIFA-93/attachments/att-1.pdf');

    expect(markup).not.toContain('+ Add Files');
    expect(markup).not.toContain('+ Add Excalidraw');
    expect(markup).not.toContain('Delete attachment');
    expect(markup).not.toContain('Drag &amp; drop or click to add files');
  });

  it('shows full attachment management controls in edit mode', () => {
    const markup = renderAttachmentsSection(true, [documentAttachment]);

    expect(markup).toContain('+ Add Excalidraw');
    expect(markup).toContain('+ Add Files');
    expect(markup).toContain('Delete attachment');
  });

  it('shows the upload drop zone in edit mode when no attachments exist', () => {
    const markup = renderAttachmentsSection(true, []);

    expect(markup).toContain('Drag &amp; drop or click to add files');
    expect(markup).toContain('No files');
  });
});
