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
            model: 'gemini-embedding-001',
            contents: query,
            config: {
                outputDimensionality: 768,
            },
        });

        const queryVector = embedRes.embeddings?.[0]?.values;
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
        onToken: (token: string) => void,
        history: { role: string; content: string }[] = []
    ): Promise<string> {
        const contextBlock = chunks
            .map(
                (c, i) =>
                    `[Source ${i + 1}] File:${c.filePath} (Lines ${c.startLine}-${c.endLine})\n\`\`\`\n${c.text}\n\`\`\``
            )
            .join('\n\n');

        const historyBlock =
            history.length > 0
                ? `\n---\nRECENT CONVERSATION HISTORY:\n` +
                  history
                      .map((h) => `${h.role === 'USER' ? 'User' : 'Assistant'}: ${h.content}`)
                      .join('\n') +
                  `\n---`
                : '';

        const prompt = `You are a knowledgeable assistant analyzing a GitHub repository.
Answer the user's question accurately using ONLY the provided code context and recent conversation history.
If the answer cannot be determined from the code context, state that clearly.
Always cite your sources by mentioning the file path and line numbers when explaining code logic.

---
CODE CONTEXT:
${contextBlock}
---
${historyBlock}

USER QUESTION:
${question}`;

        const candidateModels = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
        let lastError: any = null;

        for (const modelName of candidateModels) {
            try {
                const responseStream = await ai.models.generateContentStream({
                    model: modelName,
                    contents: prompt,
                });

                let fullAnswer = '';
                for await (const chunk of responseStream) {
                    const text = chunk.text || '';
                    fullAnswer += text;
                    onToken(text);
                }

                return fullAnswer;
            } catch (err: any) {
                lastError = err;
                console.warn(`⚠️ [ChatService] Model ${modelName} returned error:`, err.message || err);
                // If it's a 503 high demand or temporary error, continue to next fallback candidate
                if (err.status === 503 || String(err.message).includes('503') || String(err.message).includes('high demand')) {
                    console.log(`🔄 [ChatService] Falling back to next available model...`);
                    continue;
                }
                throw err;
            }
        }

        throw lastError;
    }
}