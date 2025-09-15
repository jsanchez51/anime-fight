const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || '';

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

// Compartido
const { PROMPTS, generateImage } = require('./lib/generate');

// generateImage ahora viene de lib/generate

app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, characterId } = req.body || {};
    const basePrompt = characterId && PROMPTS[characterId] ? PROMPTS[characterId] : '';
    const finalPrompt = [basePrompt, prompt].filter(Boolean).join(', ');
    const url = await generateImage(finalPrompt);
    res.json({ image: url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Error generando imagen' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`Servidor listo en http://localhost:${PORT}`));

