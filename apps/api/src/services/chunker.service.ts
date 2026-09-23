export interface CodeChunk {
    startLine: number;
    endLine: number;
    content: string;
}

export class ChunkerService {
    private static readonly CHUNK_SIZE_LINES = 60;
    private static readonly OVERLAP_LINES = 15;

    /**
     * Splits a file content into overlapping line-based chunks
     */
    static chunkFile(content: string): CodeChunk[] {
        if (!content || !content.trim()) {
            return [];
        }

        const lines = content.split(/\r?\n/);
        const totalLines = lines.length;

        if (totalLines <= this.CHUNK_SIZE_LINES) {
            return [
                {
                    startLine: 1,
                    endLine: totalLines,
                    content: content,
                },
            ];
        }

        const chunks: CodeChunk[] = [];
        const step = this.CHUNK_SIZE_LINES - this.OVERLAP_LINES;

        for (let i = 0; i < totalLines; i += step) {
            const chunkLines = lines.slice(i, i + this.CHUNK_SIZE_LINES);
            if (chunkLines.length === 0) break;

            const startLine = i + 1;
            const endLine = Math.min(i + this.CHUNK_SIZE_LINES, totalLines);

            chunks.push({
                startLine,
                endLine,
                content: chunkLines.join('\n'),
            });

            if (endLine === totalLines) {
                break;
            }
        }

        return chunks;
    }
}
