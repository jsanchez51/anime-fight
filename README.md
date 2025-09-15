# Anime 2v2 Fighter

## Ejecutar

1. Instala Node.js.
2. En la carpeta del proyecto, instala dependencias:

```
npm install
```

3. Crea un archivo `.env` con tu token:

```
REPLICATE_API_TOKEN=tu_token
PORT=3000
```

4. Inicia el servidor y abre `http://localhost:3000`.

```
npm start
```

## Generar sprites
En la pantalla de selección hay botones "Generar con IA" para P1/P2. Se llama a `/api/generate` (Replicate FLUX). También puedes subir tus propias imágenes.


