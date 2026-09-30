# ClienteAI 1.2

Incluye IA real opcional vía OpenAI Responses API, onboarding conversacional, matching inteligente, autenticación, CRM y marketplace.

## Variables de entorno
- `OPENAI_API_KEY` = clave de API de OpenAI (no la publiques ni la pongas en el frontend).
- `OPENAI_MODEL` = opcional; por defecto `gpt-5.6-luna`.
- `DB_PATH` = opcional; ruta de SQLite. En producción usa almacenamiento persistente o una base de datos gestionada.
- `PORT` = opcional.

## Ejecutar
```bash
npm install
OPENAI_API_KEY=tu_clave npm start
```

## Producción
Configura `OPENAI_API_KEY` como secret/environment variable en el hosting. Nunca la pongas en `index.html`.

El modelo se usa desde el backend mediante la Responses API. La documentación oficial de modelos indica que GPT-5.6 Luna está orientado a cargas de trabajo de alto volumen/costo sensible y está disponible vía Responses API. 
