import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Pinecone } from '@pinecone-database/pinecone';
import { prisma } from '../config/db.js';
import { indexingQueue } from '../config/queue.js';
import { GitHubService } from '../services/github.service.js';

const router = Router();

const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY || '',
});

const ingestSchema = z.object({
    githubUrl: z
        .string()
        .url()
        .regex(/^https:\/\/github\.com\/[^\/]+\/[^\/]+/, 'Must be a valid GitHub repository URL'),
});

/**
 * List all repositories in the database with file counts
 */
router.get('/', async (req: Request, res: Response) => {
    try {
        const repos = await prisma.repo.findMany({
            orderBy: { updatedAt: 'desc' },
            include: {
                _count: {
                    select: { files: true },
                },
            },
        });

        const formatted = repos.map((r) => ({
            id: r.id,
            githubUrl: r.githubUrl,
            owner: r.owner,
            name: r.name,
            defaultBranch: r.defaultBranch,
            status: r.status,
            fileCount: r._count.files,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
        }));

        return res.json(formatted);
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'Failed to fetch repositories' });
    }
});

/**
 * Ingest / trigger indexing of a repository
 */
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

        // Clean up previous files and existing BullMQ job if retrying
        await prisma.file.deleteMany({ where: { repoId: repo.id } });
        const existingJob = await indexingQueue.getJob(repo.id);
        if (existingJob) {
            await existingJob.remove();
        }

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
                jobId: repo.id,
                removeOnComplete: true,
                removeOnFail: true,
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

/**
 * Check indexing status of a repository
 */
router.get('/:id/status', async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;

    const repo = await prisma.repo.findUnique({
        where: { id },
        include: {
            _count: {
                select: { files: true },
            },
        },
    });

    if (!repo) {
        return res.status(404).json({ error: 'Repository not found' });
    }

    return res.status(200).json({
        id: repo.id,
        status: repo.status,
        name: repo.name,
        owner: repo.owner,
        defaultBranch: repo.defaultBranch,
        fileCount: repo._count.files,
        createdAt: repo.createdAt,
        updatedAt: repo.updatedAt,
    });
});

/**
 * Delete a repository, cascade deleting database records and vector embeddings
 */
router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;

    try {
        const repo = await prisma.repo.findUnique({ where: { id } });
        if (!repo) {
            return res.status(404).json({ error: 'Repository not found' });
        }

        // 1. Delete vectors from Pinecone
        try {
            const indexName = process.env.PINECONE_INDEX_NAME || 'github-assistant';
            const index = pinecone.index(indexName);
            await index.deleteMany({ filter: { repoId: { $eq: id } } });
            console.log(`🗑️ Deleted vectors for repo ${id} from Pinecone.`);
        } catch (vectorErr: any) {
            console.warn(`⚠️ Warning: Could not purge Pinecone vectors for repo ${id}:`, vectorErr.message);
        }

        // 2. Delete database record (cascades File, Chunk, ChatSession, Message)
        await prisma.repo.delete({ where: { id } });

        return res.json({ success: true, message: `Repository ${repo.name} deleted successfully.` });
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'Failed to delete repository' });
    }
});

/**
 * List all indexed files for a repository
 */
router.get('/:id/files', async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;

    try {
        const repo = await prisma.repo.findUnique({
            where: { id },
            select: { id: true, name: true, owner: true, defaultBranch: true },
        });

        if (!repo) {
            return res.status(404).json({ error: 'Repository not found' });
        }

        const files = await prisma.file.findMany({
            where: { repoId: id },
            orderBy: { path: 'asc' },
            include: {
                _count: {
                    select: { chunks: true },
                },
            },
        });

        const formatted = files.map((f) => ({
            id: f.id,
            path: f.path,
            language: f.language,
            chunkCount: f._count.chunks,
        }));

        return res.json({
            repo,
            files: formatted,
            totalFiles: formatted.length,
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'Failed to fetch repository files' });
    }
});

export default router;