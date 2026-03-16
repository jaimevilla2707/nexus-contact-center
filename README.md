# Nexus Contact Center v2 — Despliegue en Railway

## Archivos del proyecto
```
nexus-contact-center/
├── server.js          ← Backend principal
├── agents.json        ← Lista de agentes (editable)
├── package.json
├── .gitignore
└── public/
    └── index.html     ← Frontend completo
```

## Paso 1 — Subir a GitHub

1. Ve a github.com → New repository
2. Nombre: `nexus-contact-center`
3. Privado (recomendado)
4. Create repository
5. Sigue las instrucciones para subir los archivos

## Paso 2 — Desplegar en Railway

1. Ve a railway.app → New Project
2. Deploy from GitHub repo → selecciona `nexus-contact-center`
3. Railway detecta automáticamente que es Node.js

## Paso 3 — Configurar variables de entorno en Railway

En Railway → tu proyecto → Variables, agrega:

```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_KEY=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_APP_SID=APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
JWT_SECRET=pon_aqui_una_frase_larga_y_secreta_2024
RAILWAY_TOKEN=tu_token_de_railway
```

## Paso 4 — Actualizar webhooks de Twilio

Una vez Railway te dé la URL (ej: https://nexus-cc.railway.app), actualiza:

**TwiML App** (Voice → TwiML Apps → nexus):
- Voice Request URL: `https://tu-url.railway.app/voice/outgoing`

**Número Twilio** (cuando lo compres):
- Incoming Webhook: `https://tu-url.railway.app/voice/incoming`

## Credenciales de acceso inicial

| Email | Contraseña | Rol |
|-------|-----------|-----|
| admin@nexus.com | (ver variables de entorno) | Administrador |

**Cambia las contraseñas desde el panel ⚙ Agentes después del primer login.**
