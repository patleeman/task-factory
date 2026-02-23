// =============================================================================
// ApiClient Tests
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../src/api/api-client';
import type { ActivityEntry, Attachment, ShelfDraft, Idea } from '../src/types';

describe('ApiClient', () => {
  const baseUrl = 'http://localhost:3000';
  let client: ApiClient;

  beforeEach(() => {
    client = new ApiClient(baseUrl);
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Helper to mock fetch
  // ==========================================================================
  function mockFetch(response: Response) {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response);
  }

  function mockJsonResponse(data: unknown, status = 200) {
    mockFetch(new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
    }));
  }

  function mockErrorResponse(message: string, status: number) {
    mockFetch(new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' }
    }));
  }

  // ==========================================================================
  // Phase 1: Core Task Management
  // ==========================================================================
  describe('Phase 1: Core Task Management', () => {
    describe('updateTask', () => {
      it('should update task title (happy path)', async () => {
        const workspaceId = 'ws-123';
        const taskId = 'task-456';
        const update = { title: 'New Title' };
        const expectedTask = {
          id: taskId,
          frontmatter: { title: 'New Title', phase: 'backlog' }
        };

        mockJsonResponse(expectedTask);

        const result = await client.updateTask(workspaceId, taskId, update);

        expect(result).toEqual(expectedTask);
        expect(global.fetch).toHaveBeenCalledWith(
          `${baseUrl}/api/workspaces/${workspaceId}/tasks/${taskId}`,
          expect.objectContaining({
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(update)
          })
        );
      });

      it('should update multiple fields at once', async () => {
        const workspaceId = 'ws-123';
        const taskId = 'task-456';
        const update = {
          title: 'New Title',
          content: 'New content',
          acceptanceCriteria: ['criteria1', 'criteria2']
        };

        mockJsonResponse({ id: taskId, frontmatter: update });

        const result = await client.updateTask(workspaceId, taskId, update);

        expect(result.frontmatter.title).toBe('New Title');
        expect(result.frontmatter.content).toBe('New content');
      });

      it('should reject invalid task ID (error path)', async () => {
        mockErrorResponse('Task not found', 404);

        await expect(
          client.updateTask('ws-123', 'invalid-id', { title: 'Test' })
        ).rejects.toThrow('Task not found');
      });

      it('should reject invalid workspace ID (error path)', async () => {
        mockErrorResponse('Workspace not found', 404);

        await expect(
          client.updateTask('invalid-ws', 'task-123', { title: 'Test' })
        ).rejects.toThrow('Workspace not found');
      });

      it('should handle server errors gracefully', async () => {
        mockErrorResponse('Internal Server Error', 500);

        await expect(
          client.updateTask('ws-123', 'task-456', { title: 'Test' })
        ).rejects.toThrow('Internal Server Error');
      });
    });

    describe('reorderTasks', () => {
      it('should reorder tasks in a phase (happy path)', async () => {
        const workspaceId = 'ws-123';
        const phase = 'backlog';
        const taskIds = ['task-3', 'task-1', 'task-2'];

        mockJsonResponse({ success: true, count: 3 });

        const result = await client.reorderTasks(workspaceId, phase, taskIds);

        expect(result.success).toBe(true);
        expect(result.count).toBe(3);
        expect(global.fetch).toHaveBeenCalledWith(
          `${baseUrl}/api/workspaces/${workspaceId}/tasks/reorder`,
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ phase, taskIds })
          })
        );
      });

      it('should reject invalid phase (error path)', async () => {
        mockErrorResponse('Invalid phase', 400);

        await expect(
          client.reorderTasks('ws-123', 'invalid-phase', ['task-1'])
        ).rejects.toThrow('Invalid phase');
      });

      it('should reject non-existent task IDs (error path)', async () => {
        mockErrorResponse('Task not found: task-999', 404);

        await expect(
          client.reorderTasks('ws-123', 'backlog', ['task-999'])
        ).rejects.toThrow('Task not found');
      });
    });

    describe('regeneratePlan', () => {
      it('should regenerate plan for task (happy path)', async () => {
        const workspaceId = 'ws-123';
        const taskId = 'task-456';

        mockJsonResponse({ success: true });

        const result = await client.regeneratePlan(workspaceId, taskId);

        expect(result.success).toBe(true);
        expect(global.fetch).toHaveBeenCalledWith(
          `${baseUrl}/api/workspaces/${workspaceId}/tasks/${taskId}/plan/regenerate`,
          expect.objectContaining({ method: 'POST' })
        );
      });

      it('should reject if task already has a plan (error path)', async () => {
        mockErrorResponse('Task already has a plan', 409);

        await expect(
          client.regeneratePlan('ws-123', 'task-456')
        ).rejects.toThrow('Task already has a plan');
      });

      it('should reject if planning is already running (error path)', async () => {
        mockErrorResponse('Plan generation is already running', 409);

        await expect(
          client.regeneratePlan('ws-123', 'task-456')
        ).rejects.toThrow('Plan generation is already running');
      });
    });

    describe('regenerateAcceptanceCriteria', () => {
      it('should regenerate acceptance criteria (happy path)', async () => {
        const workspaceId = 'ws-123';
        const taskId = 'task-456';
        const criteria = ['New criteria 1', 'New criteria 2'];

        mockJsonResponse({ acceptanceCriteria: criteria });

        const result = await client.regenerateAcceptanceCriteria(workspaceId, taskId);

        expect(result.acceptanceCriteria).toEqual(criteria);
      });

      it('should handle regeneration failure', async () => {
        mockErrorResponse('Acceptance criteria regeneration failed', 500);

        await expect(
          client.regenerateAcceptanceCriteria('ws-123', 'task-456')
        ).rejects.toThrow('Acceptance criteria regeneration failed');
      });
    });

    describe('updateAcceptanceCriteria', () => {
      it('should update criterion status (happy path)', async () => {
        const workspaceId = 'ws-123';
        const taskId = 'task-456';
        const index = 0;
        const status = 'pass';

        mockJsonResponse({ success: true });

        const result = await client.updateAcceptanceCriteria(workspaceId, taskId, index, status);

        expect(result.success).toBe(true);
        expect(global.fetch).toHaveBeenCalledWith(
          `${baseUrl}/api/workspaces/${workspaceId}/tasks/${taskId}/summary/criteria/${index}`,
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ status })
          })
        );
      });

      it('should reject invalid status', async () => {
        mockErrorResponse('Status must be pass, fail, or pending', 400);

        await expect(
          client.updateAcceptanceCriteria('ws-123', 'task-456', 0, 'invalid')
        ).rejects.toThrow('Status must be');
      });
    });
  });

  // ==========================================================================
  // Phase 2: Activity & Messaging
  // ==========================================================================
  describe('Phase 2: Activity & Messaging', () => {
    describe('getWorkspaceActivity', () => {
      it('should get workspace activity (happy path)', async () => {
        const workspaceId = 'ws-123';
        const entries: ActivityEntry[] = [
          {
            id: 'entry-1',
            timestamp: '2024-01-15T10:00:00Z',
            type: 'system-event',
            content: 'Task created'
          }
        ];

        mockJsonResponse(entries);

        const result = await client.getWorkspaceActivity(workspaceId);

        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('system-event');
      });

      it('should respect limit parameter', async () => {
        const workspaceId = 'ws-123';
        const entries: ActivityEntry[] = Array(50).fill(null).map((_, i) => ({
          id: `entry-${i}`,
          timestamp: '2024-01-15T10:00:00Z',
          type: 'chat-message',
          role: 'user',
          content: `Message ${i}`
        }));

        mockJsonResponse(entries.slice(0, 10));

        const result = await client.getWorkspaceActivity(workspaceId, 10);

        expect(global.fetch).toHaveBeenCalledWith(
          `${baseUrl}/api/workspaces/${workspaceId}/activity?limit=10`,
          expect.any(Object)
        );
      });

      it('should handle empty activity log', async () => {
        mockJsonResponse([]);

        const result = await client.getWorkspaceActivity('ws-123');

        expect(result).toEqual([]);
      });
    });

    describe('getTaskActivity', () => {
      it('should get task activity (happy path)', async () => {
        const workspaceId = 'ws-123';
        const taskId = 'task-456';
        const entries: ActivityEntry[] = [
          {
            id: 'entry-1',
            timestamp: '2024-01-15T10:00:00Z',
            type: 'chat-message',
            role: 'user',
            content: 'Hello'
          },
          {
            id: 'entry-2',
            timestamp: '2024-01-15T10:01:00Z',
            type: 'chat-message',
            role: 'agent',
            content: 'Hi there!'
          }
        ];

        mockJsonResponse(entries);

        const result = await client.getTaskActivity(workspaceId, taskId);

        expect(result).toHaveLength(2);
        expect(result[0].role).toBe('user');
        expect(result[1].role).toBe('agent');
      });
    });

    describe('getTaskConversation', () => {
      it('should get task conversation filtered to chat messages', async () => {
        const workspaceId = 'ws-123';
        const taskId = 'task-456';
        const entries: ActivityEntry[] = [
          {
            id: 'entry-1',
            timestamp: '2024-01-15T10:00:00Z',
            type: 'chat-message',
            role: 'user',
            content: 'Hello'
          },
          {
            id: 'entry-2',
            timestamp: '2024-01-15T10:00:00Z',
            type: 'system-event',
            content: 'Task moved'
          }
        ];

        mockJsonResponse(entries);

        const result = await client.getTaskConversation(workspaceId, taskId);

        expect(global.fetch).toHaveBeenCalledWith(
          `${baseUrl}/api/workspaces/${workspaceId}/tasks/${taskId}/activity?limit=100`,
          expect.any(Object)
        );
      });
    });

    describe('sendMessage', () => {
      it('should send message to task (happy path)', async () => {
        const workspaceId = 'ws-123';
        const taskId = 'task-456';
        const content = 'Hello agent!';
        const role = 'user';

        mockJsonResponse({
          id: 'entry-1',
          timestamp: '2024-01-15T10:00:00Z',
          type: 'chat-message',
          role,
          content
        });

        const result = await client.sendMessage(workspaceId, taskId, content, role);

        expect(result.content).toBe(content);
        expect(result.role).toBe(role);
        expect(global.fetch).toHaveBeenCalledWith(
          `${baseUrl}/api/workspaces/${workspaceId}/activity`,
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ taskId, content, role })
          })
        );
      });

      it('should send with attachments', async () => {
        const workspaceId = 'ws-123';
        const taskId = 'task-456';
        const content = 'See attached';
        const attachmentIds = ['attach-1', 'attach-2'];

        mockJsonResponse({
          id: 'entry-1',
          type: 'chat-message',
          role: 'user',
          content,
          attachmentIds
        });

        const result = await client.sendMessage(workspaceId, taskId, content, 'user', attachmentIds);

        expect(result.attachmentIds).toEqual(attachmentIds);
      });
    });

    describe('steerTask', () => {
      it('should send steering message (happy path)', async () => {
        const workspaceId = 'ws-123';
        const taskId = 'task-456';
        const instruction = 'Focus on the database layer';

        mockJsonResponse({ success: true });

        const result = await client.steerTask(workspaceId, taskId, instruction);

        expect(result.success).toBe(true);
        expect(global.fetch).toHaveBeenCalledWith(
          `${baseUrl}/api/workspaces/${workspaceId}/tasks/${taskId}/steer`,
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ instruction })
          })
        );
      });
    });

    describe('followUpTask', () => {
      it('should queue follow-up message (happy path)', async () => {
        const workspaceId = 'ws-123';
        const taskId = 'task-456';
        const message = 'Also check the tests';

        mockJsonResponse({ success: true });

        const result = await client.followUpTask(workspaceId, taskId, message);

        expect(result.success).toBe(true);
        expect(global.fetch).toHaveBeenCalledWith(
          `${baseUrl}/api/workspaces/${workspaceId}/tasks/${taskId}/follow-up`,
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ message })
          })
        );
      });
    });
  });

  // ==========================================================================
  // Phase 3: Attachment Management
  // ==========================================================================
  describe('Phase 3: Attachment Management', () => {
    describe('listAttachments', () => {
      it('should list task attachments (happy path)', async () => {
        const workspaceId = 'ws-123';
        const taskId = 'task-456';
        const attachments: Attachment[] = [
          {
            id: 'attach-1',
            name: 'screenshot.png',
            size: 1024,
            mimeType: 'image/png',
            createdAt: '2024-01-15T10:00:00Z'
          }
        ];

        mockJsonResponse(attachments);

        const result = await client.listAttachments(workspaceId, taskId);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('screenshot.png');
      });

      it('should return empty array for task with no attachments', async () => {
        mockJsonResponse([]);

        const result = await client.listAttachments('ws-123', 'task-456');

        expect(result).toEqual([]);
      });
    });

    describe('uploadAttachment', () => {
      it('should upload single attachment (happy path)', async () => {
        const workspaceId = 'ws-123';
        const taskId = 'task-456';

        mockJsonResponse({
          id: 'attach-1',
          name: 'file.txt',
          size: 100,
          mimeType: 'text/plain',
          createdAt: '2024-01-15T10:00:00Z'
        });

        // Mock File and FormData since we're in Node
        const mockFile = new Blob(['content'], { type: 'text/plain' }) as File;
        Object.defineProperty(mockFile, 'name', { value: 'file.txt' });

        const result = await client.uploadAttachment(workspaceId, taskId, mockFile);

        expect(result.name).toBe('file.txt');
        expect(global.fetch).toHaveBeenCalledWith(
          `${baseUrl}/api/workspaces/${workspaceId}/tasks/${taskId}/attachments`,
          expect.objectContaining({
            method: 'POST',
            headers: expect.not.objectContaining({ 'Content-Type': 'application/json' })
          })
        );
      });

      it('should reject oversized files', async () => {
        mockErrorResponse('File too large', 413);

        const mockFile = new Blob(['x'.repeat(11 * 1024 * 1024)], { type: 'text/plain' }) as File;
        Object.defineProperty(mockFile, 'name', { value: 'large.txt' });

        await expect(
          client.uploadAttachment('ws-123', 'task-456', mockFile)
        ).rejects.toThrow('File too large');
      });
    });

    describe('downloadAttachment', () => {
      it('should download attachment (happy path)', async () => {
        const workspaceId = 'ws-123';
        const taskId = 'task-456';
        const attachmentId = 'attach-1';
        const blob = new Blob(['file content']);

        mockFetch(new Response(blob, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' }
        }));

        const result = await client.downloadAttachment(workspaceId, taskId, attachmentId);

        expect(result).toBeInstanceOf(Blob);
        expect(global.fetch).toHaveBeenCalledWith(
          `${baseUrl}/api/workspaces/${workspaceId}/tasks/${taskId}/attachments/${attachmentId}`,
          expect.any(Object)
        );
      });
    });

    describe('deleteAttachment', () => {
      it('should delete attachment (happy path)', async () => {
        const workspaceId = 'ws-123';
        const taskId = 'task-456';
        const attachmentId = 'attach-1';

        mockJsonResponse({ success: true });

        const result = await client.deleteAttachment(workspaceId, taskId, attachmentId);

        expect(result.success).toBe(true);
        expect(global.fetch).toHaveBeenCalledWith(
          `${baseUrl}/api/workspaces/${workspaceId}/tasks/${taskId}/attachments/${attachmentId}`,
          expect.objectContaining({ method: 'DELETE' })
        );
      });
    });
  });

  // ==========================================================================
  // Phase 4: Planning Session Management
  // ==========================================================================
  describe('Phase 4: Planning Session Management', () => {
    describe('getPlanningStatus', () => {
      it('should get planning status (happy path)', async () => {
        const workspaceId = 'ws-123';

        mockJsonResponse({
          status: 'running',
          messages: [
            { id: '1', role: 'user', content: 'Plan this', timestamp: '2024-01-15T10:00:00Z' }
          ]
        });

        const result = await client.getPlanningStatus(workspaceId);

        expect(result.status).toBe('running');
        expect(result.messages).toHaveLength(1);
      });
    });

    describe('getPlanningMessages', () => {
      it('should get planning messages (happy path)', async () => {
        const workspaceId = 'ws-123';
        const messages = [
          { id: '1', role: 'user', content: 'Plan this', timestamp: '2024-01-15T10:00:00Z' },
          { id: '2', role: 'agent', content: 'Planning...', timestamp: '2024-01-15T10:01:00Z' }
        ];

        mockJsonResponse(messages);

        const result = await client.getPlanningMessages(workspaceId);

        expect(result).toHaveLength(2);
      });
    });

    describe('sendPlanningMessage', () => {
      it('should send planning message (happy path)', async () => {
        const workspaceId = 'ws-123';
        const content = 'Add more details';

        mockJsonResponse({ success: true });

        const result = await client.sendPlanningMessage(workspaceId, content);

        expect(result.success).toBe(true);
        expect(global.fetch).toHaveBeenCalledWith(
          `${baseUrl}/api/workspaces/${workspaceId}/planning/message`,
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ content })
          })
        );
      });
    });

    describe('stopPlanning', () => {
      it('should stop active planning (happy path)', async () => {
        const workspaceId = 'ws-123';

        mockJsonResponse({ success: true });

        const result = await client.stopPlanning(workspaceId);

        expect(result.success).toBe(true);
        expect(global.fetch).toHaveBeenCalledWith(
          `${baseUrl}/api/workspaces/${workspaceId}/planning/stop`,
          expect.objectContaining({ method: 'POST' })
        );
      });
    });

    describe('resetPlanning', () => {
      it('should reset planning session (happy path)', async () => {
        const workspaceId = 'ws-123';

        mockJsonResponse({ success: true });

        const result = await client.resetPlanning(workspaceId);

        expect(result.success).toBe(true);
      });
    });

    describe('getPendingQA', () => {
      it('should get pending Q&A (happy path)', async () => {
        const workspaceId = 'ws-123';

        mockJsonResponse({
          pending: true,
          questions: [
            { id: 'q1', question: 'What is the priority?', type: 'text' }
          ]
        });

        const result = await client.getPendingQA(workspaceId);

        expect(result.pending).toBe(true);
        expect(result.questions).toHaveLength(1);
      });

      it('should return pending: false when no Q&A', async () => {
        mockJsonResponse({ pending: false });

        const result = await client.getPendingQA('ws-123');

        expect(result.pending).toBe(false);
      });
    });

    describe('respondToQA', () => {
      it('should submit Q&A answers (happy path)', async () => {
        const workspaceId = 'ws-123';
        const answers = ['High priority', 'Yes'];

        mockJsonResponse({ success: true });

        const result = await client.respondToQA(workspaceId, answers);

        expect(result.success).toBe(true);
        expect(global.fetch).toHaveBeenCalledWith(
          `${baseUrl}/api/workspaces/${workspaceId}/qa/respond`,
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ answers })
          })
        );
      });
    });

    describe('abortQA', () => {
      it('should abort Q&A (happy path)', async () => {
        const workspaceId = 'ws-123';

        mockJsonResponse({ success: true });

        const result = await client.abortQA(workspaceId);

        expect(result.success).toBe(true);
      });
    });
  });

  // ==========================================================================
  // Phase 5: Shelf & Idea Backlog
  // ==========================================================================
  describe('Phase 5: Shelf & Idea Backlog', () => {
    describe('getShelf', () => {
      it('should get shelf contents (happy path)', async () => {
        const workspaceId = 'ws-123';
        const drafts: ShelfDraft[] = [
          { id: 'draft-1', content: 'Draft task', createdAt: '2024-01-15T10:00:00Z' }
        ];

        mockJsonResponse(drafts);

        const result = await client.getShelf(workspaceId);

        expect(result).toHaveLength(1);
        expect(result[0].content).toBe('Draft task');
      });
    });

    describe('pushDraftToTask', () => {
      it('should promote draft to task (happy path)', async () => {
        const workspaceId = 'ws-123';
        const draftId = 'draft-1';

        mockJsonResponse({ id: 'task-456', frontmatter: { title: 'Draft task' } });

        const result = await client.pushDraftToTask(workspaceId, draftId);

        expect(result.id).toBe('task-456');
      });
    });

    describe('updateDraft', () => {
      it('should update draft content (happy path)', async () => {
        const workspaceId = 'ws-123';
        const draftId = 'draft-1';
        const content = 'Updated content';

        mockJsonResponse({ id: draftId, content });

        const result = await client.updateDraft(workspaceId, draftId, content);

        expect(result.content).toBe(content);
      });
    });

    describe('removeShelfItem', () => {
      it('should remove shelf item (happy path)', async () => {
        const workspaceId = 'ws-123';
        const itemId = 'item-1';

        mockJsonResponse({ success: true });

        const result = await client.removeShelfItem(workspaceId, itemId);

        expect(result.success).toBe(true);
      });
    });

    describe('clearShelf', () => {
      it('should clear all shelf items (happy path)', async () => {
        const workspaceId = 'ws-123';

        mockJsonResponse({ success: true, count: 5 });

        const result = await client.clearShelf(workspaceId);

        expect(result.success).toBe(true);
        expect(result.count).toBe(5);
      });
    });

    describe('listIdeas', () => {
      it('should list ideas (happy path)', async () => {
        const workspaceId = 'ws-123';
        const ideas: Idea[] = [
          { id: 'idea-1', description: 'New feature', order: 1 },
          { id: 'idea-2', description: 'Bug fix', order: 2 }
        ];

        mockJsonResponse(ideas);

        const result = await client.listIdeas(workspaceId);

        expect(result).toHaveLength(2);
      });
    });

    describe('addIdea', () => {
      it('should add new idea (happy path)', async () => {
        const workspaceId = 'ws-123';
        const description = 'New idea';

        mockJsonResponse({ id: 'idea-3', description, order: 3 });

        const result = await client.addIdea(workspaceId, description);

        expect(result.description).toBe(description);
      });
    });

    describe('updateIdea', () => {
      it('should update idea (happy path)', async () => {
        const workspaceId = 'ws-123';
        const ideaId = 'idea-1';
        const description = 'Updated idea';

        mockJsonResponse({ id: ideaId, description, order: 1 });

        const result = await client.updateIdea(workspaceId, ideaId, description);

        expect(result.description).toBe(description);
      });
    });

    describe('deleteIdea', () => {
      it('should delete idea (happy path)', async () => {
        const workspaceId = 'ws-123';
        const ideaId = 'idea-1';

        mockJsonResponse({ success: true });

        const result = await client.deleteIdea(workspaceId, ideaId);

        expect(result.success).toBe(true);
      });
    });

    describe('reorderIdeas', () => {
      it('should reorder ideas (happy path)', async () => {
        const workspaceId = 'ws-123';
        const order = ['idea-2', 'idea-1'];

        mockJsonResponse({ success: true });

        const result = await client.reorderIdeas(workspaceId, order);

        expect(result.success).toBe(true);
        expect(global.fetch).toHaveBeenCalledWith(
          `${baseUrl}/api/workspaces/${workspaceId}/idea-backlog/reorder`,
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ order })
          })
        );
      });
    });
  });

  // ==========================================================================
  // Phase 6: Workspace Configuration
  // ==========================================================================
  describe('Phase 6: Workspace Configuration', () => {
    describe('getWorkspaceConfig', () => {
      it('should get workspace config (happy path)', async () => {
        const workspaceId = 'ws-123';

        mockJsonResponse({ id: workspaceId, name: 'My Workspace', path: '/path' });

        const result = await client.getWorkspaceConfig(workspaceId);

        expect(result.id).toBe(workspaceId);
      });
    });

    describe('setWorkspaceConfig', () => {
      it('should set workspace config values (happy path)', async () => {
        const workspaceId = 'ws-123';
        const config = { name: 'New Name' };

        mockJsonResponse({ success: true });

        const result = await client.setWorkspaceConfig(workspaceId, config);

        expect(result.success).toBe(true);
      });
    });

    describe('openWorkspaceInExplorer', () => {
      it('should open workspace in file explorer (happy path)', async () => {
        const workspaceId = 'ws-123';

        mockJsonResponse({ success: true, path: '/workspace/path' });

        const result = await client.openWorkspaceInExplorer(workspaceId);

        expect(result.success).toBe(true);
      });
    });

    describe('getWorkspaceAttention', () => {
      it('should get attention summary (happy path)', async () => {
        mockJsonResponse([
          { workspaceId: 'ws-123', needsAttention: true, executingCount: 2 }
        ]);

        const result = await client.getWorkspaceAttention();

        expect(result).toHaveLength(1);
        expect(result[0].needsAttention).toBe(true);
      });
    });

    describe('getSharedContext', () => {
      it('should get shared context (happy path)', async () => {
        const workspaceId = 'ws-123';

        mockJsonResponse({ content: 'Shared context content' });

        const result = await client.getSharedContext(workspaceId);

        expect(result.content).toBe('Shared context content');
      });
    });

    describe('setSharedContext', () => {
      it('should set shared context (happy path)', async () => {
        const workspaceId = 'ws-123';
        const content = 'New shared context';

        mockJsonResponse({ success: true });

        const result = await client.setSharedContext(workspaceId, content);

        expect(result.success).toBe(true);
      });
    });
  });

  // ==========================================================================
  // Phase 7: Pi/Agent Configuration
  // ==========================================================================
  describe('Phase 7: Pi/Agent Configuration', () => {
    describe('getGlobalSettings', () => {
      it('should get global settings (happy path)', async () => {
        mockJsonResponse({ theme: 'dark', voiceHotkey: 'Cmd+Shift+L' });

        const result = await client.getGlobalSettings();

        expect(result.theme).toBe('dark');
      });
    });

    describe('setGlobalSettings', () => {
      it('should set global settings (happy path)', async () => {
        const settings = { theme: 'light' };

        mockJsonResponse({ success: true });

        const result = await client.setGlobalSettings(settings);

        expect(result.success).toBe(true);
      });
    });

    describe('getPiSettings', () => {
      it('should get Pi settings (happy path)', async () => {
        mockJsonResponse({ model: 'claude-sonnet-4-20250514' });

        const result = await client.getPiSettings();

        expect(result.model).toBe('claude-sonnet-4-20250514');
      });
    });

    describe('getTaskDefaults', () => {
      it('should get global task defaults (happy path)', async () => {
        const defaults: TaskDefaults = {
          model: 'claude-sonnet',
          preExecutionSkills: ['skill-1'],
          postExecutionSkills: ['skill-2']
        };

        mockJsonResponse(defaults);

        const result = await client.getTaskDefaults();

        expect(result.model).toBe('claude-sonnet');
      });
    });

    describe('setTaskDefaults', () => {
      it('should set task defaults (happy path)', async () => {
        const defaults: TaskDefaults = { model: 'claude-opus' };

        mockJsonResponse({ ...defaults, saved: true });

        const result = await client.setTaskDefaults(defaults);

        expect(result.model).toBe('claude-opus');
      });
    });

    describe('getWorkspaceTaskDefaults', () => {
      it('should get workspace task defaults (happy path)', async () => {
        const workspaceId = 'ws-123';

        mockJsonResponse({ model: 'workspace-specific-model' });

        const result = await client.getWorkspaceTaskDefaults(workspaceId);

        expect(result.model).toBe('workspace-specific-model');
      });
    });

    describe('setWorkspaceTaskDefaults', () => {
      it('should set workspace task defaults (happy path)', async () => {
        const workspaceId = 'ws-123';
        const defaults: TaskDefaults = { model: 'workspace-model' };

        mockJsonResponse({ ...defaults, saved: true });

        const result = await client.setWorkspaceTaskDefaults(workspaceId, defaults);

        expect(result.model).toBe('workspace-model');
      });
    });

    describe('getAuthStatus', () => {
      it('should get auth overview (happy path)', async () => {
        const providers = [
          { id: 'anthropic', name: 'Anthropic', hasCredential: true, type: 'api_key' }
        ];

        mockJsonResponse({ providers });

        const result = await client.getAuthStatus();

        expect(result.providers).toHaveLength(1);
      });
    });

    describe('setProviderApiKey', () => {
      it('should set provider API key (happy path)', async () => {
        const provider = 'anthropic';
        const apiKey = 'sk-ant-api-key';

        mockJsonResponse({ id: provider, hasCredential: true });

        const result = await client.setProviderApiKey(provider, apiKey);

        expect(result.hasCredential).toBe(true);
      });
    });

    describe('clearProviderCredential', () => {
      it('should clear provider credential (happy path)', async () => {
        const provider = 'anthropic';

        mockJsonResponse({ id: provider, hasCredential: false });

        const result = await client.clearProviderCredential(provider);

        expect(result.hasCredential).toBe(false);
      });
    });
  });

  // ==========================================================================
  // Phase 8: Workflow Automation
  // ==========================================================================
  describe('Phase 8: Workflow Automation', () => {
    describe('getAutomationSettings', () => {
      it('should get automation settings (happy path)', async () => {
        const workspaceId = 'ws-123';
        const settings: AutomationSettings = {
          readyLimit: 5,
          executingLimit: 3,
          backlogToReady: true,
          readyToExecuting: true
        };

        mockJsonResponse(settings);

        const result = await client.getAutomationSettings(workspaceId);

        expect(result.readyLimit).toBe(5);
        expect(result.executingLimit).toBe(3);
      });
    });

    describe('setAutomationSettings', () => {
      it('should set automation settings (happy path)', async () => {
        const workspaceId = 'ws-123';
        const settings: Partial<AutomationSettings> = { readyLimit: 10 };

        mockJsonResponse({ ...settings, success: true });

        const result = await client.setAutomationSettings(workspaceId, settings);

        expect(result.success).toBe(true);
      });

      it('should enable all automation', async () => {
        const workspaceId = 'ws-123';

        mockJsonResponse({
          backlogToReady: true,
          readyToExecuting: true,
          success: true
        });

        const result = await client.setAutomationSettings(workspaceId, {
          backlogToReady: true,
          readyToExecuting: true
        });

        expect(result.backlogToReady).toBe(true);
        expect(result.readyToExecuting).toBe(true);
      });
    });
  });

  // ==========================================================================
  // Phase 9: Extensions & Skills
  // ==========================================================================
  describe('Phase 9: Extensions & Skills', () => {
    describe('listExtensions', () => {
      it('should list global extensions (happy path)', async () => {
        mockJsonResponse([{ name: 'my-extension', path: '/ext' }]);

        const result = await client.listExtensions();

        expect(result).toHaveLength(1);
      });

      it('should list factory extensions when requested', async () => {
        mockJsonResponse([{ name: 'factory-ext', path: '/factory/ext' }]);

        const result = await client.listExtensions(true);

        expect(global.fetch).toHaveBeenCalledWith(
          `${baseUrl}/api/factory/extensions`,
          expect.any(Object)
        );
      });
    });

    describe('listSkills', () => {
      it('should list Pi skills (happy path)', async () => {
        const skills: Skill[] = [
          { id: 'skill-1', name: 'My Skill', description: 'A skill', hooks: ['pre-execution'] }
        ];

        mockJsonResponse(skills);

        const result = await client.listSkills();

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('My Skill');
      });
    });

    describe('getSkill', () => {
      it('should get skill details (happy path)', async () => {
        const skillId = 'skill-1';

        mockJsonResponse({ id: skillId, name: 'My Skill', description: 'A skill', hooks: [] });

        const result = await client.getSkill(skillId);

        expect(result.id).toBe(skillId);
      });
    });

    describe('listFactorySkills', () => {
      it('should list post-execution skills (happy path)', async () => {
        mockJsonResponse([
          { id: 'factory-skill-1', name: 'Factory Skill', hooks: ['post-execution'] }
        ]);

        const result = await client.listFactorySkills();

        expect(result).toHaveLength(1);
      });
    });

    describe('reloadFactorySkills', () => {
      it('should reload factory skills (happy path)', async () => {
        mockJsonResponse({ count: 5, skills: ['skill-1', 'skill-2'] });

        const result = await client.reloadFactorySkills();

        expect(result.count).toBe(5);
      });
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================
  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      await expect(client.listWorkspaces()).rejects.toThrow('Cannot connect to Task Factory server');
    });

    it('should handle non-JSON responses', async () => {
      mockFetch(new Response('Not JSON', { status: 500 }));

      await expect(client.listWorkspaces()).rejects.toThrow();
    });

    it('should include status code in error', async () => {
      mockErrorResponse('Forbidden', 403);

      try {
        await client.listWorkspaces();
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.status).toBe(403);
      }
    });

    it('should handle malformed JSON error responses', async () => {
      mockFetch(new Response('invalid json', {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }));

      await expect(client.listWorkspaces()).rejects.toThrow();
    });
  });

  // ==========================================================================
  // Connection and Configuration Tests
  // ==========================================================================
  describe('Connection and Configuration', () => {
    it('should use custom baseUrl when provided', () => {
      const customClient = new ApiClient('http://custom:8080');
      expect(customClient['baseUrl']).toBe('http://custom:8080');
    });

    it('should use default baseUrl when not provided', () => {
      // When no baseUrl provided, should use getServerUrl() result
      const defaultClient = new ApiClient();
      expect(defaultClient['baseUrl']).toBeDefined();
    });

    it('should construct correct URLs with path segments', async () => {
      mockJsonResponse({});

      await client.getTask('ws-123', 'task-456');

      expect(global.fetch).toHaveBeenCalledWith(
        `${baseUrl}/api/workspaces/ws-123/tasks/task-456`,
        expect.any(Object)
      );
    });

    it('should encode URL components properly', async () => {
      mockJsonResponse({});

      // Task ID with special characters
      await client.getTask('ws-123', 'task with spaces');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('task%20with%20spaces'),
        expect.any(Object)
      );
    });
  });
});
