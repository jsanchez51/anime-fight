const fetch = require('node-fetch');

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || '';

// Mapeo de prompts por personaje (base)
const PROMPTS = {
  naruto: 'Naruto Uzumaki, anime style, full body, game sprite, dynamic pose, clean background, high contrast, cel shading',
  satoru: 'Satoru Gojo (adult, early 20s), tall slim build, white hair, blindfold, Jujutsu High uniform consistent across frames (dark high-collar coat and pants), no outfit variations, anime style, FULL-LENGTH HEAD-TO-TOE, feet visible, not cropped, centered, consistent proportions, high contrast, cel shading, SINGLE CHARACTER ONLY',
  sukuna: 'Ryomen Sukuna (adult), muscular build, face and body markings consistent across frames, kimono-style outfit consistent across frames (light robe with dark sash), anime style, FULL-LENGTH HEAD-TO-TOE, feet visible, not cropped, centered, consistent proportions, high contrast, cel shading, SINGLE CHARACTER ONLY',
  sasuke: 'Sasuke Uchiha, anime style, full body, game sprite, dynamic pose, chidori aura, clean background, high contrast',
  nobara: 'Nobara Kugisaki, short auburn hair, teal eyes, black school uniform with red tie, brown belt, holding hammer and nails, anime style, FULL-LENGTH FULL BODY HEAD-TO-TOE, feet visible, not cropped, space above head, centered, same outfit across frames, consistent colors, high contrast, cel shading, solid pure white background, NO SHADOWS, no cast shadow, no floor shadow, no pedestal, no base, no stand, no platform, SINGLE CHARACTER ONLY, one subject, no duplicates, no collage, no extra characters, negative prompt: close-up, half-body, cropped'
};

function buildPollinationsUrl(prompt, options = {}) {
  const width = Number(options.width) || 512;
  const height = Number(options.height) || 768;
  const model = options.model || 'flux';
  const seed = typeof options.seed === 'number' ? options.seed : Math.floor(Math.random() * 1000000);
  const basePrompt = prompt || 'anime character, game sprite, clean background';
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(basePrompt)}?width=${width}&height=${height}&model=${model}&seed=${seed}&n=1`;
  return url;
}

// Genera imagen con Replicate si hay token; si no, usa Pollinations (sin clave)
async function generateImage(prompt, options = {}) {
  if (!REPLICATE_API_TOKEN) {
    return buildPollinationsUrl(prompt, options);
  }

  const body = {
    input: {
      prompt,
      guidance: options.guidance || 3.5,
      num_inference_steps: options.num_inference_steps || 28,
      width: options.width || 512,
      height: options.height || 768,
      output_format: 'png'
    },
    model: options.model || 'black-forest-labs/flux-dev' // alternativo: stability-ai/sdxl
  };

  const res = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  let pred = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(pred));

  // Poll hasta terminar
  while (pred.status === 'starting' || pred.status === 'processing' || pred.status === 'queued') {
    await new Promise(r => setTimeout(r, 1500));
    const poll = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
      headers: { 'Authorization': `Token ${REPLICATE_API_TOKEN}` }
    });
    pred = await poll.json();
  }
  if (pred.status !== 'succeeded') throw new Error(pred.error || 'Fallo al generar');

  const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  return url; // URL pública
}

module.exports = { PROMPTS, generateImage, buildPollinationsUrl };



