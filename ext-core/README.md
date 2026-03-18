## EXT Core (para jsDelivr)

Esta pasta é um **scaffold local** do que deve ser publicado num repo GitHub para uso via jsDelivr (tag + ponteiro).

### Estrutura

- `ext-core/channel/stable.json` → ponteiro do canal (no branch `main`)
- `ext-core/channel/beta.json` → ponteiro opcional
- `ext-core/v1.0.0/background-core.js` → core imutável publicado sob a tag `v1.0.0`

### Como funciona no loader da extensão

O loader local em `EXT/ext-hybrid/src/background.js` faz:

1. `fetch()` do ponteiro do canal (ex.: `stable.json`) para obter a tag
2. `import()` do `background-core.js` daquela tag

### Publicação (visão geral)

1. Criar repo GitHub (ex.: `c2-ext-core`) e colocar o conteúdo desta pasta em `ext-core/`.
2. Criar tag `v1.0.0`.
3. Ajustar no `EXT/ext-hybrid/src/config.js`:
   - `CHANNEL_URL` (aponta para `@main/ext-core/channel/stable.json`)
   - `CORE_BASE` (aponta para `https://cdn.jsdelivr.net/gh/<USER>/<REPO>`)

### Atualização sem atualizar a extensão

1. Publicar nova tag (ex.: `v1.0.1`) com `ext-core/v1.0.1/...`
2. Atualizar `ext-core/channel/stable.json` no `main` para `{ "tag": "v1.0.1" }`

