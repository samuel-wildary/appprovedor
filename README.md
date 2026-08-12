# appprovedor

Backend do aplicativo Acesseweb, preparado para deploy no EasyPanel.

## Deploy

Use este diretório como a raiz do serviço no EasyPanel. O projeto inclui `Dockerfile` e expõe a porta `3001`.

Configure as variáveis:

- `PUBLIC_BASE_URL`: URL pública HTTPS do serviço no EasyPanel
- `SGP_API_USER`: usuário da API SGP
- `SGP_API_PASSWORD`: senha da API SGP
- `SGP_API_TOKEN`: token da API SGP
- `SGP_API_APP`: nome da aplicação do token SGP

O banco PGlite é armazenado em `.data/`; configure um volume persistente no EasyPanel se os dados administrativos precisarem sobreviver a deploys.

## Desenvolvimento

```bash
npm install
npm start
```
