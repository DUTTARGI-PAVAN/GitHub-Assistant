import 'dotenv/config'; // MUST be the first line before any other imports
import express from 'express';
import cors from 'cors';
import repoRoutes from './routes/repo.routes.js';
import chatRoutes from './routes/chat.routes.js';
import './workers/indexing.worker.js';

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/repos', repoRoutes);
app.use('/api/chat', chatRoutes);

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});