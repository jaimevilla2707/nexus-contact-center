# Nexus Contact Center v2 — Despliegue en Railway

## Archivos del proyecto
```
nexus-contact-center/
├── server.js          ← Backend principal
├── agents.json        ← Lista de agentes (editable)
├── package.json
├── .gitignore
├── .env.example       ← Variables de entorno (NO subir el .env real)
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
TWILIO_ACCOUNT_SID=AC55ccd3578af900f2697ec4b653b5a20e
TWILIO_AUTH_TOKEN=10c554fe5d75c427dab8f647515d33cd
TWILIO_API_KEY=SKe6045832478715180e266ef87eadf1f4
TWILIO_API_SECRET=F3lFLeE04XJqJQCWcHTyvMcxHGPhiqHq
TWILIO_APP_SID=AP31b457f4b41645d2c31fa7cccb41c847
JWT_SECRET=pon_aqui_una_frase_larga_y_secreta_2024
```

## Paso 4 — Actualizar webhooks de Twilio

Una vez Railway te dé la URL (ej: https://nexus-cc.railway.app), actualiza:

**TwiML App** (Voice → TwiML Apps → nexus):
- Voice Request URL: `https://nexus-cc.railway.app/voice/outgoing`

**Número Twilio** (cuando lo compres):
- Incoming Webhook: `https://nexus-cc.railway.app/voice/incoming`

## Cómo agregar/editar agentes

**Opción A — Desde el panel admin:**
- Inicia sesión con admin@nexus.com / Admin2024*
- Ve a la pestaña ⚙ Agentes
- Crea, edita o desactiva agentes

**Opción B — Editando agents.json directamente:**
- Edita el archivo y vuelve a subir a GitHub
- Railway redespliega automáticamente

## Credenciales de acceso inicial

| Email | Contraseña | Rol |
|-------|-----------|-----|
| admin@nexus.com | Admin2024* | Administrador |
| Viviana1709@nexus.com | Viviana1709 | Agente |
| ana.torres@nexus.com | Ana2024 | Supervisor |

**Cambia las contraseñas después del primer login desde el panel admin.**
