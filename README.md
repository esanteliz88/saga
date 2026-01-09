# patient-form-bot (Backend cerebro)

Este backend recibe mensajes desde **n8n** y responde con la **siguiente pregunta** de tu formulario en MongoDB (colección `form_templates`), avanzando 1 a 1 y respetando `showIf`.

## Colecciones (DB = saga)
- `form_templates`: tus formularios (ya tienes `guia_salud`)
- `form_sessions`: estado + respuestas por paciente
- `form_memory`: log de conversación + adjuntos

## Levantar
```bash
cp .env.example .env
npm install
npm run dev
```

Health:
- `GET http://localhost:8080/health`

## Endpoint para n8n
`POST /bot/message`

Headers:
- `Content-Type: application/json`
- `x-api-key: <API_KEY>`

Body ejemplo:
```json
{
  "channel": "whatsapp",
  "user": { "wa_id": "56911112222", "name": "Juan" },
  "message": { "id": "m-1", "type": "text", "text": "hola" }
}
```

### Comandos
- `reiniciar`, `volver`, `estado`, `humano`

