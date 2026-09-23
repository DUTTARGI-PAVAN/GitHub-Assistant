import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import crypto from 'crypto';
import { prisma } from '../config/db.js';
import { TarballService } from '../services/tarball.service.js';
import { ChunkerService } from '../services/chunker.service.js';
import { EmbeddingService, VectorRecord } from '../services/embedding.service.js';

console.log('⚡ Indexing worker module loaded and listening to "repo-indexing" queue...');

const redisConnection = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest: null,
});

export const indexingWorker = new Worker(
    'repo-indexing',
    async (job: Job) => {
        console.log(`🚀 [Worker] Picked up job ${job.id} for repo ${job.data.repoId}`);
        const { repoId, owner, repo, defaultBranch } = job.data;

        try {
            // 1. Mark status as INDEXING
            await prisma.repo.update({
                where: { id: repoId },
                data: { status: 'INDEXING' },
            });

            // 2. Fetch and unpack tarball
            console.log(`📦 [Worker] Downloading tarball for ${owner}/${repo} (${defaultBranch})...`);
            const files = await TarballService.extractFiles(owner, repo, defaultBranch);
            console.log(`📁 [Worker] Extracted ${files.length} code files to index.`);

            const allVectorRecords: VectorRecord[] = [];

            // 3. Process files and chunks
            for (const fileData of files) {
                const fileRecord = await prisma.file.create({
                    data: {
                        repoId,
                        path: fileData.path,
                        language: fileData.path.split('.').pop() || null,
                    },
                });

                const chunks = ChunkerService.chunkFile(fileData.content);
                if (chunks.length === 0) continue;

                // Generate embeddings via Gemini (text-embedding-004)
                const embeddings = await EmbeddingService.generateEmbeddings(
                    chunks.map((c) => c.content)
                );

                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    const vectorId = crypto.randomUUID();

                    // Save chunk record to Postgres
                    await prisma.chunk.create({
                        data: {
                            fileId: fileRecord.id,
                            startLine: chunk.startLine,
                            endLine: chunk.endLine,
                            vectorId,
                        },
                    });

                    // Prepare vector for Pinecone
                    allVectorRecords.push({
                        id: vectorId,
                        values: embeddings[i],
                        metadata: {
                            repoId,
                            filePath: fileData.path,
                            startLine: chunk.startLine,
                            endLine: chunk.endLine,
                            text: chunk.content,
                        },
                    });
                }
            }

            // 4. Batch upsert vectors into Pinecone
            console.log(`📡 [Worker] Upserting ${allVectorRecords.length} vectors to Pinecone...`);
            await EmbeddingService.upsertVectors(allVectorRecords);

            // 5. Mark repository status as READY
            await prisma.repo.update({
                where: { id: repoId },
                data: { status: 'READY' },
            });

            console.log(`✨ [Worker] Successfully finished indexing repo ${repoId}`);
        } catch (err: any) {
            console.error(`💥 [Worker] Error during indexing:`, err);
            await prisma.repo.update({
                where: { id: repoId },
                data: { status: 'FAILED' },
            });
            throw err;
        }
    },
    {
        connection: redisConnection,
        concurrency: 2,
    }
);

indexingWorker.on('active', (job) => {
    console.log(`▶️ [Job ${job.id}] Started processing.`);
});

indexingWorker.on('completed', (job) => {
    console.log(`✅ [Job ${job.id}] Indexed repo successfully.`);
});

indexingWorker.on('failed', (job, err) => {
    console.error(`❌ [Job ${job?.id}] Indexing failed:`, err.message);
});

indexingWorker.on('error', (err) => {
    console.error('🔥 [Worker Error] BullMQ connection error:', err);
});