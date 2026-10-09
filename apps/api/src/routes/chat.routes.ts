import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { ChatService } from '../services/chat.service.js';

const router = Router();

const chatMessageSchema = z.object({
    repoId: z.string(),
    sessionId: z.string().optional(),
    message: z.string().min(1),
});

/**
 * List all chat sessions for a repository
 */
router.get('/sessions/:repoId', async (req: Request<{ repoId: string }>, res: Response) => {
    try {
        const { repoId } = req.params;

        const sessions = await prisma.chatSession.findMany({
            where: { repoId },
            orderBy: { updatedAt: 'desc' },
            include: {
                messages: {
                    orderBy: { createdAt: 'asc' },
                    take: 1, // First question as title
                    select: { content: true },
                },
                _count: {
                    select: { messages: true },
                },
            },
        });

        const formatted = sessions.map((s) => ({
            id: s.id,
            repoId: s.repoId,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            title: s.messages[0]?.content
                ? s.messages[0].content.length > 50
                    ? s.messages[0].content.slice(0, 50) + '...'
                    : s.messages[0].content
                : 'New Conversation',
            messageCount: s._count.messages,
        }));

        return res.json(formatted);
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'Failed to fetch sessions' });
    }
});

/**
 * Get all messages for a specific session
 */
router.get('/sessions/:sessionId/messages', async (req: Request<{ sessionId: string }>, res: Response) => {
    try {
        const { sessionId } = req.params;

        const session = await prisma.chatSession.findUnique({
            where: { id: sessionId },
        });

        if (!session) {
            return res.status(404).json({ error: 'Chat session not found' });
        }

        const messages = await prisma.message.findMany({
            where: { sessionId },
            orderBy: { createdAt: 'asc' },
        });

        const formatted = messages.map((m) => ({
            id: m.id,
            role: m.role.toLowerCase() as 'user' | 'assistant',
            content: m.content,
            sources: (m.sourceChunks as any[]) || [],
            createdAt: m.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }));

        return res.json(formatted);
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'Failed to fetch messages' });
    }
});

/**
 * Delete a chat session
 */
router.delete('/sessions/:sessionId', async (req: Request<{ sessionId: string }>, res: Response) => {
    try {
        const { sessionId } = req.params;
        await prisma.chatSession.delete({
            where: { id: sessionId },
        });
        return res.json({ success: true, message: 'Chat session deleted' });
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'Failed to delete chat session' });
    }
});

/**
 * Stream chat message with RAG citations and conversational memory
 */
router.post('/stream', async (req: Request, res: Response) => {
    try {
        const { repoId, sessionId, message } = chatMessageSchema.parse(req.body);

        const repo = await prisma.repo.findUnique({ where: { id: repoId } });
        if (!repo || repo.status !== 'READY') {
            return res.status(400).json({ error: 'Repository is not ready for chat' });
        }

        // Retrieve or create chat session
        const session = sessionId
            ? await prisma.chatSession.findUnique({ where: { id: sessionId } })
            : await prisma.chatSession.create({ data: { repoId } });

        if (!session) {
            return res.status(404).json({ error: 'Chat session not found' });
        }

        // Fetch recent messages for multi-turn history (last 6 turns)
        const priorMessages = await prisma.message.findMany({
            where: { sessionId: session.id },
            orderBy: { createdAt: 'desc' },
            take: 6,
            select: { role: true, content: true },
        });
        const history = priorMessages.reverse();

        // Save current user message
        await prisma.message.create({
            data: {
                sessionId: session.id,
                role: 'USER',
                content: message,
            },
        });

        // Touch session updatedAt
        await prisma.chatSession.update({
            where: { id: session.id },
            data: { updatedAt: new Date() },
        });

        // 1. Vector retrieval from Pinecone
        const relevantChunks = await ChatService.searchRelevantChunks(repoId, message, 5);

        // 2. Set up SSE Headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // First send citations event with the active session ID
        res.write(`event: citations\ndata: ${JSON.stringify({ sessionId: session.id, sources: relevantChunks })}\n\n`);

        // 3. Stream model tokens with history included
        const fullAnswer = await ChatService.streamChatAnswer(
            message,
            relevantChunks,
            (token) => {
                res.write(`event: token\ndata: ${JSON.stringify({ token })}\n\n`);
            },
            history
        );

        // 4. Save assistant response with sources
        await prisma.message.create({
            data: {
                sessionId: session.id,
                role: 'ASSISTANT',
                content: fullAnswer,
                sourceChunks: relevantChunks.map((c) => ({
                    filePath: c.filePath,
                    startLine: c.startLine,
                    endLine: c.endLine,
                    text: c.text,
                    score: c.score,
                })),
            },
        });

        res.write(`event: done\ndata: [DONE]\n\n`);
        res.end();
    } catch (error: any) {
        let cleanMsg = error.message || 'Chat error';
        try {
            const parsed = JSON.parse(cleanMsg);
            if (parsed.error?.message) {
                cleanMsg = parsed.error.message;
            }
        } catch {}

        if (cleanMsg.includes('503') || cleanMsg.includes('high demand')) {
            cleanMsg = 'AI servers are temporarily experiencing high traffic. Please retry in a few seconds.';
        }

        if (res.headersSent) {
            res.write(`event: error\ndata: ${JSON.stringify({ error: cleanMsg })}\n\n`);
            return res.end();
        }
        return res.status(500).json({ error: cleanMsg });
    }
});

export default router;