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

        // Save user message
        await prisma.message.create({
            data: {
                sessionId: session.id,
                role: 'USER',
                content: message,
            },
        });

        // 1. Vector retrieval
        const relevantChunks = await ChatService.searchRelevantChunks(repoId, message, 5);

        // 2. Set up SSE Headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // First send citations event
        res.write(`event: citations\ndata: ${JSON.stringify({ sessionId: session.id, sources: relevantChunks })}\n\n`);

        // 3. Stream model tokens
        const fullAnswer = await ChatService.streamChatAnswer(message, relevantChunks, (token) => {
            res.write(`event: token\ndata: ${JSON.stringify({ token })}\n\n`);
        });

        // 4. Save assistant response with sources
        await prisma.message.create({
            data: {
                sessionId: session.id,
                role: 'ASSISTANT',
                content: fullAnswer,
                sourceChunks: relevantChunks.map((c) => ({
                    file: c.filePath,
                    startLine: c.startLine,
                    endLine: c.endLine,
                })),
            },
        });

        res.write(`event: done\ndata: [DONE]\n\n`);
        res.end();
    } catch (error: any) {
        if (res.headersSent) {
            res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
            return res.end();
        }
        return res.status(400).json({ error: error.message || 'Chat error' });
    }
});

export default router;