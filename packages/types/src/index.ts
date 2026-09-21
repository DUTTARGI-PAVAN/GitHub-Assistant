export type RepoStatus = 'PENDING' | 'INDEXING' | 'READY' | 'FAILED';

export interface RepoMetadata {
    owner: string;
    name: string;
    defaultBranch: string;
    fileCount: number;
    size: number;
}

export interface IngestRepoRequest {
    githubUrl: string;
}

export interface IngestRepoResponse {
    repoId: string;
    status: RepoStatus;
    message: string;
}