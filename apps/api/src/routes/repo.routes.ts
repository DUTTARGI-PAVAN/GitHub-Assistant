import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { indexingQueue } from '../config/queue.js';
import { GitHubService } from '../services/github.service.js';

const router = Router();

const ingestSchema = z.object({
    githubUrl: z
        .string()
        .url()
        .regex(/^https:\/\/github\.com\/[^\/]+\/[^\/]+/, 'Must be a valid GitHub repository URL'),
});

router.post('/ingest', async (req: Request, res: Response) => {
    try {
        const { githubUrl } = ingestSchema.parse(req.body);

        // Normalize URL
        const cleanUrl = githubUrl.replace(/\/$/, '').replace(/\.git$/, '');

        // Check if repo already indexed
        let repo = await prisma.repo.findUnique({
            where: { githubUrl: cleanUrl },
        });

        if (repo && (repo.status === 'READY' || repo.status === 'INDEXING')) {
            return res.status(200).json({
                repoId: repo.id,
                status: repo.status,
                message: 'Repository is already registered or indexing.',
            });
        }

        // Validate repo accessibility via GitHub
        const repoDetails = await GitHubService.getRepoDetails(cleanUrl);

        // Upsert database record
        repo = await prisma.repo.upsert({
            where: { githubUrl: cleanUrl },
            create: {
                githubUrl: cleanUrl,
                owner: repoDetails.owner,
                name: repoDetails.name,
                defaultBranch: repoDetails.defaultBranch,
                status: 'PENDING',
            },
            update: {
                status: 'PENDING',
            },
        });

        // Enqueue indexing job for BullMQ worker
        await indexingQueue.add(
            'index-repo',
            {
                repoId: repo.id,
                owner: repo.owner,
                repo: repo.name,
                defaultBranch: repo.defaultBranch,
            },
            {
                jobId: repo.id, // Prevent duplicate active jobs for the same repo
                removeOnComplete: true,
            }
        );

        return res.status(202).json({
            repoId: repo.id,
            status: 'PENDING',
            message: 'Repository queued for indexing.',
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.issues[0]?.message || 'Validation error' });
        }
        return res.status(400).json({ error: error.message || 'Ingestion failed' });
    }
});

router.get('/:id/status', async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;

    const repo = await prisma.repo.findUnique({
        where: { id },
        select: { id: true, status: true, name: true, owner: true },
    });

    if (!repo) {
        return res.status(404).json({ error: 'Repository not found' });
    }

    return res.status(200).json(repo);
});

export default router;