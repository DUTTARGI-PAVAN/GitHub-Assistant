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
     * Generates 768-dimensional embeddings using Gemini text-embedding-004
     */
    static async generateEmbeddings(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];

        const embeddings: number[][] = [];

        // Process individually or in small batches to respect rate limits
        for (const text of texts) {
            const response = await ai.models.embedContent({
                model: 'text-embedding-004',
                contents: text,
            });

            const values = response.embeddings?.[0]?.values;
            if (!values) {
                throw new Error('Failed to retrieve vector values from Gemini API');
            }

            embeddings.push(values);
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