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

interface PendingChunk {
    fileRecordId: string;
    filePath: string;
    startLine: number;
    endLine: number;
    content: string;
}

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

            // 3. Process files and collect chunks for batch embedding
            const pendingChunks: PendingChunk[] = [];

            for (const fileData of files) {
                const fileRecord = await prisma.file.create({
                    data: {
                        repoId,
                        path: fileData.path,
                        language: fileData.path.split('.').pop() || null,
                    },
                });

                const chunks = ChunkerService.chunkFile(fileData.content);
                for (const chunk of chunks) {
                    pendingChunks.push({
                        fileRecordId: fileRecord.id,
                        filePath: fileData.path,
                        startLine: chunk.startLine,
                        endLine: chunk.endLine,
                        content: chunk.content,
                    });
                }
            }

            console.log(`🧠 [Worker] Batch generating embeddings for ${pendingChunks.length} chunks via Gemini...`);
            const embeddings = await EmbeddingService.generateEmbeddings(
                pendingChunks.map((c) => c.content)
            );

            // 4. Save chunks to Postgres and prepare Pinecone vector records
            const allVectorRecords: VectorRecord[] = [];

            for (let i = 0; i < pendingChunks.length; i++) {
                const chunk = pendingChunks[i];
                const vectorId = crypto.randomUUID();

                await prisma.chunk.create({
                    data: {
                        fileId: chunk.fileRecordId,
                        startLine: chunk.startLine,
                        endLine: chunk.endLine,
                        vectorId,
                    },
                });

                allVectorRecords.push({
                    id: vectorId,
                    values: embeddings[i],
                    metadata: {
                        repoId,
                        filePath: chunk.filePath,
                        startLine: chunk.startLine,
                        endLine: chunk.endLine,
                        text: chunk.content,
                    },
                });
            }

            // 5. Upsert vectors to Pinecone
            console.log(`📡 [Worker] Upserting ${allVectorRecords.length} vectors to Pinecone...`);
            await EmbeddingService.upsertVectors(allVectorRecords);

            // 6. Mark repository status as READY
            await prisma.repo.update({
                where: { id: repoId },
                data: { status: 'READY' },
            });

            console.log(`✨ [Worker] Successfully finished indexing repo ${owner}/${repo} (${repoId})`);
        } catch (err: any) {
            console.error(`💥 [Worker] Error during indexing repo ${owner}/${repo}:`, err);
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