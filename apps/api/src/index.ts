import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import repoRoutes from './routes/repo.routes.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/repos', repoRoutes);

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});