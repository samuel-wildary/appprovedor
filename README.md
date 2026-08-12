# appprovedor

Backend do aplicativo Acesseweb, preparado para deploy no EasyPanel.

O painel administrativo fica na pasta `dashboard/` e pode ser publicado como um segundo serviço usando o Dockerfile dessa pasta.

## Deploy

Use este diretório como a raiz do serviço no EasyPanel. O projeto inclui `Dockerfile` e expõe a porta `3001`.

Configure as variáveis:

- `PUBLIC_BASE_URL`: URL pública HTTPS do serviço no EasyPanel
- `SGP_API_USER`: usuário da API SGP
- `SGP_API_PASSWORD`: senha da API SGP
- `SGP_API_TOKEN`: token da API SGP
- `SGP_API_APP`: nome da aplicação do token SGP
- `ADMIN_NAME`: nome do administrador inicial
- `ADMIN_EMAIL`: e-mail do administrador inicial
- `ADMIN_PASSWORD`: senha do administrador inicial

O banco PGlite é armazenado em `.data/`; configure um volume persistente no EasyPanel se os dados administrativos precisarem sobreviver a deploys.

## Serviços no EasyPanel

- Backend: Dockerfile da raiz, porta `3001`
- Dashboard: `dashboard/Dockerfile`, porta `80`, com `VITE_API_URL` apontando para o backend

## Desenvolvimento

```bash
npm install
npm start
```
