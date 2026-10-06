import { GoogleGenAI } from '@google/genai';
import { Pinecone } from '@pinecone-database/pinecone';

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY || '',
});

export interface VectorRecord {
    id: string;
    values: number[];
    metadata: {
        repoId: string;
        filePath: string;
        startLine: number;
        endLine: number;
        text: string;
    };
}

export class EmbeddingService {
    /**
     * Generates 768-dimensional embeddings using Gemini gemini-embedding-001
     * Processes in batches for 50x faster indexing.
     */
    static async generateEmbeddings(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];

        const embeddings: number[][] = [];
        const batchSize = 50; // Gemini supports batch requests up to 100

        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize).map((t) => t.trim() || ' ');

            const response = await ai.models.embedContent({
                model: 'gemini-embedding-001',
                contents: batch,
                config: {
                    outputDimensionality: 768,
                },
            });

            const returnedEmbeddings = response.embeddings;
            if (!returnedEmbeddings || returnedEmbeddings.length === 0) {
                throw new Error('Failed to retrieve vector values from Gemini API');
            }

            for (const item of returnedEmbeddings) {
                if (!item.values) {
                    throw new Error('Missing vector values in Gemini response');
                }
                embeddings.push(item.values);
            }
        }

        return embeddings;
    }

    static async upsertVectors(records: VectorRecord[]): Promise<void> {
        if (records.length === 0) return;

        const indexName = process.env.PINECONE_INDEX_NAME || 'github-assistant';
        const index = pinecone.index(indexName);

        const batchSize = 100;
        for (let i = 0; i < records.length; i += batchSize) {
            const batch = records.slice(i, i + batchSize);
            await index.upsert({ records: batch });
        }
    }
}