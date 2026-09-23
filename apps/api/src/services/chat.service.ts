import { GoogleGenAI } from '@google/genai';
import { Pinecone } from '@pinecone-database/pinecone';

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY || '',
});

export interface RetrievedChunk {
    filePath: string;
    startLine: number;
    endLine: number;
    text: string;
    score: number;
}

export class ChatService {
    /**
     * Searches Pinecone for the top-k chunks matching the user's question
     */
    static async searchRelevantChunks(repoId: string, query: string, topK = 5): Promise<RetrievedChunk[]> {
        // 1. Embed query with Gemini
        const embedRes = await ai.models.embedContent({
            model: 'text-embedding-004',
            contents: query,
        });

        const queryVector = embedRes.embedding?.values;
        if (!queryVector) throw new Error('Could not embed search query');

        // 2. Query Pinecone with repoId metadata filter
        const indexName = process.env.PINECONE_INDEX_NAME || 'github-assistant';
        const index = pinecone.index(indexName);

        const searchResults = await index.query({
            vector: queryVector,
            topK,
            filter: { repoId: { $eq: repoId } },
            includeMetadata: true,
        });

        return (searchResults.matches || []).map((match) => ({
            filePath: String(match.metadata?.filePath || ''),
            startLine: Number(match.metadata?.startLine || 0),
            endLine: Number(match.metadata?.endLine || 0),
            text: String(match.metadata?.text || ''),
            score: match.score || 0,
        }));
    }

    /**
     * Streams a response from Gemini using the retrieved chunks as context
     */
    static async streamChatAnswer(
        question: string,
        chunks: RetrievedChunk[],
        onToken: (token: string) => void
    ): Promise<string> {
        const contextBlock = chunks
            .map(
                (c, i) =>
                    `[Source ${i + 1}] File:${c.filePath} (Lines ${c.startLine}-${c.endLine})\n\`\`\`\n${c.text}\n\`\`\``
            )
            .join('\n\n');

        const prompt = `You are a knowledgeable assistant analyzing a GitHub repository.
Answer the user's question accurately using ONLY the provided code context.
If the answer cannot be determined from the code context, state that clearly.
Always cite your sources by mentioning the file path and line numbers when explaining code logic.

---
CODE CONTEXT:
${contextBlock}
---

USER QUESTION:
${question}`;

        const responseStream = await ai.models.generateContentStream({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        let fullAnswer = '';
        for await (const chunk of responseStream) {
            const text = chunk.text || '';
            fullAnswer += text;
            onToken(text);
        }

        return fullAnswer;
    }
}