import * as tar from 'tar';
import { Readable } from 'stream';

export interface ExtractedFile {
    path: string;
    content: string;
}

const IGNORED_DIRS = [
    'node_modules/',
    '.git/',
    'dist/',
    'build/',
    '.next/',
    'coverage/',
    '.turbo/',
    'vendor/',
    '.cache/',
];

const IGNORED_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.mp4', '.mp3', '.wav', '.mov', '.avi',
    '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
    '.bin', '.pyc', '.exe', '.dll', '.so', '.dylib',
    '.map', '.min.js', '.min.css',
]);

const IGNORED_FILENAMES = new Set([
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lockb',
    'Cargo.lock',
    'composer.lock',
    'Gemfile.lock',
]);

export class TarballService {
    /**
     * Downloads repository tarball from GitHub and extracts code files in-memory
     */
    static async extractFiles(
        owner: string,
        repo: string,
        defaultBranch: string = 'main'
    ): Promise<ExtractedFile[]> {
        const token = process.env.GITHUB_TOKEN;
        const headers: Record<string, string> = {
            'User-Agent': 'github-knowledge-assistant',
            Accept: 'application/vnd.github+json',
        };

        if (token) {
            headers.Authorization = `token ${token}`;
        }

        const tarballUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/${defaultBranch}`;
        const response = await fetch(tarballUrl, {
            headers,
            redirect: 'follow',
        });

        if (!response.ok) {
            throw new Error(`Failed to download repo tarball: ${response.status} ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const files: ExtractedFile[] = [];

        return new Promise((resolve, reject) => {
            const readableStream = Readable.from(buffer);

            const parser = new tar.Parser({
                onReadEntry: (entry) => {
                    const entryPath = entry.path;
                    // GitHub tarballs prefix root with 'owner-repo-commitSha/'
                    const segments = entryPath.split('/');
                    if (segments.length <= 1) {
                        entry.resume();
                        return;
                    }

                    const relativePath = segments.slice(1).join('/');
                    const filename = segments[segments.length - 1];
                    const extension = '.' + (filename.split('.').pop()?.toLowerCase() || '');

                    // Check if directory, ignored path, binary, lockfile, or > 500KB
                    const isIgnoredDir = IGNORED_DIRS.some((dir) => relativePath.includes(dir));
                    const isIgnoredExt = IGNORED_EXTENSIONS.has(extension);
                    const isIgnoredFile = IGNORED_FILENAMES.has(filename);
                    const isTooLarge = entry.size > 500 * 1024; // 500 KB limit per file

                    if (
                        entry.type !== 'File' ||
                        !relativePath ||
                        isIgnoredDir ||
                        isIgnoredExt ||
                        isIgnoredFile ||
                        isTooLarge
                    ) {
                        entry.resume();
                        return;
                    }

                    const chunks: Buffer[] = [];
                    entry.on('data', (chunk: Buffer) => {
                        chunks.push(chunk);
                    });

                    entry.on('end', () => {
                        const fileBuffer = Buffer.concat(chunks);
                        // Check if file contains null bytes (binary file heuristic)
                        if (fileBuffer.includes(0)) {
                            return;
                        }
                        const content = fileBuffer.toString('utf-8');
                        if (content.trim().length > 0) {
                            files.push({
                                path: relativePath,
                                content,
                            });
                        }
                    });
                },
            });

            parser.on('error', (err) => reject(err));
            parser.on('end', () => resolve(files));

            readableStream.pipe(parser);
        });
    }
}
